// Reglas de negocio replicadas en el cliente para operar sin conexion.
// El servidor es la autoridad: recalcula precios/totales y valida todo al sincronizar.

export const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function computeTotals(lines: { unitPrice: number; quantity: number }[], discount: number, taxRate: number) {
  const subtotal = r2(lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0));
  const disc = r2(Math.min(Math.max(discount, 0), subtotal));
  const base = subtotal - disc;
  const taxAmount = r2((base * taxRate) / 100);
  return { subtotal, discount: disc, taxRate, taxAmount, total: r2(base + taxAmount) };
}

export const normalizePlate = (p: string) => p.toUpperCase().replace(/[^A-Z0-9]/g, '');

/** UUID v4 (crypto.randomUUID solo existe en contextos seguros; en http://IP-LAN no). */
export function uuid4(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0'));
  return `${h.slice(0, 4).join('')}-${h.slice(4, 6).join('')}-${h.slice(6, 8).join('')}-${h.slice(8, 10).join('')}-${h.slice(10).join('')}`;
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // mismo alfabeto que el servidor (sin 0/O/1/I/L)
export function genCode(length = 6): string {
  const a = crypto.getRandomValues(new Uint32Array(length));
  return Array.from(a, (n) => ALPHABET[n % ALPHABET.length]).join('');
}

/** Tiempos que cambian al pasar a `to` (igual que el servidor). */
export function timesFor(to: string, cur: { receivedAt: Date; startedAt: Date | null }, at: Date) {
  const out: { startedAt?: Date; finishedAt?: Date; deliveredAt?: Date; totalSeconds?: number } = {};
  if (to === 'EN_PROCESO' && !cur.startedAt) out.startedAt = at;
  if (to === 'FINALIZADO') {
    const start = cur.startedAt ?? cur.receivedAt;
    out.finishedAt = at;
    out.totalSeconds = Math.max(0, Math.round((at.getTime() - start.getTime()) / 1000));
  }
  if (to === 'ENTREGADO') out.deliveredAt = at;
  return out;
}
