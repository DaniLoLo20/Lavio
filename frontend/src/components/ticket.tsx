'use client';
import { forwardRef, useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Mail, MessageCircle, Printer } from 'lucide-react';
import { METHODS } from '@/lib/utils';
import { mailLink, orderPaid, printTicket, ticketText, waLink, type TicketTenant } from '@/lib/ticket';
import { buttonClass, Button, Input, Label } from './ui';

const money = (n: number | string, cur = 'MXN') => new Intl.NumberFormat('es-MX', { style: 'currency', currency: cur }).format(Number(n ?? 0));
const when = (d?: string | Date | null) => (d ? new Date(d).toLocaleString('es-MX', { dateStyle: 'short', timeStyle: 'short' }) : '');

/** Ticket de servicio (colores fijos blanco/negro para que se imprima igual en modo oscuro). */
export const TicketView = forwardRef<HTMLDivElement, { order: any; tenant: TicketTenant; trackUrl: string }>(function TicketView({ order: o, tenant: t, trackUrl }, ref) {
  const cur = t.currency;
  const paid = orderPaid(o);
  const due = Math.max(Number(o.total) - paid, 0);
  return (
    <div ref={ref} className="mx-auto w-full max-w-[320px] rounded-md border border-gray-300 bg-white p-4 font-mono text-[12px] leading-snug text-black">
      <div className="text-center">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={t.logoUrl || '/brand/lavio-mark.png'} alt="" className="mx-auto mb-1 h-14 w-auto max-w-[140px] object-contain" />
        <p className="text-sm font-bold">{t.name}</p>
        {t.address && <p>{t.address}</p>}
        {(t.phone || t.taxId) && <p>{[t.phone && `Tel. ${t.phone}`, t.taxId && `RFC ${t.taxId}`].filter(Boolean).join(' · ')}</p>}
      </div>
      <div className="my-2 border-t border-dashed border-gray-500" />
      <p className="text-center font-bold">TICKET DE SERVICIO</p>
      <div className="mt-1 space-y-0.5">
        <p>Folio: <b>{o.folio ?? 'por asignar'}</b></p>
        <p>Fecha: {when(o.receivedAt)}</p>
        {o.vehicle?.plate ? <>
        {(o.vehicle.brand || o.vehicle.model) && <p>Vehículo: {[o.vehicle.brand, o.vehicle.model].filter(Boolean).join(' ')}</p>}
        <p>Placa: {o.vehicle.plate}{o.vehicle.color ? ` · ${o.vehicle.color}` : ''}</p>
        </> : <p>Venta sin vehículo</p>}
        {o.client?.name && <p>Cliente: {o.client.name}</p>}
      </div>
      <div className="my-2 border-t border-dashed border-gray-500" />
      <div className="space-y-1">
        {(o.items ?? []).map((i: any, n: number) => (
          <div key={i.id ?? n} className="flex justify-between gap-2">
            <span className="min-w-0 break-words">{i.quantity} x {i.name}{i.quantity > 1 && <span className="text-gray-600"> ({money(i.unitPrice, cur)} c/u)</span>}</span>
            <span className="shrink-0">{money(i.total, cur)}</span>
          </div>
        ))}
      </div>
      <div className="my-2 border-t border-dashed border-gray-500" />
      <div className="space-y-0.5">
        <div className="flex justify-between"><span>Subtotal</span><span>{money(o.subtotal, cur)}</span></div>
        {Number(o.discount) > 0 && <div className="flex justify-between"><span>Descuento</span><span>-{money(o.discount, cur)}</span></div>}
        <div className="flex justify-between"><span>IVA ({Number(o.taxRate)}%)</span><span>{money(o.taxAmount, cur)}</span></div>
        <div className="flex justify-between text-sm font-bold"><span>TOTAL</span><span>{money(o.total, cur)}</span></div>
      </div>
      <div className="my-2 border-t border-dashed border-gray-500" />
      {(o.payments ?? []).map((p: any, n: number) => (
        <div key={p.id ?? n} className="flex justify-between"><span>Pago {METHODS[p.method] ?? p.method}</span><span>{money(p.amount, cur)}</span></div>
      ))}
      <p className="mt-1 text-center font-bold">{due > 0.004 ? (paid > 0 ? `SALDO PENDIENTE ${money(due, cur)}` : `PAGO PENDIENTE ${money(due, cur)}`) : 'PAGADO'}</p>
      <div className="my-2 border-t border-dashed border-gray-500" />
      <div className="flex flex-col items-center gap-1 text-center">
        <QRCodeSVG value={trackUrl} size={92} bgColor="#ffffff" fgColor="#000000" />
        <p>Consulta tu servicio con el código</p>
        <p className="text-base font-bold tracking-widest">{o.code}</p>
        <p className="break-all text-[10px] text-gray-600">{trackUrl}</p>
        <p className="mt-1">¡Gracias por su preferencia!</p>
      </div>
    </div>
  );
});

/** Enviar por WhatsApp (precargado, sin APIs de pago), por correo o imprimir. */
export function TicketActions({ order: o, tenant: t, trackUrl, ticketEl }: { order: any; tenant: TicketTenant; trackUrl: string; ticketEl: () => HTMLElement | null }) {
  const [phone, setPhone] = useState<string>(o.client?.phone ?? '');
  const text = ticketText(o, t, trackUrl);
  const subject = `Ticket de servicio ${o.folio ?? ''} - ${t.name}`.replace(/\s+/g, ' ').trim();
  const hasPhone = phone.replace(/\D/g, '').length >= 10;

  return (
    <div className="space-y-2">
      <div>
        <Label>WhatsApp del cliente</Label>
        <Input type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10 dígitos (opcional)" />
      </div>
      <a href={waLink(phone, t.countryCode, text)} target="_blank" rel="noreferrer" className={buttonClass('success', 'lg') + ' w-full'}>
        <MessageCircle className="h-4 w-4" />{hasPhone ? 'Enviar ticket por WhatsApp' : 'Enviar ticket por WhatsApp (elegir contacto)'}
      </a>
      {o.client?.email
        ? <a href={mailLink(o.client.email, subject, text)} className={buttonClass('outline') + ' w-full'}><Mail className="h-4 w-4" />Enviar ticket por correo</a>
        : null}
      <Button type="button" variant="outline" className="w-full" onClick={() => { const el = ticketEl(); if (el) printTicket(el); }}><Printer className="h-4 w-4" />Imprimir ticket</Button>
    </div>
  );
}
