import {
  BadRequestException, Body, ConflictException, Controller, Delete, Get, Injectable, Module, NotFoundException,
  Param, ParseUUIDPipe, Post, Query, Res, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiTags } from '@nestjs/swagger';
import { IsEnum, IsIn, IsNumber, IsOptional, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import { CashEntryType, PaymentMethod, Prisma } from '@prisma/client';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { mkdirSync, promises as fsp } from 'fs';
import { join, resolve, sep } from 'path';
import type { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.module';
import { AuthUser, CurrentUser, Perms, PermsAny, Roles } from '../../common/guards';

export const INCOME_CATEGORIES = ['SERVICE_SALE', 'PRODUCT_SALE', 'EXTRA_INCOME', 'ADJUSTMENT'] as const;
export const EXPENSE_CATEGORIES = ['PURCHASE', 'STATIONERY', 'OPERATING', 'PAYROLL', 'MAINTENANCE', 'OTHER'] as const;

const UPLOAD_DIR = () => process.env.UPLOAD_DIR || '/storage/uploads';
const EXT: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic' };
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const num = (v: unknown) => Number(v ?? 0);

class OpenCashDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) openingAmount: number;
  @IsOptional() @IsString() @MaxLength(300) notes?: string;
}

class MovementDto {
  @IsEnum(CashEntryType) type: CashEntryType;
  @IsIn([...INCOME_CATEGORIES, ...EXPENSE_CATEGORIES]) category: string;
  @IsString() @MinLength(2) @MaxLength(200) concept: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) amount: number;
  @IsOptional() @IsEnum(PaymentMethod) method?: PaymentMethod;
  @IsOptional() @IsUUID() responsibleId?: string;
  @IsOptional() @IsString() @MaxLength(120) responsibleName?: string;
}

class CloseCashDto {
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) countedCash: number;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}

type ByMethod = { CASH: number; CARD: number; TRANSFER: number };
const byMethod = (): ByMethod => ({ CASH: 0, CARD: 0, TRANSFER: 0 });
const sumMethods = (m: ByMethod) => r2(m.CASH + m.CARD + m.TRANSFER);

export interface CashSummary {
  openingAmount: number;
  /** cobros de ordenes (tabla payments) en la ventana de la caja */
  orders: ByMethod & { total: number; count: number };
  /** ingresos manuales */
  manualIncome: ByMethod & { total: number };
  expense: ByMethod & { total: number };
  incomeByCategory: Record<string, number>;
  expenseByCategory: Record<string, number>;
  totalIncome: number;
  totalExpense: number;
  /** efectivo que deberia haber en el cajon */
  expectedCash: number;
}

@Injectable()
export class CashService {
  constructor(private prisma: PrismaService) {}

  /** Cifras de una caja. Cobros de ordenes = pagos con paid_at dentro de [abierta, cerrada|ahora]. */
  async summary(tenantId: string, s: { id: string; openedAt: Date; closedAt: Date | null; openingAmount: Prisma.Decimal | number }): Promise<CashSummary> {
    const end = s.closedAt ?? new Date();
    const [pay, mov] = await Promise.all([
      this.prisma.payment.groupBy({ by: ['method'], where: { tenantId, deletedAt: null, paidAt: { gte: s.openedAt, lte: end } }, _sum: { amount: true }, _count: true }),
      this.prisma.cashMovement.groupBy({ by: ['type', 'method', 'category'], where: { sessionId: s.id, deletedAt: null }, _sum: { amount: true } }),
    ]);
    const orders = byMethod(), manual = byMethod(), exp = byMethod();
    const incomeByCategory: Record<string, number> = {}, expenseByCategory: Record<string, number> = {};
    let count = 0;
    for (const p of pay) { orders[p.method] += num(p._sum.amount); count += p._count; }
    for (const m of mov) {
      const a = num(m._sum.amount);
      if (m.type === 'INCOME') { manual[m.method] += a; incomeByCategory[m.category] = r2((incomeByCategory[m.category] ?? 0) + a); }
      else { exp[m.method] += a; expenseByCategory[m.category] = r2((expenseByCategory[m.category] ?? 0) + a); }
    }
    for (const o of [orders, manual, exp]) { o.CASH = r2(o.CASH); o.CARD = r2(o.CARD); o.TRANSFER = r2(o.TRANSFER); }
    const opening = num(s.openingAmount);
    const ordersTotal = sumMethods(orders), manualTotal = sumMethods(manual), expTotal = sumMethods(exp);
    return {
      openingAmount: opening,
      orders: { ...orders, total: ordersTotal, count },
      manualIncome: { ...manual, total: manualTotal },
      expense: { ...exp, total: expTotal },
      incomeByCategory, expenseByCategory,
      totalIncome: r2(ordersTotal + manualTotal),
      totalExpense: expTotal,
      expectedCash: r2(opening + orders.CASH + manual.CASH - exp.CASH),
    };
  }

  private head(s: any) {
    return {
      id: s.id, status: s.status, openedAt: s.openedAt, openedByName: s.openedByName, openingAmount: num(s.openingAmount), openingNotes: s.openingNotes,
      closedAt: s.closedAt, closedByName: s.closedByName, closingNotes: s.closingNotes,
      expectedCash: s.expectedCash != null ? num(s.expectedCash) : null,
      countedCash: s.countedCash != null ? num(s.countedCash) : null,
      difference: s.difference != null ? num(s.difference) : null,
      totalIncome: s.totalIncome != null ? num(s.totalIncome) : null,
      totalExpense: s.totalExpense != null ? num(s.totalExpense) : null,
    };
  }

  private movementView(m: any) {
    const { evidencePath, ...rest } = m;
    return { ...rest, amount: num(m.amount), hasEvidence: !!evidencePath };
  }

  /**
   * Cuentas por cobrar: ordenes con saldo pendiente (total - pagos > 0), de cualquier fecha.
   * Desde la caja se cobran con POST /orders/:id/payments; el cobro cae en la caja abierta automaticamente.
   */
  async receivables(tenantId: string) {
    const rows = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT o.id
      FROM wash_orders o
      LEFT JOIN payments p ON p.order_id = o.id AND p.deleted_at IS NULL
      WHERE o.tenant_id = ${tenantId}::uuid AND o.deleted_at IS NULL
      GROUP BY o.id, o.total, o.received_at
      HAVING o.total - COALESCE(SUM(p.amount), 0) > 0.004
      ORDER BY o.received_at DESC
      LIMIT 100`);
    if (!rows.length) return [];
    const orders = await this.prisma.washOrder.findMany({
      where: { id: { in: rows.map((r) => r.id) }, tenantId },
      include: {
        vehicle: { select: { plate: true, brand: true, model: true } },
        client: { select: { name: true, phone: true } },
        payments: { where: { deletedAt: null }, select: { amount: true } },
      },
      orderBy: { receivedAt: 'desc' },
    });
    return orders.map((o) => {
      const paid = r2(o.payments.reduce((s, p) => s + num(p.amount), 0));
      return {
        id: o.id, folio: o.folio, code: o.code, status: o.status, receivedAt: o.receivedAt,
        total: num(o.total), paid, due: r2(num(o.total) - paid),
        vehicle: o.vehicle, clientName: o.client?.name ?? null, clientPhone: o.client?.phone ?? null,
      };
    });
  }

  async current(tenantId: string) {
    const s = await this.prisma.cashSession.findFirst({ where: { tenantId, status: 'OPEN' } });
    if (!s) return null;
    return this.detail(tenantId, s.id);
  }

  async open(u: AuthUser, dto: OpenCashDto) {
    try {
      const s = await this.prisma.cashSession.create({
        data: { tenantId: u.tenantId, openKey: u.tenantId, openedById: u.sub, openedByName: u.name, openingAmount: dto.openingAmount, openingNotes: dto.notes },
      });
      return this.detail(u.tenantId, s.id);
    } catch (e: any) {
      if (e?.code === 'P2002') throw new ConflictException('Ya hay una caja abierta. Realice el corte antes de abrir otra.');
      throw e;
    }
  }

  async list(tenantId: string, from?: string, to?: string) {
    const gte = from ? new Date(`${from}T00:00:00`) : undefined;
    const lt = to ? new Date(new Date(`${to}T00:00:00`).getTime() + 86_400_000) : undefined;
    const rows = await this.prisma.cashSession.findMany({
      where: { tenantId, ...(gte || lt ? { openedAt: { ...(gte ? { gte } : {}), ...(lt ? { lt } : {}) } } : {}) },
      orderBy: { openedAt: 'desc' },
      take: 100,
    });
    return Promise.all(rows.map(async (s) => {
      const h = this.head(s);
      if (s.status === 'OPEN') {
        const sm = await this.summary(tenantId, s);
        return { ...h, totalIncome: sm.totalIncome, totalExpense: sm.totalExpense, expectedCash: sm.expectedCash };
      }
      return h;
    }));
  }

  /** Detalle: cifras (vivas si esta abierta; la foto fija si esta cerrada), movimientos y cobros de ordenes. */
  async detail(tenantId: string, id: string) {
    const s = await this.prisma.cashSession.findFirst({ where: { id, tenantId } });
    if (!s) throw new NotFoundException('Caja no encontrada');
    const live = await this.summary(tenantId, s);
    const figures = s.status === 'CLOSED' && s.snapshot ? (s.snapshot as unknown as CashSummary) : live;
    const end = s.closedAt ?? new Date();
    const [movements, payments] = await Promise.all([
      this.prisma.cashMovement.findMany({ where: { sessionId: s.id, deletedAt: null }, orderBy: { occurredAt: 'desc' } }),
      this.prisma.payment.findMany({
        where: { tenantId, deletedAt: null, paidAt: { gte: s.openedAt, lte: end } },
        include: { order: { select: { id: true, folio: true } } },
        orderBy: { paidAt: 'desc' },
        take: 500,
      }),
    ]);
    // Pagos sincronizados despues del corte (se hicieron dentro del turno pero llegaron tarde)
    const late = s.status === 'CLOSED' ? r2(Math.max(0, live.orders.total - figures.orders.total)) : 0;
    return {
      session: this.head(s),
      figures,
      lateOrderPayments: late,
      movements: movements.map((m) => this.movementView(m)),
      payments: payments.map((p) => ({ id: p.id, paidAt: p.paidAt, method: p.method, amount: num(p.amount), orderId: p.order.id, folio: p.order.folio })),
    };
  }

  async addMovement(u: AuthUser, dto: MovementDto) {
    const valid = dto.type === 'INCOME' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;
    if (!(valid as readonly string[]).includes(dto.category)) throw new BadRequestException('La categoría no corresponde al tipo de movimiento');
    const s = await this.prisma.cashSession.findFirst({ where: { tenantId: u.tenantId, status: 'OPEN' } });
    if (!s) throw new BadRequestException('Abra la caja antes de registrar movimientos');

    let responsibleName = dto.responsibleName?.trim() || u.name;
    if (dto.responsibleId) {
      const r = await this.prisma.user.findFirst({ where: { id: dto.responsibleId, tenantId: u.tenantId, deletedAt: null } });
      if (!r) throw new BadRequestException('Responsable inválido');
      responsibleName = r.fullName;
    }
    const m = await this.prisma.cashMovement.create({
      data: {
        tenantId: u.tenantId, sessionId: s.id, type: dto.type, category: dto.category, concept: dto.concept.trim(), amount: dto.amount,
        method: dto.method ?? 'CASH', responsibleId: dto.responsibleId, responsibleName, createdById: u.sub,
      },
    });
    return this.movementView(m);
  }

  async setEvidence(u: AuthUser, id: string, relativePath: string) {
    const m = await this.prisma.cashMovement.findFirst({ where: { id, tenantId: u.tenantId, deletedAt: null } });
    if (!m) throw new NotFoundException('Movimiento no encontrado');
    if (m.evidencePath) await fsp.unlink(join(UPLOAD_DIR(), m.evidencePath)).catch(() => undefined);
    return this.movementView(await this.prisma.cashMovement.update({ where: { id }, data: { evidencePath: relativePath } }));
  }

  async evidenceFile(u: AuthUser, id: string) {
    const m = await this.prisma.cashMovement.findFirst({ where: { id, tenantId: u.tenantId, deletedAt: null } });
    if (!m?.evidencePath) throw new NotFoundException('Sin evidencia');
    const base = resolve(UPLOAD_DIR(), u.tenantId);
    const abs = resolve(UPLOAD_DIR(), m.evidencePath);
    if (!abs.startsWith(base + sep)) throw new NotFoundException(); // nunca salir de la carpeta de la empresa
    return abs;
  }

  async removeMovement(u: AuthUser, id: string) {
    const m = await this.prisma.cashMovement.findFirst({ where: { id, tenantId: u.tenantId, deletedAt: null }, include: { session: { select: { status: true } } } });
    if (!m) throw new NotFoundException('Movimiento no encontrado');
    if (m.session.status !== 'OPEN') throw new BadRequestException('No se puede eliminar un movimiento de una caja ya cerrada');
    await this.prisma.cashMovement.update({ where: { id }, data: { deletedAt: new Date() } });
    return { ok: true };
  }

  /** Corte: caja inicial, ingresos, egresos, caja esperada (efectivo), caja real y diferencia. Guarda una foto fija. */
  async close(u: AuthUser, id: string, dto: CloseCashDto) {
    const s = await this.prisma.cashSession.findFirst({ where: { id, tenantId: u.tenantId } });
    if (!s) throw new NotFoundException('Caja no encontrada');
    if (s.status !== 'OPEN') throw new ConflictException('Esta caja ya fue cerrada');
    const closedAt = new Date();
    const sm = await this.summary(u.tenantId, { ...s, closedAt });
    const difference = r2(dto.countedCash - sm.expectedCash);
    const r = await this.prisma.cashSession.updateMany({
      where: { id, tenantId: u.tenantId, status: 'OPEN' },
      data: {
        status: 'CLOSED', openKey: null, closedAt, closedById: u.sub, closedByName: u.name,
        expectedCash: sm.expectedCash, countedCash: dto.countedCash, difference,
        totalIncome: sm.totalIncome, totalExpense: sm.totalExpense, closingNotes: dto.notes,
        snapshot: sm as unknown as Prisma.InputJsonValue,
      },
    });
    if (!r.count) throw new ConflictException('Esta caja ya fue cerrada');
    return this.detail(u.tenantId, id);
  }
}

@ApiTags('cash')
@ApiBearerAuth()
@Controller('cash')
export class CashController {
  constructor(private svc: CashService) {}

  @Perms('cash:view') @Get('receivables') receivables(@CurrentUser() u: AuthUser) { return this.svc.receivables(u.tenantId); }
  @Perms('cash:view') @Get('current') current(@CurrentUser() u: AuthUser) { return this.svc.current(u.tenantId); }
  @Perms('cash:create') @Post('open') open(@CurrentUser() u: AuthUser, @Body() dto: OpenCashDto) { return this.svc.open(u, dto); }
  @Perms('cash:view') @Get('sessions') list(@CurrentUser() u: AuthUser, @Query('from') from?: string, @Query('to') to?: string) { return this.svc.list(u.tenantId, from, to); }
  @Perms('cash:view') @Get('sessions/:id') detail(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.detail(u.tenantId, id); }
  @Perms('cash:close') @Post('sessions/:id/close') close(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: CloseCashDto) { return this.svc.close(u, id, dto); }

  @Perms('cash:create') @Post('movements') add(@CurrentUser() u: AuthUser, @Body() dto: MovementDto) { return this.svc.addMovement(u, dto); }
  @Perms('cash:delete') @Delete('movements/:id') remove(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string) { return this.svc.removeMovement(u, id); }

  @Perms('cash:create')
  @Post('movements/:id/evidence')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 10 * 1024 * 1024 },
      fileFilter: (_req, file, cb) => (EXT[file.mimetype] ? cb(null, true) : cb(new BadRequestException('Solo imágenes JPG, PNG, WEBP o HEIC') as any, false)),
      storage: diskStorage({
        destination: (req: any, _file, cb) => {
          const dir = join(UPLOAD_DIR(), req.user.tenantId, 'cash');
          mkdirSync(dir, { recursive: true });
          cb(null, dir);
        },
        filename: (_req, file, cb) => cb(null, randomUUID() + EXT[file.mimetype]),
      }),
    }),
  )
  async evidence(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File) {
    if (!file) throw new BadRequestException('Archivo requerido');
    try {
      return await this.svc.setEvidence(u, id, `${u.tenantId}/cash/${file.filename}`);
    } catch (e) {
      await fsp.unlink(file.path).catch(() => undefined);
      throw e;
    }
  }

  /** El comprobante es privado: solo se entrega con sesion y de la propia empresa. */
  @Perms('cash:view')
  @Get('movements/:id/evidence')
  async evidenceGet(@CurrentUser() u: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const abs = await this.svc.evidenceFile(u, id);
    res.set({ 'Cache-Control': 'private, max-age=3600' });
    res.sendFile(abs);
  }
}

@Module({ controllers: [CashController], providers: [CashService], exports: [CashService] })
export class CashModule {}
