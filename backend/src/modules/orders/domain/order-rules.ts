// Capa de dominio: reglas puras, sin dependencias de framework ni base de datos.

export const ORDER_STATUSES = ['RECIBIDO', 'EN_ESPERA', 'EN_PROCESO', 'SECADO', 'FINALIZADO', 'ENTREGADO'] as const;
export type OrderStatusValue = (typeof ORDER_STATUSES)[number];

/**
 * Solo hay dos estatus de trabajo: RECIBIDO y FINALIZADO. Los demas valores del enum se conservan en la base
 * solo por compatibilidad y se migran al arrancar (EN_ESPERA/EN_PROCESO/SECADO -> RECIBIDO, ENTREGADO -> FINALIZADO).
 */
const TRANSITIONS: Record<OrderStatusValue, OrderStatusValue[]> = {
  RECIBIDO: ['FINALIZADO'],
  FINALIZADO: ['RECIBIDO'], // reabrir (requiere orders:deliver)
  EN_ESPERA: ['FINALIZADO', 'RECIBIDO'],
  EN_PROCESO: ['FINALIZADO', 'RECIBIDO'],
  SECADO: ['FINALIZADO', 'RECIBIDO'],
  ENTREGADO: ['RECIBIDO'],
};

/** Estatus antiguos que aun pueden llegar de operaciones en cola de dispositivos sin actualizar. */
const LEGACY: Record<string, OrderStatusValue> = { EN_ESPERA: 'RECIBIDO', EN_PROCESO: 'RECIBIDO', SECADO: 'RECIBIDO', ENTREGADO: 'FINALIZADO' };
export const normalizeStatus = (s: OrderStatusValue): OrderStatusValue => LEGACY[s] ?? s;

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
  if (to === 'RECIBIDO') return { finishedAt: null, totalSeconds: null };
  if (to === 'FINALIZADO') {
    const start = current.startedAt ?? current.receivedAt;
    return { finishedAt: now, totalSeconds: Math.max(0, Math.round((now.getTime() - start.getTime()) / 1000)) };
  }
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
