import type { LocalOrder, LocalPhoto, OutboxOp } from './db';
import { timesFor } from './rules';

const byAt = (a: OutboxOp, b: OutboxOp) => Date.parse(a.at) - Date.parse(b.at);

/**
 * Orden "efectiva" = lo que dice el servidor (o la copia local si aun no existe alla)
 * + los cambios pendientes de sincronizar aplicados encima (estatus y fotos).
 */
export function mergeOrder(server: any | undefined, local: LocalOrder | undefined, ops: OutboxOp[], photos: LocalPhoto[]) {
  const base = server ?? local?.data;
  if (!base) return undefined;
  let o: any = { ...base, statusHistory: [...(base.statusHistory ?? [])], photos: [...(base.photos ?? [])] };

  const statusOps = ops.filter((op) => op.type === 'order.status' && op.status === 'pending').sort(byAt);
  for (const op of statusOps) {
    const to: string = op.payload.status;
    if (o.status === to) continue; // el servidor ya lo refleja
    const at = new Date(op.at);
    const t = timesFor(to, { receivedAt: new Date(o.receivedAt), startedAt: o.startedAt ? new Date(o.startedAt) : null }, at);
    o = {
      ...o,
      status: to,
      ...(t.startedAt ? { startedAt: t.startedAt.toISOString() } : {}),
      ...(t.finishedAt ? { finishedAt: t.finishedAt.toISOString(), totalSeconds: t.totalSeconds } : {}),
      ...(t.deliveredAt ? { deliveredAt: t.deliveredAt.toISOString() } : {}),
      statusHistory: [...o.statusHistory, { id: `local-${op.opId}`, fromStatus: o.status, toStatus: to, createdAt: op.at, local: true }],
    };
  }

  const have = new Set(o.photos.map((p: any) => p.id));
  for (const p of photos) if (!have.has(p.id)) o.photos.push({ id: p.id, type: p.type, blob: p.blob, local: true });

  o.pending = !server || ops.some((op) => op.status === 'pending');
  o.syncProblem = ops.some((op) => op.status !== 'pending');
  return o;
}

export interface ListFilter {
  search?: string;
  status?: string;
  active?: boolean;
  from?: string;
  to?: string;
  assignedToId?: string;
}

function matches(o: any, f: ListFilter) {
  if (f.status && o.status !== f.status) return false;
  // activas = por finalizar + finalizadas en las últimas 36 h (igual que el servidor)
  if (f.active && (o.status === 'FINALIZADO' || o.status === 'ENTREGADO') && o.finishedAt && Date.now() - Date.parse(o.finishedAt) > 36 * 3600_000) return false;
  if (f.assignedToId && o.assignedToId !== f.assignedToId) return false;
  const t = Date.parse(o.receivedAt);
  // fechas YYYY-MM-DD en hora local (mismo criterio que el filtro por días de la pantalla)
  if (f.from && t < new Date(f.from + 'T00:00:00').getTime()) return false;
  if (f.to && t >= new Date(f.to + 'T00:00:00').getTime() + 86_400_000) return false;
  const q = f.search?.trim().toLowerCase();
  if (q) {
    const hay = [o.folio, o.code, o.vehicle?.plate, o.client?.name].filter(Boolean).join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

/** Lista = ordenes del servidor + ordenes creadas sin conexion, con los estatus pendientes ya aplicados. */
export function mergeOrderList(serverRows: any[] | undefined, locals: LocalOrder[], ops: OutboxOp[], filter: ListFilter = {}) {
  const rows = [...(serverRows ?? [])];
  const known = new Set(rows.map((r) => r.id));
  for (const l of locals) if (!known.has(l.id)) rows.push({ ...l.data, pending: true });

  const statusByOrder = new Map<string, OutboxOp[]>();
  for (const op of ops) if (op.type === 'order.status' && op.status === 'pending') {
    statusByOrder.set(op.entityId, [...(statusByOrder.get(op.entityId) ?? []), op]);
  }
  const merged = rows.map((r) => {
    const list = statusByOrder.get(r.id);
    if (!list?.length) return r;
    const last = [...list].sort(byAt).pop()!;
    return { ...r, status: last.payload.status, pending: true };
  });
  return merged.filter((o) => matches(o, filter)).sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
}
