import { Controller, Get, Injectable, Module, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { PrismaService } from '../../prisma/prisma.module';
import { AuthUser, CurrentUser, Perms, PermsAny, Roles } from '../../common/guards';

const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  private async range(tenantId: string, from: Date, to: Date) {
    const where = { tenantId, deletedAt: null, receivedAt: { gte: from, lt: to } };
    const [orders, services] = await Promise.all([
      this.prisma.washOrder.aggregate({ where, _sum: { total: true }, _count: true }),
      this.prisma.washOrderItem.aggregate({ where: { tenantId, order: where }, _sum: { quantity: true } }),
    ]);
    const sales = Number(orders._sum.total ?? 0);
    return { sales, vehicles: orders._count, services: services._sum.quantity ?? 0, avgTicket: orders._count ? sales / orders._count : 0 };
  }

  async summary(u: AuthUser, daysParam?: string) {
    const t = u.tenantId;
    const days = [7, 30, 90].includes(Number(daysParam)) ? Number(daysParam) : 30;
    const now = new Date();
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const tomorrow = new Date(day.getFullYear(), day.getMonth(), day.getDate() + 1);
    const dow = (day.getDay() + 6) % 7; // lunes = 0
    const weekStart = new Date(day.getFullYear(), day.getMonth(), day.getDate() - dow);
    const prevWeekStart = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() - 7);
    const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 7);
    const monthStart = new Date(day.getFullYear(), day.getMonth(), 1);
    const nextMonth = new Date(day.getFullYear(), day.getMonth() + 1, 1);
    const rangeStart = new Date(day.getFullYear(), day.getMonth(), day.getDate() - (days - 1));
    const sixMonthsStart = new Date(day.getFullYear(), day.getMonth() - 5, 1);
    const fetchFrom = rangeStart < sixMonthsStart ? rangeStart : sixMonthsStart;
    const inRange = { gte: rangeStart, lt: tomorrow };

    const [today, week, prevWeek, month, monthClients, orders, lowStock, active, top, pays] = await Promise.all([
      this.range(t, day, tomorrow),
      this.range(t, weekStart, weekEnd),
      this.range(t, prevWeekStart, weekStart),
      this.range(t, monthStart, nextMonth),
      this.prisma.washOrder.groupBy({ by: ['clientId'], where: { tenantId: t, deletedAt: null, clientId: { not: null }, receivedAt: { gte: monthStart, lt: nextMonth } } }),
      this.prisma.washOrder.findMany({ where: { tenantId: t, deletedAt: null, receivedAt: { gte: fetchFrom, lt: tomorrow } }, select: { receivedAt: true, total: true, totalSeconds: true } }),
      this.prisma.inventoryProduct.findMany({ where: { tenantId: t, deletedAt: null }, select: { id: true, name: true, stock: true, minStock: true } }),
      this.prisma.washOrder.groupBy({ by: ['status'], where: { tenantId: t, deletedAt: null, status: { not: 'ENTREGADO' } }, _count: true }),
      this.prisma.washOrderItem.groupBy({ by: ['name'], where: { tenantId: t, order: { deletedAt: null, receivedAt: inRange } }, _sum: { quantity: true, total: true }, orderBy: { _sum: { total: 'desc' } }, take: 6 }),
      this.prisma.payment.groupBy({ by: ['method'], where: { tenantId: t, deletedAt: null, paidAt: inRange }, _sum: { amount: true } }),
    ]);

    // Clientes recurrentes: con orden en el mes y 2 o mas ordenes historicas
    const ids = monthClients.map((c) => c.clientId!);
    const totals = ids.length
      ? await this.prisma.washOrder.groupBy({ by: ['clientId'], where: { tenantId: t, deletedAt: null, clientId: { in: ids } }, _count: true })
      : [];
    const recurring = totals.filter((c) => c._count >= 2).length;

    // Serie diaria del rango elegido
    const perDay = new Map<string, { sales: number; vehicles: number }>();
    const perMonth = new Map<string, number>();
    const byHour = Array.from({ length: 24 }, () => 0);
    let secSum = 0, secCount = 0;
    for (const o of orders) {
      const k = key(o.receivedAt);
      const mk = k.slice(0, 7);
      perMonth.set(mk, (perMonth.get(mk) ?? 0) + Number(o.total));
      if (o.receivedAt >= rangeStart) {
        const e = perDay.get(k) ?? { sales: 0, vehicles: 0 };
        e.sales += Number(o.total); e.vehicles += 1;
        perDay.set(k, e);
        byHour[o.receivedAt.getHours()] += 1;
        if (o.totalSeconds != null) { secSum += o.totalSeconds; secCount += 1; }
      }
    }
    const series = Array.from({ length: days }, (_, i) => {
      const d = new Date(rangeStart.getFullYear(), rangeStart.getMonth(), rangeStart.getDate() + i);
      const e = perDay.get(key(d));
      return { date: key(d), sales: e?.sales ?? 0, vehicles: e?.vehicles ?? 0 };
    });
    const monthly = Array.from({ length: 6 }, (_, i) => {
      const d = new Date(sixMonthsStart.getFullYear(), sixMonthsStart.getMonth() + i, 1);
      return { month: key(d).slice(0, 7), sales: perMonth.get(key(d).slice(0, 7)) ?? 0 };
    });

    return {
      days,
      today,
      week: { sales: week.sales, previousSales: prevWeek.sales, growthPct: prevWeek.sales ? ((week.sales - prevWeek.sales) / prevWeek.sales) * 100 : null },
      month: { income: month.sales, vehicles: month.vehicles, recurringClients: recurring },
      range: { from: key(rangeStart), to: key(day), avgMinutes: secCount ? Math.round(secSum / secCount / 60) : null },
      series,
      monthly,
      byHour,
      topServices: top.map((s) => ({ name: s.name, quantity: s._sum.quantity ?? 0, total: Number(s._sum.total ?? 0) })),
      paymentMethods: pays.map((p) => ({ method: p.method, total: Number(p._sum.amount ?? 0) })),
      activeByStatus: active.map((a) => ({ status: a.status, count: a._count })),
      lowStock: lowStock.filter((p) => Number(p.stock) <= Number(p.minStock)).map((p) => ({ id: p.id, name: p.name, stock: Number(p.stock), minStock: Number(p.minStock) })),
    };
  }
}

@ApiTags('dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(private svc: DashboardService) {}
  @Perms('dashboard:view') @Get('summary') summary(@CurrentUser() u: AuthUser, @Query('days') days?: string) { return this.svc.summary(u, days); }
}

@Module({ controllers: [DashboardController], providers: [DashboardService] })
export class DashboardModule {}
