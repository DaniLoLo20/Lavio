import { BadRequestException, Controller, ForbiddenException, Get, Injectable, Module, Param, Query, Res } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { PrismaService } from '../../prisma/prisma.module';
import { CashModule, CashService } from '../cash/cash.module';
import { AuthUser, CurrentUser, Roles, hasPerm } from '../../common/guards';
import { REPORT_RESOURCE } from '../../common/permissions';

type Cell = string | number | boolean | Date | null | undefined;

/** CSV con BOM UTF-8 (Excel respeta acentos). Neutraliza celdas que empiezan con = + - @ (inyeccion de formulas). */
function toCsv(headers: string[], rows: Cell[][]): string {
  const esc = (c: Cell) => {
    let s = c instanceof Date ? c.toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : c == null ? '' : String(c);
    if (typeof c === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '\uFEFF' + [headers, ...rows].map((r) => r.map(esc).join(',')).join('\r\n');
}

const n = (v: unknown) => Number(v ?? 0);
const yesNo = (b: boolean) => (b ? 'Sí' : 'No');
const METHODS: Record<string, string> = { CASH: 'Efectivo', CARD: 'Tarjeta', TRANSFER: 'Transferencia' };
const PREF: Record<string, string> = { NONE: 'Ninguno', WHATSAPP: 'WhatsApp', EMAIL: 'Correo' };
const CASH_CAT: Record<string, string> = {
  SERVICE_SALE: 'Venta de servicios', PRODUCT_SALE: 'Venta de productos', EXTRA_INCOME: 'Ingreso extraordinario', ADJUSTMENT: 'Ajuste',
  PURCHASE: 'Compras', STATIONERY: 'Papelería', OPERATING: 'Gastos operativos', PAYROLL: 'Nómina', MAINTENANCE: 'Mantenimiento', OTHER: 'Otros',
};
const MOVE: Record<string, string> = { IN: 'Entrada', OUT: 'Salida', ADJUSTMENT: 'Ajuste' };

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService, private cash: CashService) {}

  private range(from?: string, to?: string) {
    const parse = (s: string, end = false) => {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw new BadRequestException('Fecha inválida (use AAAA-MM-DD)');
      const d = new Date(`${s}T00:00:00`);
      if (end) d.setDate(d.getDate() + 1);
      return d;
    };
    return { gte: from ? parse(from) : undefined, lt: to ? parse(to, true) : undefined };
  }

  async build(type: string, t: string, from?: string, to?: string, extra: { sessionId?: string } = {}): Promise<{ name: string; csv: string }> {
    const r = this.range(from, to);
    const dates = r.gte || r.lt ? { ...(r.gte ? { gte: r.gte } : {}), ...(r.lt ? { lt: r.lt } : {}) } : undefined;

    switch (type) {
      case 'orders': {
        const rows = await this.prisma.washOrder.findMany({
          where: { tenantId: t, deletedAt: null, ...(dates ? { receivedAt: dates } : {}) },
          include: { vehicle: true, client: true, assignedTo: { select: { fullName: true } }, items: true, payments: { where: { deletedAt: null } } },
          orderBy: { receivedAt: 'desc' },
        });
        return { name: 'ordenes', csv: toCsv(
          ['Folio', 'Código', 'Fecha', 'Estado', 'Placa', 'Marca', 'Modelo', 'Color', 'Cliente', 'Teléfono', 'Lavador', 'Servicios', 'Subtotal', 'Descuento', 'IVA', 'Total', 'Pagado', 'Inicio', 'Fin', 'Minutos'],
          rows.map((o) => [o.folio, o.code, o.receivedAt, o.status, o.vehicle?.plate ?? '', o.vehicle?.brand ?? '', o.vehicle?.model ?? '', o.vehicle?.color, o.client?.name, o.client?.phone, o.assignedTo?.fullName,
            o.items.map((i) => `${i.quantity}x ${i.name}`).join('; '), n(o.subtotal), n(o.discount), n(o.taxAmount), n(o.total), o.payments.reduce((s, p) => s + n(p.amount), 0), o.startedAt, o.finishedAt, o.totalSeconds != null ? Math.round(o.totalSeconds / 60) : '']),
        ) };
      }
      case 'payments': {
        const rows = await this.prisma.payment.findMany({
          where: { tenantId: t, deletedAt: null, ...(dates ? { paidAt: dates } : {}) },
          include: { order: { select: { folio: true } } },
          orderBy: { paidAt: 'desc' },
        });
        return { name: 'pagos', csv: toCsv(['Fecha', 'Folio', 'Método', 'Monto', 'Referencia'], rows.map((p) => [p.paidAt, p.order.folio, METHODS[p.method], n(p.amount), p.reference])) };
      }
      case 'services': {
        const rows = await this.prisma.service.findMany({ where: { tenantId: t, deletedAt: null }, orderBy: { name: 'asc' } });
        return { name: 'servicios', csv: toCsv(['Nombre', 'Descripción', 'Precio', 'Activo'], rows.map((s) => [s.name, s.description, n(s.price), yesNo(s.isActive)])) };
      }
      case 'clients': {
        const rows = await this.prisma.client.findMany({
          where: { tenantId: t, deletedAt: null },
          include: { vehicles: { where: { deletedAt: null } }, _count: { select: { orders: true } } },
          orderBy: { name: 'asc' },
        });
        return { name: 'clientes', csv: toCsv(['Nombre', 'Teléfono', 'Correo', 'Preferencia', 'Visitas', 'Vehículos'],
          rows.map((c) => [c.name, c.phone, c.email, PREF[c.contactPreference], c._count.orders, c.vehicles.map((v) => `${v.brand} ${v.model} ${v.plate}`).join('; ')])) };
      }
      case 'inventory': {
        const rows = await this.prisma.inventoryProduct.findMany({ where: { tenantId: t, deletedAt: null }, include: { supplier: { select: { name: true } } }, orderBy: { name: 'asc' } });
        return { name: 'inventario', csv: toCsv(['SKU', 'Producto', 'Categoría', 'Existencia', 'Stock mínimo', 'Costo', 'Valor', 'Proveedor', 'Stock bajo'],
          rows.map((p) => [p.sku, p.name, p.category, n(p.stock), n(p.minStock), n(p.cost), Math.round(n(p.stock) * n(p.cost) * 100) / 100, p.supplier?.name, yesNo(n(p.stock) <= n(p.minStock))])) };
      }
      case 'movements': {
        const rows = await this.prisma.inventoryMovement.findMany({
          where: { tenantId: t, ...(dates ? { createdAt: dates } : {}) },
          include: { product: { select: { sku: true, name: true } } },
          orderBy: { createdAt: 'desc' },
        });
        return { name: 'movimientos_inventario', csv: toCsv(['Fecha', 'SKU', 'Producto', 'Tipo', 'Cantidad', 'Motivo'], rows.map((m) => [m.createdAt, m.product.sku, m.product.name, MOVE[m.type], n(m.quantity), m.reason])) };
      }
      case 'purchases': {
        const rows = await this.prisma.purchase.findMany({
          where: { tenantId: t, deletedAt: null, ...(dates ? { date: dates } : {}) },
          include: { supplier: { select: { name: true } }, items: { include: { product: { select: { sku: true, name: true } } } } },
          orderBy: { date: 'desc' },
        });
        return { name: 'compras', csv: toCsv(['Fecha', 'Proveedor', 'SKU', 'Producto', 'Cantidad', 'Costo unitario', 'Total línea', 'Total compra'],
          rows.flatMap((p) => p.items.map((i) => [p.date.toISOString().slice(0, 10), p.supplier.name, i.product.sku, i.product.name, n(i.quantity), n(i.unitCost), n(i.total), n(p.total)]))) };
      }
      case 'suppliers': {
        const rows = await this.prisma.supplier.findMany({ where: { tenantId: t, deletedAt: null }, orderBy: { name: 'asc' } });
        return { name: 'proveedores', csv: toCsv(['Nombre', 'Contacto', 'Teléfono', 'Correo', 'RFC', 'Notas'], rows.map((s) => [s.name, s.contactName, s.phone, s.email, s.taxId, s.notes])) };
      }
      case 'users': {
        const rows = await this.prisma.user.findMany({ where: { tenantId: t, deletedAt: null }, include: { role: true }, orderBy: { fullName: 'asc' } });
        return { name: 'usuarios', csv: toCsv(['Nombre', 'Correo', 'Rol', 'Activo'], rows.map((u) => [u.fullName, u.email, u.role.name === 'ADMIN' ? 'Administrador' : 'Lavador', yesNo(u.isActive)])) };
      }
      case 'cash-sessions': {
        const rows = await this.cash.list(t, from, to);
        return { name: 'cortes_de_caja', csv: toCsv(['Abierta', 'Abrió', 'Cerrada', 'Cerró', 'Estado', 'Caja inicial', 'Ingresos', 'Egresos', 'Caja esperada', 'Caja real', 'Diferencia'],
          rows.map((s: any) => [s.openedAt, s.openedByName, s.closedAt, s.closedByName, s.status === 'OPEN' ? 'Abierta' : 'Cerrada', s.openingAmount, s.totalIncome, s.totalExpense, s.expectedCash, s.countedCash, s.difference])) };
      }
      case 'cash-movements': {
        const rows = await this.prisma.cashMovement.findMany({
          where: { tenantId: t, deletedAt: null, ...(dates ? { occurredAt: dates } : {}) },
          orderBy: { occurredAt: 'desc' },
        });
        return { name: 'movimientos_de_caja', csv: toCsv(['Fecha', 'Tipo', 'Categoría', 'Concepto', 'Monto', 'Método', 'Responsable', 'Con evidencia'],
          rows.map((m) => [m.occurredAt, m.type === 'INCOME' ? 'Ingreso' : 'Egreso', CASH_CAT[m.category] ?? m.category, m.concept, n(m.amount), METHODS[m.method], m.responsibleName, yesNo(!!m.evidencePath)])) };
      }
      case 'cash-closing': {
        if (!extra.sessionId || !/^[0-9a-f-]{36}$/i.test(extra.sessionId)) throw new BadRequestException('sessionId requerido');
        const d = await this.cash.detail(t, extra.sessionId);
        const s = d.session, f = d.figures;
        const summary = toCsv(['Concepto', 'Valor'], [
          ['Abierta por', s.openedByName], ['Apertura', s.openedAt], ['Cerrada por', s.closedByName], ['Cierre', s.closedAt],
          ['Caja inicial', f.openingAmount], ['Cobros de órdenes - efectivo', f.orders.CASH], ['Cobros de órdenes - tarjeta', f.orders.CARD], ['Cobros de órdenes - transferencia', f.orders.TRANSFER],
          ['Otros ingresos', f.manualIncome.total], ['Total ingresos', f.totalIncome], ['Total egresos', f.totalExpense],
          ['Caja esperada (efectivo)', f.expectedCash], ['Caja real', s.countedCash], ['Diferencia', s.difference], ['Notas', s.closingNotes],
        ]);
        const moves = toCsv(['Fecha', 'Tipo', 'Categoría', 'Concepto', 'Monto', 'Método', 'Responsable'],
          d.movements.map((m: any) => [m.occurredAt, m.type === 'INCOME' ? 'Ingreso' : 'Egreso', CASH_CAT[m.category] ?? m.category, m.concept, m.amount, METHODS[m.method], m.responsibleName]));
        return { name: 'corte_de_caja', csv: summary + '\r\n\r\n' + moves.replace('\uFEFF', '') };
      }
      default:        throw new BadRequestException('Reporte desconocido');
    }
  }
}

@ApiTags('reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private svc: ReportsService) {}

  /** type: orders | payments | services | clients | inventory | movements | purchases | suppliers | users */
  @Get(':type')
  async get(@CurrentUser() u: AuthUser, @Param('type') type: string, @Query('from') from: string | undefined, @Query('to') to: string | undefined, @Query('sessionId') sessionId: string | undefined, @Res({ passthrough: true }) res: Response) {
    const resource = REPORT_RESOURCE[type];
    if (!resource) throw new BadRequestException('Reporte desconocido');
    if (!hasPerm(u, `${resource}:export`)) throw new ForbiddenException('No tienes permiso para exportar este reporte');
    const { name, csv } = await this.svc.build(type, u.tenantId, from, to, { sessionId });
    const stamp = new Date().toISOString().slice(0, 10);
    res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}_${stamp}.csv"`, 'Cache-Control': 'no-store' });
    return csv;
  }
}

@Module({ imports: [CashModule], controllers: [ReportsController], providers: [ReportsService] })
export class ReportsModule {}
