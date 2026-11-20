import Dexie, { type Table } from 'dexie';

export type OpType = 'order.create' | 'order.status' | 'order.photo';
/** pending = por enviar | failed = el servidor la rechazo | conflict = el servidor tenia un cambio mas reciente */
export type OpStatus = 'pending' | 'failed' | 'conflict';

/** Cola de sincronizacion (sync queue). Se procesa en orden de `seq`. */
export interface OutboxOp {
  seq?: number;
  opId: string;
  type: OpType;
  /** Orden a la que pertenece (en 'order.create' es el id de la nueva orden) */
  entityId: string;
  tenantId: string;
  userId: string;
  payload: any;
  /** Momento real en que el usuario hizo la accion (ISO), base de la resolucion por timestamps */
  at: string;
  status: OpStatus;
  attempts: number;
  error?: string;
  nextAttemptAt?: number;
}

/** Orden creada sin conexion y aun no confirmada por el servidor. */
export interface LocalOrder {
  id: string;
  tenantId: string;
  userId: string;
  data: any;
  createdAt: string;
}

/** Foto capturada en el dispositivo hasta que se sube. */
export interface LocalPhoto {
  id: string;
  orderId: string;
  tenantId: string;
  type: string;
  blob: Blob;
  takenAt: string;
}

class LavioDB extends Dexie {
  outbox!: Table<OutboxOp, number>;
  orders!: Table<LocalOrder, string>;
  photos!: Table<LocalPhoto, string>;
  kv!: Table<{ key: string; value: any }, string>;

  constructor() {
    super('lavio');
    this.version(1).stores({
      outbox: '++seq, opId, entityId, status, tenantId',
      orders: 'id, tenantId',
      photos: 'id, orderId, tenantId',
      kv: 'key',
    });
  }
}

let instance: LavioDB | null = null;
/** Perezoso: en el servidor (SSR) no existe IndexedDB. */
export function getDb(): LavioDB {
  if (!instance) instance = new LavioDB();
  return instance;
}

export const RQ_CACHE_KEY = 'lavio-rq-cache';
