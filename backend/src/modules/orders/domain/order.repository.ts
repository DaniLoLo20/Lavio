import { Totals, StatusTimes, OrderStatusValue } from './order-rules';

export interface NewOrderInput {
  tenantId: string;
  userId: string;
  /** Id generado por el cliente (offline-first). Hace la creacion idempotente. */
  id?: string;
  /** Codigo de consulta generado por el cliente; se descarta si ya existe. */
  code?: string;
  /** Momento real de recepcion (puede ser anterior a "ahora" si se capturo sin conexion). */
  receivedAt?: Date;
  vehicle: { plate: string; brand: string; model: string; color: string } | null;
  client: { id?: string; name?: string; phone?: string; email?: string; contactPreference?: string } | null;
  notes?: string;
  assignedToId?: string | null;
  items: { serviceId: string; name: string; unitPrice: number; quantity: number; total: number }[];
  totals: Totals;
  payment?: { method: string; amount: number; reference?: string } | null;
}

export interface OrderFilter {
  tenantId: string;
  status?: string;
  active?: boolean;
  search?: string;
  from?: Date;
  to?: Date;
  assignedToId?: string;
  /** true = solo archivadas; false/ausente = solo no archivadas */
  archived?: boolean;
  limit: number;
}

/** Puerto del repositorio (la capa de aplicacion depende de esta abstraccion, no de Prisma). */
export abstract class WashOrderRepository {
  abstract create(input: NewOrderInput): Promise<any>;
  abstract findById(tenantId: string, id: string): Promise<any | null>;
  abstract findMany(filter: OrderFilter): Promise<any[]>;
  abstract findByCode(code: string): Promise<any | null>;
  abstract applyStatus(args: {
    tenantId: string; id: string; from: OrderStatusValue; to: OrderStatusValue;
    userId: string; note?: string; times: StatusTimes; at: Date;
  }): Promise<any>;
  abstract assign(tenantId: string, id: string, userId: string, assignedToId: string | null): Promise<void>;
  abstract findPhoto(photoId: string): Promise<{ id: string; tenantId: string; orderId: string } | null>;
  abstract addPhoto(tenantId: string, orderId: string, userId: string, type: string, path: string, opts?: { id?: string; takenAt?: Date }): Promise<any>;
  abstract addPayment(tenantId: string, orderId: string, userId: string, p: { method: string; amount: number; reference?: string }): Promise<any>;
  abstract updateItemPrice(tenantId: string, orderId: string, itemId: string, userId: string, unitPrice: number, totals: { subtotal: number; discount: number; taxRate: number; taxAmount: number; total: number }): Promise<void>;
  abstract softDelete(tenantId: string, ids: string[], userId: string): Promise<number>;
  abstract setArchived(tenantId: string, ids: string[], archived: boolean, userId: string): Promise<number>;
  abstract washerBelongsToTenant(tenantId: string, userId: string): Promise<boolean>;
  abstract tenantSettings(tenantId: string): Promise<{ taxRate: number; countryCode: string; name: string }>;
  abstract activeServices(tenantId: string, ids: string[]): Promise<{ id: string; name: string; price: number; requiresVehicle: boolean }[]>;
}
