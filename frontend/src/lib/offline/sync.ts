import { useSyncExternalStore } from 'react';
import type { QueryClient } from '@tanstack/react-query';
import { ApiError, api } from '../api';
import { clock, net } from '../net';
import { readSession } from '../session';
import { getDb, type LocalOrder, type OutboxOp } from './db';
import { computeTotals, genCode, normalizePlate, r2, uuid4 } from './rules';

/* ───────────────────────── estado observable de la sincronizacion ───────────────────────── */

export interface SyncSnapshot {
  syncing: boolean;
  authExpired: boolean;
  /** operaciones del usuario actual por enviar */
  pending: number;
  /** rechazadas o con conflicto: requieren revision */
  problems: number;
}

let snap: SyncSnapshot = { syncing: false, authExpired: false, pending: 0, problems: 0 };
const subs = new Set<() => void>();
function setSnap(p: Partial<SyncSnapshot>) {
  const next = { ...snap, ...p };
  if (next.syncing === snap.syncing && next.authExpired === snap.authExpired && next.pending === snap.pending && next.problems === snap.problems) return;
  snap = next;
  subs.forEach((l) => l());
}
export const syncStore = {
  subscribe(l: () => void) { subs.add(l); return () => { subs.delete(l); }; },
  get: () => snap,
  setCounts(pending: number, problems: number) { setSnap({ pending, problems }); },
};
const SERVER_SNAP: SyncSnapshot = { syncing: false, authExpired: false, pending: 0, problems: 0 };
export const useSyncState = () => useSyncExternalStore(syncStore.subscribe, syncStore.get, () => SERVER_SNAP);

let qc: QueryClient | null = null;
export const bindQueryClient = (c: QueryClient) => { qc = c; };

/* ───────────────────────── acciones del usuario (siempre se guardan primero en local) ───────────────────────── */

function requireSession() {
  const s = readSession();
  if (!s) throw new Error('Sesión no disponible en este dispositivo. Inicie sesión.');
  return s;
}

async function enqueue(op: Omit<OutboxOp, 'seq' | 'status' | 'attempts'>) {
  await getDb().outbox.add({ ...op, status: 'pending', attempts: 0 });
  registerBackgroundSync();
  void flush();
}

export interface CreateOrderInput {
  vehicle: { plate: string; brand: string; model: string; color: string };
  client?: { name?: string; phone?: string; email?: string; contactPreference?: string } | null;
  notes?: string;
  items: { serviceId: string; name: string; price: number; quantity: number; priceEdited?: boolean }[];
  discount: number;
  taxRate: number;
  assignedToId?: string;
  assignedToName?: string;
  payment?: { method: string } | null;
}

/**
 * Crea la orden en el dispositivo (id, codigo y hora generados aqui) y la encola.
 * El `id` es la clave de idempotencia: aunque la sincronizacion se reintente, el servidor no duplica.
 */
export async function createOrderOffline(input: CreateOrderInput) {
  const s = requireSession();
  const id = uuid4();
  const opId = uuid4();
  const code = genCode();
  const at = new Date().toISOString();
  const lines = input.items.map((i, n) => ({ id: `local-${n}`, serviceId: i.serviceId, name: i.name, unitPrice: i.price, quantity: i.quantity, total: r2(i.price * i.quantity) }));
  const totals = computeTotals(lines, input.discount, input.taxRate);
  const c = input.client;
  const hasClient = !!(c && (c.name || c.phone || c.email));

  const data = {
    id, tenantId: s.tenantId, folio: null as string | null, code, status: 'RECIBIDO',
    notes: input.notes ?? null, ...totals,
    receivedAt: at, startedAt: null, finishedAt: null, deliveredAt: null, totalSeconds: null,
    assignedToId: input.assignedToId ?? null,
    assignedTo: input.assignedToId ? { id: input.assignedToId, fullName: input.assignedToName ?? '' } : null,
    vehicle: { ...input.vehicle, plate: normalizePlate(input.vehicle.plate) },
    client: hasClient ? { name: c!.name ?? null, phone: c!.phone ?? null, email: c!.email ?? null, contactPreference: c!.contactPreference ?? 'NONE' } : null,
    items: lines,
    payments: input.payment ? [{ id: 'local-pay', method: input.payment.method, amount: totals.total, paidAt: at }] : [],
    photos: [],
    statusHistory: [{ id: 'local-h0', fromStatus: null, toStatus: 'RECIBIDO', createdAt: at }],
  };
  const db = getDb();
  await db.transaction('rw', db.orders, db.outbox, async () => {
    await db.orders.put({ id, tenantId: s.tenantId, userId: s.id, data, createdAt: at });
    await db.outbox.add({
      opId, type: 'order.create', entityId: id, tenantId: s.tenantId, userId: s.id, at, status: 'pending', attempts: 0,
      payload: {
        vehicle: input.vehicle,
        client: hasClient ? c : undefined,
        notes: input.notes || undefined,
        items: input.items.map((i) => ({ serviceId: i.serviceId, quantity: i.quantity, ...(i.priceEdited ? { unitPrice: i.price } : {}) })),
        discount: input.discount,
        assignedToId: input.assignedToId || undefined,
        payment: input.payment ?? undefined,
        code,
      },
    });
  });
  registerBackgroundSync();
  void flush();
  return { id, code, opId };
}

export async function changeStatusOffline(orderId: string, status: string, note?: string) {
  const s = requireSession();
  const opId = uuid4();
  await enqueue({ opId, type: 'order.status', entityId: orderId, tenantId: s.tenantId, userId: s.id, at: new Date().toISOString(), payload: { status, note } });
  return opId;
}

export async function addPhotoOffline(orderId: string, type: string, blob: Blob) {
  const s = requireSession();
  const photoId = uuid4();
  const opId = uuid4();
  const at = new Date().toISOString();
  const db = getDb();
  await db.transaction('rw', db.photos, db.outbox, async () => {
    await db.photos.put({ id: photoId, orderId, tenantId: s.tenantId, type, blob, takenAt: at });
    await db.outbox.add({ opId, type: 'order.photo', entityId: orderId, tenantId: s.tenantId, userId: s.id, at, status: 'pending', attempts: 0, payload: { photoId } });
  });
  registerBackgroundSync();
  void flush();
  return opId;
}

/** Espera (hasta `timeoutMs`) a que una operacion se sincronice; util para mostrar el folio si hay conexion. */
export async function waitForOp(opId: string, timeoutMs = 4000): Promise<{ state: 'synced' | 'failed' | 'pending'; error?: string }> {
  const db = getDb();
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const op = await db.outbox.where('opId').equals(opId).first();
    if (!op) return { state: 'synced' };
    if (op.status !== 'pending') return { state: 'failed', error: op.error };
    await new Promise((r) => setTimeout(r, 150));
  }
  return { state: 'pending' };
}

/* ───────────────────────── motor de sincronizacion ───────────────────────── */

type Outcome =
  | { kind: 'ok' }
  | { kind: 'network' }
  | { kind: 'auth' }
  | { kind: 'retry'; error: string }
  | { kind: 'fatal'; error: string; conflict: boolean };

function classify(e: unknown): Outcome {
  if (e instanceof ApiError) {
    if (e.status === 0) return { kind: 'network' };
    if (e.status === 401) return { kind: 'auth' };
    if (e.status === 408 || e.status === 425 || e.status === 429 || e.status >= 500) return { kind: 'retry', error: e.message };
    return { kind: 'fatal', error: e.message, conflict: e.status === 409 && e.code === 'STALE' };
  }
  return { kind: 'retry', error: e instanceof Error ? e.message : String(e) };
}

/** Corrige el reloj del dispositivo con la hora del servidor antes de enviar marcas de tiempo. */
const adjust = (iso: string) => new Date(Date.parse(iso) + clock.skew).toISOString();

async function send(op: OutboxOp): Promise<void> {
  const db = getDb();
  const common = { redirectOn401: false };
  if (op.type === 'order.create') {
    const order = await api('/orders', { ...common, body: { ...op.payload, id: op.entityId, createdAt: adjust(op.at) } });
    qc?.setQueryData(['order', op.entityId], order);
    await db.orders.delete(op.entityId);
  } else if (op.type === 'order.status') {
    const order = await api(`/orders/${op.entityId}/status`, { ...common, method: 'PATCH', body: { status: op.payload.status, note: op.payload.note, at: adjust(op.at) } });
    qc?.setQueryData(['order', op.entityId], order);
  } else if (op.type === 'order.photo') {
    const photo = await db.photos.get(op.payload.photoId);
    if (!photo) return; // ya se subio en un intento anterior
    const form = new FormData();
    form.append('id', photo.id);
    form.append('type', photo.type);
    form.append('takenAt', adjust(photo.takenAt));
    form.append('file', photo.blob, 'photo.jpg');
    await api(`/orders/${op.entityId}/photos`, { ...common, form });
    await qc?.invalidateQueries({ queryKey: ['order', op.entityId] }); // trae la foto del servidor antes de borrar la local
    await db.photos.delete(photo.id);
  }
}

let running: Promise<void> | null = null;

/** Procesa la cola en orden. Seguro de llamar muchas veces: solo corre una sincronizacion a la vez. */
export function flush(): Promise<void> {
  if (running) return running;
  running = (async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.locks) await navigator.locks.request('lavio-sync', () => doFlush());
      else await doFlush();
    } finally {
      running = null;
      setSnap({ syncing: false });
    }
  })();
  return running;
}

async function doFlush() {
  const me = readSession();
  if (!me || typeof navigator === 'undefined' || navigator.onLine === false) return;
  const db = getDb();
  setSnap({ syncing: true });
  let sent = 0;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const ops = await db.outbox.where('status').equals('pending').filter((o) => o.tenantId === me.tenantId && o.userId === me.id).sortBy('seq');
    const op = ops[0];
    if (!op) break;
    if (op.nextAttemptAt && op.nextAttemptAt > Date.now()) break; // en espera por reintento con retroceso

    let out: Outcome;
    try {
      await send(op);
      out = { kind: 'ok' };
    } catch (e) {
      out = classify(e);
    }

    if (out.kind === 'ok') {
      await db.outbox.delete(op.seq!);
      sent++;
      setSnap({ authExpired: false });
      continue;
    }
    if (out.kind === 'network') break;
    if (out.kind === 'auth') { setSnap({ authExpired: true }); break; }
    if (out.kind === 'retry') {
      const attempts = op.attempts + 1;
      await db.outbox.update(op.seq!, { attempts, error: out.error, nextAttemptAt: Date.now() + Math.min(2 ** attempts * 5_000, 300_000) });
      break;
    }
    // Rechazo definitivo: no se pierde nada (la orden/foto local se conserva) y se deja a la vista para revisar.
    await db.outbox.update(op.seq!, { status: out.conflict ? 'conflict' : 'failed', error: out.error, attempts: op.attempts + 1 });
    if (op.type === 'order.create') {
      // Lo que depende de una orden que no se pudo crear tampoco puede enviarse
      const deps = await db.outbox.where('entityId').equals(op.entityId).filter((o) => o.status === 'pending' && o.seq !== op.seq).toArray();
      for (const d of deps) await db.outbox.update(d.seq!, { status: 'failed', error: 'Depende de una orden que no se pudo sincronizar' });
    }
  }

  if (sent > 0 || net.up) {
    // Con la cola vacia, refresca los datos del servidor (ordenes, dashboard, etc.)
    const left = await db.outbox.where('status').equals('pending').count();
    if (left === 0 && qc) void qc.invalidateQueries();
  }
}

/** Reintenta una operacion rechazada (y las que dependian de ella). */
export async function retryOp(seq: number) {
  const db = getDb();
  const op = await db.outbox.get(seq);
  if (!op) return;
  await db.outbox.update(seq, { status: 'pending', attempts: 0, error: undefined, nextAttemptAt: undefined });
  const deps = await db.outbox.where('entityId').equals(op.entityId).filter((o) => o.status === 'failed' && !!o.error?.startsWith('Depende')).toArray();
  for (const d of deps) await db.outbox.update(d.seq!, { status: 'pending', error: undefined, attempts: 0 });
  void flush();
}

/** Descarta una operacion. Si era la creacion de una orden elimina tambien la orden local y sus fotos. */
export async function discardOp(seq: number) {
  const db = getDb();
  const op = await db.outbox.get(seq);
  if (!op) return;
  await db.transaction('rw', db.outbox, db.orders, db.photos, async () => {
    if (op.type === 'order.create') {
      const related = await db.outbox.where('entityId').equals(op.entityId).toArray();
      await db.outbox.bulkDelete(related.map((r) => r.seq!));
      await db.orders.delete(op.entityId);
      await db.photos.where('orderId').equals(op.entityId).delete();
    } else {
      if (op.type === 'order.photo') await db.photos.delete(op.payload.photoId);
      await db.outbox.delete(seq);
    }
  });
}

function registerBackgroundSync() {
  // Background Sync (Chrome/Android): el service worker avisa a la app cuando vuelve la red
  try {
    navigator.serviceWorker?.ready.then((reg: any) => reg.sync?.register('lavio-sync')).catch(() => undefined);
  } catch { /* no soportado */ }
}

export type { LocalOrder };
