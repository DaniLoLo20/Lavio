import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AuthUser, hasPerm } from '../../../common/guards';
import { WashOrderRepository } from '../domain/order.repository';
import { OrderStatusValue, canTransition, computeTotals, normalizePlate, normalizeStatus, timesForTransition } from '../domain/order-rules';
import { CreateOrderDto, PaymentDto } from '../presentation/dto';

const DAY = 86_400_000;

/**
 * Los relojes de celulares pueden estar mal ajustados: una fecha futura se trata como "ahora" y
 * una anterior a 30 dias se descarta. Asi un reloj incorrecto no puede reescribir la historia.
 */
export function clampTime(raw?: string, now = new Date()): Date {
  if (!raw) return now;
  const d = new Date(raw);
  if (isNaN(d.getTime()) || d > now) return now;
  if (now.getTime() - d.getTime() > 30 * DAY) return now;
  return d;
}

/** Vista del lavador: sin informacion financiera ni datos de contacto del cliente. */
export function toWasherView(o: any) {
  const { subtotal, discount, taxRate, taxAmount, total, payments, client, items, ...rest } = o;
  return { ...rest, items: items.map((i: any) => ({ id: i.id, name: i.name, quantity: i.quantity })) };
}

@Injectable()
export class OrdersService {
  constructor(private repo: WashOrderRepository) {}

  async create(user: AuthUser, dto: CreateOrderDto) {
    const settings = await this.repo.tenantSettings(user.tenantId);
    const ids = [...new Set(dto.items.map((i) => i.serviceId))];
    const services = await this.repo.activeServices(user.tenantId, ids);
    if (services.length !== ids.length) throw new BadRequestException('Algún servicio no existe o está inactivo');
    if (dto.assignedToId && !(await this.repo.washerBelongsToTenant(user.tenantId, dto.assignedToId))) {
      throw new BadRequestException('Lavador inválido');
    }
    const lines = dto.items.map((i) => {
      const s = services.find((x) => x.id === i.serviceId)!;
      const custom = i.unitPrice !== undefined && Math.abs(i.unitPrice - s.price) > 0.001;
      if (custom && !hasPerm(user, 'orders:edit_price')) throw new ForbiddenException('No tienes permiso para modificar precios');
      const unitPrice = custom ? i.unitPrice! : s.price;
      return { serviceId: s.id, name: s.name, unitPrice, quantity: i.quantity, total: Math.round(unitPrice * i.quantity * 100) / 100 };
    });
    const totals = computeTotals(lines, dto.discount ?? 0, settings.taxRate);
    const c = dto.client;
    const hasClient = !!(c && (c.name || c.phone || c.email));
    return this.repo.create({
      tenantId: user.tenantId,
      userId: user.sub,
      id: dto.id,
      code: dto.code,
      receivedAt: clampTime(dto.createdAt),
      vehicle: { ...dto.vehicle, plate: normalizePlate(dto.vehicle.plate) },
      client: hasClient ? c! : null,
      notes: dto.notes,
      assignedToId: dto.assignedToId,
      items: lines,
      totals,
      payment: dto.payment ? { ...dto.payment, amount: dto.payment.amount ?? totals.total } : null,
    });
  }

  list(user: AuthUser, q: { status?: string; active?: string; archived?: string; search?: string; from?: string; to?: string; limit?: string }) {
    const own = hasPerm(user, 'orders:own_only');          // solo las asignadas
    const prices = hasPerm(user, 'orders:prices');          // puede ver montos
    const limit = Math.min(Math.max(Number(q.limit) || 100, 1), 200);
    return this.repo
      .findMany({
        tenantId: user.tenantId,
        status: q.status,
        active: q.active === 'true',
        search: q.search,
        from: q.from ? new Date(q.from) : undefined,
        to: q.to ? new Date(q.to) : undefined,
        assignedToId: own ? user.sub : undefined,
        archived: q.archived === 'true',
        limit,
      })
      .then((rows) =>
        prices
          ? rows
          : rows.map(({ subtotal, discount, taxRate, taxAmount, total, payments, client, ...rest }) => rest),
      );
  }

  private async load(user: AuthUser, id: string) {
    const o = await this.repo.findById(user.tenantId, id);
    if (!o) throw new NotFoundException('Orden no encontrada');
    if (hasPerm(user, 'orders:own_only') && o.assignedToId !== user.sub) throw new ForbiddenException();
    return o;
  }

  async get(user: AuthUser, id: string) {
    const o = await this.load(user, id);
    return hasPerm(user, 'orders:prices') ? o : toWasherView(o);
  }

  /**
   * Cambio de estatus con resolucion de conflictos por marca de tiempo (offline-first):
   *  - mismo estatus que el actual: exito idempotente (reintento de una sincronizacion);
   *  - `at` anterior al ultimo cambio del servidor: 409 STALE, prevalece el servidor ("gana el mas reciente");
   *  - transicion invalida: 400.
   * `at` es el momento real en que el empleado hizo el cambio (aunque estuviera sin conexion) y se usa
   * para hora de inicio/fin y tiempo total.
   */
  async changeStatus(user: AuthUser, id: string, toRaw: OrderStatusValue, note?: string, atRaw?: string) {
    const o = await this.load(user, id);
    const to = normalizeStatus(toRaw);
    if (normalizeStatus(o.status) === 'FINALIZADO' && to === 'RECIBIDO' && !hasPerm(user, 'orders:deliver')) throw new ForbiddenException('No tienes permiso para reabrir una orden finalizada');
    const view = (x: any) => (hasPerm(user, 'orders:prices') ? x : toWasherView(x));
    if (normalizeStatus(o.status) === to) return view(o);

    const at = clampTime(atRaw);
    const last: Date = o.statusHistory.length ? o.statusHistory[o.statusHistory.length - 1].createdAt : o.receivedAt;
    if (atRaw && at < last) {
      throw new ConflictException({
        code: 'STALE',
        message: `La orden ya tenía un cambio más reciente en el servidor (${o.status}); se conservó ese.`,
        serverStatus: o.status,
      });
    }
    if (!canTransition(o.status, to)) throw new BadRequestException(`No se puede pasar de ${o.status} a ${to}`);
    try {
      const updated = await this.repo.applyStatus({
        tenantId: user.tenantId, id, from: o.status, to, userId: user.sub, note, at,
        times: timesForTransition(to, { receivedAt: o.receivedAt, startedAt: o.startedAt }, at),
      });
      return view(updated);
    } catch (e: any) {
      if (e?.message === 'STATE_CONFLICT') throw new ConflictException({ code: 'STALE', message: 'La orden cambió de estado, actualice e intente de nuevo' });
      throw e;
    }
  }

  async assign(user: AuthUser, id: string, assignedToId: string | null) {
    await this.load(user, id);
    if (assignedToId && !(await this.repo.washerBelongsToTenant(user.tenantId, assignedToId))) throw new BadRequestException('Lavador inválido');
    await this.repo.assign(user.tenantId, id, user.sub, assignedToId);
    return this.get(user, id);
  }

  /** Idempotente por `photoId`: si la foto ya se registro devuelve la existente (duplicate = true). */
  async addPhoto(user: AuthUser, id: string, type: string, relativePath: string, opts: { photoId?: string; takenAt?: string } = {}) {
    await this.load(user, id);
    if (opts.photoId) {
      const existing = await this.repo.findPhoto(opts.photoId);
      if (existing) {
        if (existing.tenantId !== user.tenantId || existing.orderId !== id) throw new ConflictException('Identificador de foto en uso');
        return { photo: existing, duplicate: true };
      }
    }
    try {
      const photo = await this.repo.addPhoto(user.tenantId, id, user.sub, type, relativePath, {
        id: opts.photoId,
        takenAt: opts.takenAt ? clampTime(opts.takenAt) : undefined,
      });
      return { photo, duplicate: false };
    } catch (e: any) {
      if (opts.photoId && e?.code === 'P2002') {
        const existing = await this.repo.findPhoto(opts.photoId);
        if (existing && existing.tenantId === user.tenantId && existing.orderId === id) return { photo: existing, duplicate: true };
      }
      throw e;
    }
  }

  async addPayment(user: AuthUser, id: string, dto: PaymentDto) {
    const o = await this.load(user, id);
    const paid = o.payments.reduce((s: number, p: any) => s + Number(p.amount), 0);
    const amount = dto.amount ?? Math.max(Number(o.total) - paid, 0);
    if (amount <= 0) throw new BadRequestException('La orden ya está pagada');
    const due = Math.round((Number(o.total) - paid) * 100) / 100;
    if (amount > due + 0.005) throw new BadRequestException(`El monto excede el saldo pendiente ($${due.toFixed(2)})`);
    await this.repo.addPayment(user.tenantId, id, user.sub, { method: dto.method, amount, reference: dto.reference });
    return this.get(user, id);
  }

  /** Elimina órdenes (lógico, junto con sus cobros). Requiere orders:delete; respeta «solo las asignadas». */
  async remove(user: AuthUser, ids: string[]) {
    const unique = [...new Set(ids)];
    for (const id of unique) await this.load(user, id);
    const count = await this.repo.softDelete(user.tenantId, unique, user.sub);
    return { count };
  }

  /** Archiva (o desarchiva) ordenes. Solo se archivan las finalizadas y pagadas: las pendientes de cobro siguen visibles. */
  async archive(user: AuthUser, ids: string[], archived: boolean) {
    const unique = [...new Set(ids)];
    if (archived) {
      const bad: string[] = [];
      for (const id of unique) {
        const o = await this.load(user, id);
        const paid = o.payments.reduce((s: number, p: any) => s + Number(p.amount), 0);
        if (normalizeStatus(o.status) !== 'FINALIZADO' || Number(o.total) - paid > 0.005) bad.push(o.folio ?? o.code);
      }
      if (bad.length) throw new BadRequestException(`Solo se archivan órdenes finalizadas y pagadas. No cumplen: ${bad.slice(0, 5).join(', ')}${bad.length > 5 ? '…' : ''}`);
    } else {
      for (const id of unique) await this.load(user, id);
    }
    const count = await this.repo.setArchived(user.tenantId, unique, archived, user.sub);
    return { count };
  }

  /** Cambia el precio de un renglon mientras la orden siga pendiente de cobro (el catalogo no se toca). */
  async changeItemPrice(user: AuthUser, id: string, itemId: string, unitPrice: number) {
    const o = await this.load(user, id);
    const item = o.items.find((x: any) => x.id === itemId);
    if (!item) throw new NotFoundException('Renglón no encontrado');
    const paid = o.payments.reduce((s: number, p: any) => s + Number(p.amount), 0);
    const lines = o.items.map((x: any) => ({ unitPrice: x.id === itemId ? unitPrice : Number(x.unitPrice), quantity: x.quantity }));
    const totals = computeTotals(lines, Number(o.discount), Number(o.taxRate));
    if (totals.total + 0.005 < paid) throw new BadRequestException('El nuevo total sería menor a lo ya cobrado');
    await this.repo.updateItemPrice(user.tenantId, id, itemId, user.sub, unitPrice, totals);
    return this.get(user, id);
  }

  /** Enlaces wa.me y mailto: con mensaje precargado. El empleado solo confirma el envio. */
  async notifications(user: AuthUser, id: string) {
    const o = await this.load(user, id);
    const s = await this.repo.tenantSettings(user.tenantId);
    const name = o.client?.name?.trim().split(' ')[0] || 'cliente';
    const message =
      `Hola ${name}.\n\nSu vehículo ${o.vehicle.brand} ${o.vehicle.model} placas ${o.vehicle.plate} se encuentra listo para entrega.\n\nFolio ${o.folio}.\n\nGracias por su preferencia.`;
    const subject = `Su vehículo está listo - Folio ${o.folio}`;
    let phone = (o.client?.phone ?? '').replace(/\D/g, '');
    if (phone.length === 10) phone = s.countryCode + phone;
    return {
      preference: o.client?.contactPreference ?? 'NONE',
      clientName: o.client?.name ?? null,
      message,
      subject,
      whatsapp: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : null,
      email: o.client?.email ? `mailto:${o.client.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(message)}` : null,
    };
  }
}
