import { METHODS } from './utils';

export interface TicketTenant {
  name: string;
  phone?: string | null;
  address?: string | null;
  taxId?: string | null;
  currency: string;
  countryCode?: string;
  logoUrl?: string | null;
}

const money = (n: number | string, cur = 'MXN') => new Intl.NumberFormat('es-MX', { style: 'currency', currency: cur }).format(Number(n ?? 0));
const when = (d?: string | Date | null) => (d ? new Date(d).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '');

export const orderPaid = (o: any) => (o.payments ?? []).reduce((s: number, p: any) => s + Number(p.amount), 0);

/** Ticket en texto plano (WhatsApp lo muestra con *negritas*). Sirve igual para el cuerpo del correo. */
export function ticketText(o: any, t: TicketTenant, trackUrl: string): string {
  const cur = t.currency;
  const lines = (o.items ?? []).map((i: any) => `${i.quantity} x ${i.name}  ${money(i.total, cur)}`);
  const paid = orderPaid(o);
  const due = Math.max(Number(o.total) - paid, 0);
  const methods = [...new Set((o.payments ?? []).map((p: any) => METHODS[p.method] ?? p.method))].join(', ');
  const out = [
    `*${t.name}*`,
    'Ticket de servicio',
    `Folio: ${o.folio ?? 'se asigna al sincronizar'}`,
    `Fecha: ${when(o.receivedAt)}`,
    o.vehicle?.plate ? `Vehículo: ${o.vehicle.brand} ${o.vehicle.model} · ${o.vehicle.plate}${o.vehicle.color ? ` · ${o.vehicle.color}` : ''}` : 'Venta sin vehículo',
    '',
    '*Servicios*',
    ...lines,
    '------------------------',
    `Subtotal: ${money(o.subtotal, cur)}`,
    ...(Number(o.discount) > 0 ? [`Descuento: -${money(o.discount, cur)}`] : []),
    `IVA (${Number(o.taxRate)}%): ${money(o.taxAmount, cur)}`,
    `*TOTAL: ${money(o.total, cur)}*`,
    due > 0.004 ? (paid > 0 ? `Pagado: ${money(paid, cur)} (${methods})\nSaldo pendiente: ${money(due, cur)}` : `Pago pendiente: ${money(due, cur)}`) : `Pagado: ${money(paid, cur)} (${methods})`,
    '',
    'Consulta el avance de tu vehículo:',
    `Código: ${o.code}`,
    trackUrl,
    '',
    '¡Gracias por su preferencia!',
  ];
  return out.join('\n');
}

/** Enlace wa.me con el mensaje precargado. Sin número abre el selector de contactos de WhatsApp. */
export function waLink(phone: string | null | undefined, countryCode: string | undefined, text: string) {
  let d = (phone ?? '').replace(/\D/g, '');
  if (d.length === 10) d = (countryCode || '52') + d;
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
}

export const mailLink = (email: string, subject: string, body: string) =>
  `mailto:${email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;

/** Imprime solo el ticket: se copia a un nodo temporal y el CSS de impresión oculta todo lo demás. */
export function printTicket(el: HTMLElement) {
  const clone = el.cloneNode(true) as HTMLElement;
  clone.id = 'ticket-print';
  document.body.appendChild(clone);
  document.body.classList.add('printing-ticket');
  let cleaned = false;
  const done = () => {
    if (cleaned) return;
    cleaned = true;
    document.body.classList.remove('printing-ticket');
    clone.remove();
    window.removeEventListener('afterprint', done);
  };
  window.addEventListener('afterprint', done);
  setTimeout(() => window.print(), 50);
  setTimeout(done, 120_000);
}
