import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.module';
import { NewOrderInput, OrderFilter, WashOrderRepository } from '../domain/order.repository';
import { formatFolio, generateCode, normalizePlate } from '../domain/order-rules';

const DETAIL = {
  vehicle: true,
  client: true,
  assignedTo: { select: { id: true, fullName: true } },
  items: { orderBy: { createdAt: 'asc' } },
  payments: { where: { deletedAt: null }, orderBy: { paidAt: 'asc' } },
  photos: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
  statusHistory: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.WashOrderInclude;

const isUniqueViolation = (e: any) => e?.code === 'P2002';

@Injectable()
export class PrismaOrderRepository extends WashOrderRepository {
  constructor(private prisma: PrismaService) {
    super();
  }

  /**
   * Idempotente cuando viene `id`: reintentar la misma creacion (por una sincronizacion offline
   * interrumpida) devuelve la orden ya creada en lugar de duplicarla.
   */
  async create(i: NewOrderInput) {
    if (i.id) {
      const existing = await this.prisma.washOrder.findUnique({ where: { id: i.id }, select: { tenantId: true } });
      if (existing) {
        if (existing.tenantId !== i.tenantId) throw new ConflictException('Identificador de orden en uso');
        return this.findById(i.tenantId, i.id);
      }
    }
    try {
      const id = await this.createInTx(i);
      return this.findById(i.tenantId, id);
    } catch (e) {
      // Dos reintentos simultaneos: el segundo choca con la llave primaria; devolvemos la orden ya creada
      if (i.id && isUniqueViolation(e)) {
        const again = await this.findById(i.tenantId, i.id);
        if (again) return again;
      }
      throw e;
    }
  }

  private createInTx(i: NewOrderInput): Promise<string> {
    return this.prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.update({
        where: { id: i.tenantId },
        data: { orderSeq: { increment: 1 } },
        select: { orderSeq: true },
      });
      const folio = formatFolio(tenant.orderSeq);
      let code = i.code && !(await tx.washOrder.findUnique({ where: { code: i.code } })) ? i.code : generateCode();
      while (await tx.washOrder.findUnique({ where: { code } })) code = generateCode();
      const receivedAt = i.receivedAt ?? new Date();

      let clientId: string | null = null;
      if (i.client) {
        const byId = i.client.id ? await tx.client.findFirst({ where: { id: i.client.id, tenantId: i.tenantId, deletedAt: null } }) : null;
        const existing = byId ?? (i.client.phone
          ? await tx.client.findFirst({ where: { tenantId: i.tenantId, phone: i.client.phone, deletedAt: null } })
          : null);
        const { id: _clientId, ...data }: any = { ...i.client };
        if (existing) {
          const patch = Object.fromEntries(Object.entries(data).filter(([, v]) => v));
          await tx.client.update({ where: { id: existing.id }, data: { ...patch, updatedById: i.userId } });
          clientId = existing.id;
        } else {
          clientId = (await tx.client.create({ data: { ...data, tenantId: i.tenantId, createdById: i.userId } })).id;
        }
      }

      const plate = normalizePlate(i.vehicle.plate);
      const found = await tx.vehicle.findFirst({ where: { tenantId: i.tenantId, plate, deletedAt: null } });
      const vData = { brand: i.vehicle.brand, model: i.vehicle.model, color: i.vehicle.color, ...(clientId ? { clientId } : {}) };
      const vehicle = found
        ? await tx.vehicle.update({ where: { id: found.id }, data: { ...vData, updatedById: i.userId } })
        : await tx.vehicle.create({ data: { ...vData, plate, tenantId: i.tenantId, createdById: i.userId } });

      const order = await tx.washOrder.create({
        data: {
          ...(i.id ? { id: i.id } : {}),
          tenantId: i.tenantId,
          folio,
          code,
          vehicleId: vehicle.id,
          clientId,
          assignedToId: i.assignedToId ?? null,
          notes: i.notes,
          receivedAt,
          ...i.totals,
          createdById: i.userId,
          items: { create: i.items.map((it) => ({ ...it, tenantId: i.tenantId })) },
          statusHistory: { create: { tenantId: i.tenantId, toStatus: 'RECIBIDO', changedById: i.userId, createdAt: receivedAt } },
          ...(i.payment
            ? { payments: { create: { tenantId: i.tenantId, ...i.payment, method: i.payment.method as any, paidAt: receivedAt, createdById: i.userId } } }
            : {}),
        },
      });
      return order.id;
    });
  }

  findById(tenantId: string, id: string) {
    return this.prisma.washOrder.findFirst({ where: { id, tenantId, deletedAt: null }, include: DETAIL });
  }

  findByCode(code: string) {
    return this.prisma.washOrder.findFirst({
      where: { code, deletedAt: null },
      include: { ...DETAIL, tenant: { select: { name: true, logoPath: true } } },
    });
  }

  findMany(f: OrderFilter) {
    const search = f.search?.trim();
    return this.prisma.washOrder.findMany({
      where: {
        tenantId: f.tenantId,
        deletedAt: null,
        ...(f.status ? { status: f.status as any } : {}),
        ...(f.active ? { status: { not: 'ENTREGADO' } } : {}),
        ...(f.assignedToId ? { assignedToId: f.assignedToId } : {}),
        ...(f.from || f.to ? { receivedAt: { ...(f.from ? { gte: f.from } : {}), ...(f.to ? { lt: f.to } : {}) } } : {}),
        ...(search
          ? {
              OR: [
                { folio: { contains: search, mode: 'insensitive' } },
                { code: { contains: search.toUpperCase() } },
                { vehicle: { plate: { contains: normalizePlate(search) || search } } },
                { client: { name: { contains: search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      },
      include: {
        vehicle: true,
        client: { select: { id: true, name: true } },
        assignedTo: { select: { id: true, fullName: true } },
        items: { select: { name: true, quantity: true } },
      },
      orderBy: { receivedAt: 'desc' },
      take: f.limit,
    });
  }

  async applyStatus(a: Parameters<WashOrderRepository['applyStatus']>[0]) {
    await this.prisma.$transaction(async (tx) => {
      // Condicion por estado actual evita carreras (dos cambios simultaneos)
      const r = await tx.washOrder.updateMany({
        where: { id: a.id, tenantId: a.tenantId, status: a.from },
        data: { status: a.to, ...a.times, updatedById: a.userId },
      });
      if (!r.count) throw new Error('STATE_CONFLICT');
      await tx.washOrderStatusHistory.create({
        data: { tenantId: a.tenantId, orderId: a.id, fromStatus: a.from, toStatus: a.to, note: a.note, changedById: a.userId, createdAt: a.at },
      });
    });
    return this.findById(a.tenantId, a.id);
  }

  async assign(tenantId: string, id: string, userId: string, assignedToId: string | null) {
    await this.prisma.washOrder.updateMany({ where: { id, tenantId }, data: { assignedToId, updatedById: userId } });
  }

  findPhoto(photoId: string) {
    return this.prisma.washOrderPhoto.findUnique({ where: { id: photoId }, select: { id: true, tenantId: true, orderId: true } });
  }

  addPhoto(tenantId: string, orderId: string, userId: string, type: string, path: string, opts: { id?: string; takenAt?: Date } = {}) {
    return this.prisma.washOrderPhoto.create({
      data: { ...(opts.id ? { id: opts.id } : {}), tenantId, orderId, type: type as any, path, uploadedById: userId, ...(opts.takenAt ? { createdAt: opts.takenAt } : {}) },
    });
  }

  addPayment(tenantId: string, orderId: string, userId: string, p: { method: string; amount: number; reference?: string }) {
    return this.prisma.payment.create({
      data: { tenantId, orderId, method: p.method as any, amount: p.amount, reference: p.reference, createdById: userId },
    });
  }

  async washerBelongsToTenant(tenantId: string, userId: string) {
    return !!(await this.prisma.user.findFirst({ where: { id: userId, tenantId, deletedAt: null, isActive: true } }));
  }

  async tenantSettings(tenantId: string) {
    const t = await this.prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    return { taxRate: Number(t.taxRate), countryCode: t.countryCode, name: t.name };
  }

  async activeServices(tenantId: string, ids: string[]) {
    const rows = await this.prisma.service.findMany({ where: { tenantId, id: { in: ids }, isActive: true, deletedAt: null } });
    return rows.map((s) => ({ id: s.id, name: s.name, price: Number(s.price) }));
  }
}
