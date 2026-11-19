// Capa de dominio: reglas puras, sin dependencias de framework ni base de datos.

export const ORDER_STATUSES = ['RECIBIDO', 'EN_ESPERA', 'EN_PROCESO', 'SECADO', 'FINALIZADO', 'ENTREGADO'] as const;
export type OrderStatusValue = (typeof ORDER_STATUSES)[number];

const TRANSITIONS: Record<OrderStatusValue, OrderStatusValue[]> = {
  RECIBIDO: ['EN_ESPERA', 'EN_PROCESO'],
  EN_ESPERA: ['EN_PROCESO'],
  EN_PROCESO: ['SECADO', 'EN_ESPERA'],
  SECADO: ['FINALIZADO', 'EN_PROCESO'],
  FINALIZADO: ['ENTREGADO'],
  ENTREGADO: [],
};

export const WASHER_FORBIDDEN: OrderStatusValue[] = ['ENTREGADO'];

export function canTransition(from: OrderStatusValue, to: OrderStatusValue): boolean {
  return TRANSITIONS[from].includes(to);
}

export interface StatusTimes {
  startedAt?: Date | null;
  finishedAt?: Date | null;
  deliveredAt?: Date | null;
  totalSeconds?: number | null;
}

/** Calcula los campos de tiempo que cambian al pasar a `to`. */
export function timesForTransition(
  to: OrderStatusValue,
  current: { receivedAt: Date; startedAt: Date | null },
  now = new Date(),
): StatusTimes {
  if (to === 'EN_PROCESO' && !current.startedAt) return { startedAt: now };
  if (to === 'FINALIZADO') {
    const start = current.startedAt ?? current.receivedAt;
    return { finishedAt: now, totalSeconds: Math.max(0, Math.round((now.getTime() - start.getTime()) / 1000)) };
  }
  if (to === 'ENTREGADO') return { deliveredAt: now };
  return {};
}

export interface Totals {
  subtotal: number;
  discount: number;
  taxRate: number;
  taxAmount: number;
  total: number;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

/** total = (subtotal - descuento) + impuesto. El descuento no puede superar el subtotal. */
export function computeTotals(lines: { unitPrice: number; quantity: number }[], discount: number, taxRate: number): Totals {
  const subtotal = r2(lines.reduce((s, l) => s + l.unitPrice * l.quantity, 0));
  const disc = r2(Math.min(Math.max(discount, 0), subtotal));
  const base = subtotal - disc;
  const taxAmount = r2((base * taxRate) / 100);
  return { subtotal, discount: disc, taxRate, taxAmount, total: r2(base + taxAmount) };
}

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0/O/1/I/L
export function generateCode(length = 6): string {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { randomInt } = require('crypto');
  return Array.from({ length }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}

export const formatFolio = (n: number) => `AL-${String(n).padStart(6, '0')}`;

export const normalizePlate = (p: string) => p.toUpperCase().replace(/[^A-Z0-9]/g, '');
