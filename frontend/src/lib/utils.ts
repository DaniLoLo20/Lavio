import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));

export const money = (n: number | string | null | undefined, currency = 'MXN') =>
  new Intl.NumberFormat('es-MX', { style: 'currency', currency }).format(Number(n ?? 0));

export const dateTime = (d?: string | Date | null) =>
  d ? new Date(d).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export function duration(seconds?: number | null) {
  if (seconds == null) return '—';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h ? `${h} h ${m} min` : `${m} min`;
}

export type Status = 'RECIBIDO' | 'EN_ESPERA' | 'EN_PROCESO' | 'SECADO' | 'FINALIZADO' | 'ENTREGADO';

export const STATUS: Record<Status, { label: string; cls: string }> = {
  RECIBIDO: { label: 'Recibido', cls: 'bg-slate-500/15 text-slate-600 dark:text-slate-300' },
  EN_ESPERA: { label: 'En espera', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300' },
  EN_PROCESO: { label: 'En proceso', cls: 'bg-blue-500/15 text-blue-700 dark:text-blue-300' },
  SECADO: { label: 'Secado', cls: 'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300' },
  FINALIZADO: { label: 'Finalizado', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
  ENTREGADO: { label: 'Entregado', cls: 'bg-violet-500/15 text-violet-700 dark:text-violet-300' },
};

/** Solo dos estatus de trabajo. Los demás se conservan únicamente para mostrar datos antiguos. */
export const STATUS_ORDER: Status[] = ['RECIBIDO', 'FINALIZADO'];

export const NEXT: Record<Status, Status[]> = {
  RECIBIDO: ['FINALIZADO'],
  FINALIZADO: ['RECIBIDO'], // reabrir
  EN_ESPERA: ['FINALIZADO'],
  EN_PROCESO: ['FINALIZADO'],
  SECADO: ['FINALIZADO'],
  ENTREGADO: ['RECIBIDO'],
};

export const PHOTO_TYPES = [
  { value: 'FRONT', label: 'Frontal' },
  { value: 'REAR', label: 'Trasera' },
  { value: 'LEFT', label: 'Lado izquierdo' },
  { value: 'RIGHT', label: 'Lado derecho' },
  { value: 'EXTRA', label: 'Adicional' },
];

export const METHODS: Record<string, string> = { CASH: 'Efectivo', CARD: 'Tarjeta', TRANSFER: 'Transferencia' };

/** Órdenes de servicios/productos «sin vehículo»: no tienen placa. */
export const hasVehicle = (o: any) => !!o?.vehicle?.plate;
/** «Nissan Versa» o «Venta sin vehículo». */
export const vehicleName = (o: any) => (hasVehicle(o) ? ` `.trim() : 'Venta sin vehículo');
/** Placa o un guion. */
export const plateOf = (o: any) => o?.vehicle?.plate || '—';
