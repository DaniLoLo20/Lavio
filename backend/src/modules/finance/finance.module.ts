import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.module';
import { AuthUser, CurrentUser, Perms, PermsAny, Roles } from '../../common/guards';
import { CashModule, CashService } from '../cash/cash.module';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/**
 * Base de efectivo ("cash basis"): ingresos = cobros de ordenes (payments, por fecha de pago) + ingresos manuales de caja;
 * egresos = egresos manuales de caja. Utilidad = ingresos - egresos. Los pagos con tarjeta y transferencia cuentan como ingreso
 * (aunque no entren al cajon); la "caja esperada" del corte solo considera efectivo.
 */
@Injectable()
export class FinanceService {
  constructor(private prisma: PrismaService, private cash: CashService) {}

  async summary(u: AuthUser, daysParam?: string) {
    const t = u.tenantId;
    const days = [7, 30, 90].includes(Number(daysParam)) ? Number(daysParam) : 30;
    const now = new Date();
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    const dow = (day.getDay() + 6) % 7; // lunes = 0
    const weekStart = new Date(day.getFullYear(), day.getMonth(), day.getDate() - dow);
    const prevWeekStart = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() - 7);
    const monthStart = new Date(day.getFullYear(), day.getMonth(), 1);
    const rangeStart = new Date(day.getFullYear(), day.getMonth(), day.getDate() - (days - 1));
    const fetchFrom = [rangeStart, monthStart, prevWeekStart].reduce((a, b) => (a < b ? a : b));

    const [pays, movs, open] = await Promise.all([
      this.prisma.payment.findMany({ where: { tenantId: t, deletedAt: null, paidAt: { gte: fetchFrom, lt: tomorrow } }, select: { paidAt: true, amount: true, method: true } }),
      this.prisma.cashMovement.findMany({
        where: { tenantId: t, deletedAt: null, occurredAt: { gte: fetchFrom, lt: tomorrow } },
        select: { occurredAt: true, type: true, category: true, amount: true, method: true, concept: true, responsibleName: true },
      }),
      this.prisma.cashSession.findFirst({ where: { tenantId: t, status: 'OPEN' } }),
    ]);

    const period = (from: Date, to: Date) => {
      let income = 0, expense = 0;
      for (const p of pays) if (p.paidAt >= from && p.paidAt < to) income += Number(p.amount);
      for (const m of movs) if (m.occurredAt >= from && m.occurredAt < to) (m.type === 'INCOME' ? (income += Number(m.amount)) : (expense += Number(m.amount)));
      return { income: r2(income), expense: r2(expense), utility: r2(income - expense) };
    };
    const today = period(day, tomorrow);
    const week = period(weekStart, tomorrow);
    const prevWeek = period(prevWeekStart, weekStart);
    const month = period(monthStart, tomorrow);

    // ---- serie diaria del rango (flujo de efectivo) ----
    const daily = new Map<string, { orders: number; other: number; expense: number }>();
    const methodIncome: Record<string, number> = { CASH: 0, CARD: 0, TRANSFER: 0 };
    const sourceIncome: Record<string, number> = {};
    const expenseByCategory: Record<string, number> = {};
    const expenses: { concept: string; category: string; amount: number; at: Date; responsibleName: string }[] = [];
    const slot = (d: Date) => { const k = key(d); let e = daily.get(k); if (!e) { e = { orders: 0, other: 0, expense: 0 }; daily.set(k, e); } return e; };

    for (const p of pays) {
      if (p.paidAt < rangeStart) continue;
      const a = Number(p.amount);
      slot(p.paidAt).orders += a;
      methodIncome[p.method] += a;
      sourceIncome.ORDERS = (sourceIncome.ORDERS ?? 0) + a;
    }
    for (const m of movs) {
      if (m.occurredAt < rangeStart) continue;
      const a = Number(m.amount);
      if (m.type === 'INCOME') {
        slot(m.occurredAt).other += a;
        methodIncome[m.method] += a;
        sourceIncome[m.category] = (sourceIncome[m.category] ?? 0) + a;
      } else {
        slot(m.occurredAt).expense += a;
        expenseByCategory[m.category] = (expenseByCategory[m.category] ?? 0) + a;
        expenses.push({ concept: m.concept, category: m.category, amount: a, at: m.occurredAt, responsibleName: m.responsibleName });
      }
    }
    let cumulative = 0;
    const cashflow = Array.from({ length: days }, (_, i) => {
      const d = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate() + i);
      const e = daily.get(key(d)) ?? { orders: 0, other: 0, expense: 0 };
      const income = r2(e.orders + e.other);
      const net = r2(income - e.expense);
      cumulative = r2(cumulative + net);
      return { date: key(d), income, expense: r2(e.expense), net, cumulative };
    });

    const rangeIncome = r2(cashflow.reduce((s, x) => s + x.income, 0));
    const rangeExpense = r2(cashflow.reduce((s, x) => s + x.expense, 0));
    const totalExpenseByCat = Object.values(expenseByCategory).reduce((s, v) => s + v, 0);

    return {
      days,
      range: { from: key(rangeStart), to: key(day), income: rangeIncome, expense: rangeExpense, utility: r2(rangeIncome - rangeExpense) },
      today, week, month,
      weekGrowthPct: prevWeek.utility ? r2(((week.utility - prevWeek.utility) / Math.abs(prevWeek.utility)) * 100) : null,
      cashflow,
      topExpenseCategories: Object.entries(expenseByCategory)
        .map(([category, total]) => ({ category, total: r2(total), pct: totalExpenseByCat ? r2((total / totalExpenseByCat) * 100) : 0 }))
        .sort((a, b) => b.total - a.total),
      topExpenses: expenses.sort((a, b) => b.amount - a.amount).slice(0, 5).map((e) => ({ ...e, amount: r2(e.amount) })),
      incomeByMethod: Object.entries(methodIncome).map(([method, total]) => ({ method, total: r2(total) })).filter((x) => x.total > 0),
      incomeBySource: Object.entries(sourceIncome).map(([source, total]) => ({ source, total: r2(total) })).sort((a, b) => b.total - a.total),
      cashDrawer: open
        ? await this.cash.summary(t, open).then((s) => ({ open: true, sessionId: open.id, openedAt: open.openedAt, expectedCash: s.expectedCash }))
        : { open: false },
    };
  }
}

@ApiTags('finance')
@ApiBearerAuth()
@Controller('finance')
export class FinanceController {
  constructor(private svc: FinanceService) {}
  @Perms('finance:view') @Get('summary') summary(@CurrentUser() u: AuthUser, @Query('days') days?: string) { return this.svc.summary(u, days); }
}

@Module({ imports: [CashModule], controllers: [FinanceController], providers: [FinanceService] })
export class FinanceModule {}
