'use client';
import { Suspense, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { Camera, CloudOff, Mail, MessageCircle } from 'lucide-react';
import { api, compressImage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useOnline } from '@/lib/net';
import { getDb } from '@/lib/offline/db';
import { useLive, useObjectUrl } from '@/lib/offline/hooks';
import { mergeOrder } from '@/lib/offline/merge';
import { addPhotoOffline, changeStatusOffline } from '@/lib/offline/sync';
import { METHODS, NEXT, PHOTO_TYPES, STATUS, dateTime, duration, money, type Status } from '@/lib/utils';
import { TicketActions, TicketView } from '@/components/ticket';
import { TipField, sendTip } from '@/components/tips';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorText, Input, Label, PageHeader, Select, StatusBadge, buttonClass } from '@/components/ui';

function LocalPhoto({ id, blob, type }: { id: string; blob: Blob; type: string }) {
  const url = useObjectUrl(id, blob);
  return url ? (
    <div className="relative">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt={type} className="aspect-video w-full rounded-md object-cover opacity-90" />
      <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-[10px] text-white">{PHOTO_TYPES.find((t) => t.value === type)?.label} · pendiente</span>
    </div>
  ) : null;
}

function OrderDetail() {
  const id = useSearchParams().get('id') ?? '';
  const { user } = useAuth();
  const online = useOnline();
  const { can } = useAuth();
  const canPrices = can('orders:prices');
  const canCollect = can('orders:collect');
  const canAssign = can('orders:assign');
  const canStatus = can('orders:status');
  const canPhotos = can('orders:photos');
  const cur = user?.tenant.currency;
  const qc = useQueryClient();
  const refresh = () => { qc.invalidateQueries({ queryKey: ['order', id] }); qc.invalidateQueries({ queryKey: ['orders'] }); };

  const server = useQuery({ queryKey: ['order', id], queryFn: () => api<any>(`/orders/${id}`), enabled: !!id, retry: false, refetchInterval: online ? 15_000 : false });
  const local = useLive(() => getDb().orders.get(id), [id]);
  const ops = useLive(() => getDb().outbox.where('entityId').equals(id).toArray(), [id]) ?? [];
  const localPhotos = useLive(() => getDb().photos.where('orderId').equals(id).toArray(), [id]) ?? [];
  const o = mergeOrder(server.data, local, ops, localPhotos);

  const synced = !!o && !o.pending;
  const washers = useQuery({ queryKey: ['washers'], queryFn: () => api<any[]>('/users/washers'), enabled: canAssign });
  const notif = useQuery({ queryKey: ['notif', id], queryFn: () => api<any>(`/orders/${id}/notifications`), enabled: synced && online, retry: false });

  const assign = useMutation({ mutationFn: (w: string) => api(`/orders/${id}/assign`, { method: 'PATCH', body: { assignedToId: w || null } }), onSuccess: refresh });
  const [priceEdit, setPriceEdit] = useState<{ id: string; v: string } | null>(null);
  const price = useMutation({ mutationFn: (x: { id: string; v: number }) => api(`/orders/${id}/items/${x.id}/price`, { method: 'PATCH', body: { unitPrice: x.v } }), onSuccess: () => { setPriceEdit(null); refresh(); } });
  const [tip, setTip] = useState('');
  const [tipMsg, setTipMsg] = useState<string | null>(null);
  const pay = useMutation({
    mutationFn: async (m: string) => {
      const r = await api(`/orders/${id}/payments`, { body: { method: m } });
      if (Number(tip) > 0) { setTipMsg(await sendTip({ amount: Number(tip), method: m, orderId: id })); setTip(''); }
      return r;
    },
    onSuccess: () => { refresh(); qc.invalidateQueries({ queryKey: ['cash'] }); },
  });

  const [photoType, setPhotoType] = useState('FRONT');
  const [err, setErr] = useState<unknown>();
  const [uploading, setUploading] = useState(false);
  const [payMethod, setPayMethod] = useState('CASH');
  const fileRef = useRef<HTMLInputElement>(null);
  const ticketRef = useRef<HTMLDivElement>(null);

  async function changeStatus(s: Status) {
    setErr(undefined);
    try { await changeStatusOffline(id, s); } catch (e) { setErr(e); }
  }

  async function takePhoto(file: File) {
    setUploading(true);
    setErr(undefined);
    try {
      await addPhotoOffline(id, photoType, await compressImage(file)); // se guarda en el dispositivo y se sube sola
    } catch (e) {
      setErr(e);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  if (!id) return <p className="text-sm text-muted-foreground">Falta el identificador de la orden.</p>;
  if (!o) {
    if (server.isLoading || server.fetchStatus === 'fetching') return <p className="text-sm text-muted-foreground">Cargando…</p>;
    return (
      <p className="text-sm text-muted-foreground">
        {online ? ((server.error as Error)?.message ?? 'Orden no encontrada') : 'Esta orden no está guardada en el dispositivo. Ábrela una vez con conexión para usarla sin internet.'}
      </p>
    );
  }

  const next = (NEXT[o.status as Status] ?? []).filter((s) => s !== 'RECIBIDO' || o.status === 'RECIBIDO' || can('orders:deliver'));
  const paid = (o.payments ?? []).reduce((s: number, p: any) => s + Number(p.amount), 0);
  const trackUrl = typeof window !== 'undefined' ? `${location.origin}/track/${o.code}` : '';
  const needsOnline = !online || !synced;

  return (
    <>
      <PageHeader title={`${o.folio ?? 'Folio por asignar'} · ${o.vehicle.brand} ${o.vehicle.model}`}>
        {o.pending && <Badge className="bg-sky-500/15 text-sky-700 dark:text-sky-300"><CloudOff className="mr-1 h-3 w-3" />Pendiente de sincronizar</Badge>}
        {o.syncProblem && <Badge className="bg-red-500/15 text-red-700 dark:text-red-300">Requiere revisión</Badge>}
        <StatusBadge status={o.status} />
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card className={canStatus ? '' : 'hidden'}>
            <CardHeader><CardTitle>Cambiar estatus</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <div className="flex flex-wrap gap-2">
                {next.length === 0 && <p className="text-sm text-muted-foreground">Orden entregada.</p>}
                {next.map((s) => (
                  <Button key={s} size="lg" variant={s === 'FINALIZADO' ? 'success' : 'default'} onClick={() => changeStatus(s)}>
                    {s === 'FINALIZADO' ? 'Marcar como finalizada' : 'Reabrir orden'}
                  </Button>
                ))}
              </div>
              {!online && next.length > 0 && <p className="text-xs text-muted-foreground">Sin conexión: el cambio se guarda y se enviará al reconectar.</p>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Vehículo</CardTitle></CardHeader>
            <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div><p className="text-xs text-muted-foreground">Placa</p><p className="font-mono font-medium">{o.vehicle.plate}</p></div>
              <div><p className="text-xs text-muted-foreground">Marca / modelo</p><p>{o.vehicle.brand} {o.vehicle.model}</p></div>
              <div><p className="text-xs text-muted-foreground">Color</p><p>{o.vehicle.color}</p></div>
              <div><p className="text-xs text-muted-foreground">Recibido</p><p>{dateTime(o.receivedAt)}</p></div>
              <div><p className="text-xs text-muted-foreground">Inicio</p><p>{dateTime(o.startedAt)}</p></div>
              <div><p className="text-xs text-muted-foreground">Fin</p><p>{dateTime(o.finishedAt)}</p></div>
              <div><p className="text-xs text-muted-foreground">Tiempo total</p><p>{duration(o.totalSeconds)}</p></div>
              <div><p className="text-xs text-muted-foreground">Lavador</p><p>{o.assignedTo?.fullName ?? '—'}</p></div>
              {o.notes && <div className="col-span-full"><p className="text-xs text-muted-foreground">Observaciones</p><p>{o.notes}</p></div>}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Fotografías</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <div className={canPhotos ? 'flex gap-2' : 'hidden'}>
                <Select value={photoType} onChange={(e) => setPhotoType(e.target.value)}>
                  {PHOTO_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </Select>
                <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && takePhoto(e.target.files[0])} />
                <Button disabled={uploading} onClick={() => fileRef.current?.click()}><Camera className="h-4 w-4" />{uploading ? 'Guardando…' : 'Tomar foto'}</Button>
              </div>
              <ErrorText error={err} />
              {o.photos.length === 0 && <p className="text-sm text-muted-foreground">Sin fotografías.</p>}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {o.photos.map((p: any) =>
                  p.local ? (
                    <LocalPhoto key={p.id} id={p.id} blob={p.blob} type={p.type} />
                  ) : (
                    <a key={p.id} href={`/api/uploads/${p.path}`} target="_blank" rel="noreferrer" className="relative block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/uploads/${p.path}`} alt={p.type} loading="lazy" className="aspect-video w-full rounded-md object-cover" />
                      <span className="absolute bottom-1 left-1 rounded bg-black/60 px-1.5 text-[10px] text-white">{PHOTO_TYPES.find((t) => t.value === p.type)?.label}</span>
                    </a>
                  ),
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Historial de cambios</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {o.statusHistory.map((h: any) => (
                <div key={h.id} className="flex items-center justify-between gap-2">
                  <span>{h.fromStatus ? `${STATUS[h.fromStatus as Status].label} → ` : ''}<b>{STATUS[h.toStatus as Status].label}</b>{h.local && <span className="ml-2 text-xs text-sky-600">pendiente</span>}</span>
                  <span className="text-xs text-muted-foreground">{dateTime(h.createdAt)}</span>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Consulta del cliente</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-center">
              <div className="mx-auto w-fit rounded-lg bg-white p-2"><QRCodeSVG value={trackUrl} size={130} /></div>
              <p className="font-mono text-2xl tracking-widest">{o.code}</p>
              <p className="break-all text-xs text-muted-foreground">{trackUrl}</p>
              {o.pending && <p className="text-xs text-amber-600">El código ya es válido; la consulta funcionará cuando la orden se sincronice.</p>}
            </CardContent>
          </Card>

          <Card className={can('orders:notify') ? '' : 'hidden'}>
            <CardHeader><CardTitle>Avisar al cliente</CardTitle></CardHeader>
            <CardContent className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {notif.data?.clientName ?? o.client?.name ?? 'Cliente'} · prefiere: {notif.data?.preference === 'WHATSAPP' ? 'WhatsApp' : notif.data?.preference === 'EMAIL' ? 'Correo' : 'Ninguno'}
              </p>
              {notif.data?.whatsapp
                ? <a className={buttonClass('success') + ' w-full'} href={notif.data.whatsapp} target="_blank" rel="noreferrer"><MessageCircle className="h-4 w-4" />Avisar por WhatsApp</a>
                : <Button disabled variant="outline" className="w-full">WhatsApp {needsOnline ? '(disponible con conexión)' : '(sin teléfono)'}</Button>}
              {notif.data?.email
                ? <a className={buttonClass('outline') + ' w-full'} href={notif.data.email}><Mail className="h-4 w-4" />Avisar por correo</a>
                : <Button disabled variant="outline" className="w-full">Correo {needsOnline ? '(disponible con conexión)' : '(sin email)'}</Button>}
              <p className="text-xs text-muted-foreground">Mensaje de "listo para entrega" precargado; solo confirmas el envío.</p>
            </CardContent>
          </Card>

          {canPrices && user && (
            <Card>
              <CardHeader><CardTitle>Ticket del servicio</CardTitle></CardHeader>
              <CardContent className="space-y-3">
                <TicketView ref={ticketRef} order={o} tenant={user.tenant} trackUrl={trackUrl} />
                <TicketActions order={o} tenant={user.tenant} trackUrl={trackUrl} ticketEl={() => ticketRef.current} />
              </CardContent>
            </Card>
          )}

          {canPrices && (
              

              <Card>
                <CardHeader><CardTitle>Cobro</CardTitle></CardHeader>
                <CardContent className="space-y-2 text-sm">
                  {o.items.map((i: any) => (
                    <div key={i.id} className="flex items-center justify-between gap-2">
                      <span className="min-w-0 flex-1">{i.quantity} × {i.name}</span>
                      {priceEdit && priceEdit.id === i.id ? (
                        <span className="flex items-center gap-1">
                          <Input type="number" min="0" step="0.01" aria-label="Precio unitario" className="h-8 w-24 text-right" autoFocus value={priceEdit.v} onChange={(e) => setPriceEdit({ id: i.id, v: e.target.value })} />
                          <Button size="sm" disabled={price.isPending || priceEdit.v === ''} onClick={() => price.mutate({ id: i.id, v: Number(priceEdit.v) })}>Guardar</Button>
                          <Button size="sm" variant="ghost" onClick={() => setPriceEdit(null)}>Cancelar</Button>
                        </span>
                      ) : (
                        <span className="flex items-center gap-2">
                          {can('orders:edit_price') && paid < Number(o.total) + 0.005 && synced && online && !o.pending && <button type="button" className="text-xs text-primary underline" onClick={() => setPriceEdit({ id: i.id, v: String(Number(i.unitPrice)) })}>Editar precio</button>}
                          <span>{money(i.total, cur)}</span>
                        </span>
                      )}
                    </div>
                  ))}
                  <ErrorText error={price.error} />
                  <div className="flex justify-between border-t pt-2"><span>Subtotal</span><span>{money(o.subtotal, cur)}</span></div>
                  <div className="flex justify-between"><span>Descuento</span><span>-{money(o.discount, cur)}</span></div>
                  <div className="flex justify-between"><span>Impuestos ({Number(o.taxRate)}%)</span><span>{money(o.taxAmount, cur)}</span></div>
                  <div className="flex justify-between text-base font-semibold"><span>Total</span><span>{money(o.total, cur)}</span></div>
                  {o.pending && !server.data && <p className="text-xs text-muted-foreground">Total estimado: el servidor lo confirma al sincronizar.</p>}
                  {o.payments.map((p: any) => <div key={p.id} className="flex justify-between text-muted-foreground"><span>Pago {METHODS[p.method]}</span><span>{money(p.amount, cur)}</span></div>)}
                  {!canCollect ? null : paid < Number(o.total) ? (
                    <div className="space-y-2 border-t pt-2">
                      <Label>Registrar pago por {money(Number(o.total) - paid, cur)}</Label>
                      <div className="flex gap-2">
                        <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>{Object.entries(METHODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
                        <Button disabled={pay.isPending || needsOnline} onClick={() => pay.mutate(payMethod)}>Cobrar</Button>
                      </div>
                      {needsOnline && <p className="text-xs text-muted-foreground">Cobrar posteriormente requiere conexión y que la orden esté sincronizada.</p>}
                      {can('cash:tips') && <TipField base={Number(o.total) - paid} value={tip} onChange={setTip} cur={cur} />}
                      <ErrorText error={pay.error} />
                    </div>
                  ) : <p className="text-emerald-600">Pagado</p>}
                  {tipMsg && <p className="text-xs text-amber-700">La propina no se registró: {tipMsg}</p>}
                </CardContent>
              </Card>)}

              {canAssign && (
              <Card>
                <CardHeader><CardTitle>Lavador asignado</CardTitle></CardHeader>
                <CardContent>
                  <Select disabled={needsOnline} value={o.assignedToId ?? ''} onChange={(e) => assign.mutate(e.target.value)}>
                    <option value="">Sin asignar</option>
                    {washers.data?.filter((w) => w.isActive).map((w) => <option key={w.id} value={w.id}>{w.fullName}</option>)}
                  </Select>
                </CardContent>
              </Card>
              )}

        </div>
      </div>
    </>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando…</p>}>
      <OrderDetail />
    </Suspense>
  );
}
