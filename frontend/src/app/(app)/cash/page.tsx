'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownCircle, ArrowUpCircle, Camera, CloudOff, FileText, Lock, Receipt, ShoppingCart, Unlock } from 'lucide-react';
import { api, compressImage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useOnline } from '@/lib/net';
import { useLocalOrders } from '@/lib/offline/hooks';
import { EXPENSE_CATS, INCOME_CATS } from '@/lib/cash';
import { METHODS, STATUS, cn, dateTime, money, type Status } from '@/lib/utils';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Empty, ErrorText, Input, Label, PageHeader, Select, Textarea } from '@/components/ui';
import { Modal } from '@/components/modal';
import { MovementsTable } from '@/components/cash-movements';
import { DownloadButton } from '@/components/download-button';
import { PosRegister } from '@/components/pos-register';

const Row = ({ label, value, bold, tone }: { label: React.ReactNode; value: React.ReactNode; bold?: boolean; tone?: string }) => (
  <div className={cn('flex justify-between gap-4 py-1 text-sm', bold && 'border-t pt-2 text-base font-semibold', tone)}><span>{label}</span><span>{value}</span></div>
);

function MovementModal({ type, onClose, onDone }: { type: 'INCOME' | 'EXPENSE'; onClose: () => void; onDone: () => void }) {
  const { user, can } = useAuth();
  const cats = type === 'INCOME' ? INCOME_CATS : EXPENSE_CATS;
  const users = useQuery({ queryKey: ['users'], queryFn: () => api<any[]>('/users') });
  const [f, setF] = useState({ category: cats[0].value, concept: '', amount: '', method: 'CASH', responsible: user?.fullName ?? '' });
  const [file, setFile] = useState<Blob | null>(null);
  const [preview, setPreview] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const save = useMutation({
    mutationFn: async () => {
      const m = await api<any>('/cash/movements', { body: { type, category: f.category, concept: f.concept, amount: Number(f.amount), method: f.method, responsibleName: f.responsible || undefined } });
      if (file) {
        const form = new FormData();
        form.append('file', file, 'evidencia.jpg');
        await api(`/cash/movements/${m.id}/evidence`, { form });
      }
    },
    onSuccess: onDone,
  });

  return (
    <Modal title={type === 'INCOME' ? 'Registrar ingreso' : 'Registrar egreso'} onClose={onClose}>
      <form className="space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div className="grid gap-3 sm:grid-cols-2">
          <div><Label>Categoría *</Label><Select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{cats.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}</Select></div>
          <div><Label>Monto *</Label><Input required autoFocus type="number" min="0.01" step="0.01" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
        </div>
        <div><Label>Concepto *</Label><Input required minLength={2} maxLength={200} value={f.concept} onChange={(e) => setF({ ...f, concept: e.target.value })} placeholder={type === 'INCOME' ? 'Ej. Venta de aromatizante' : 'Ej. Pago de luz'} /></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label>Método de pago</Label>
            <Select value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(METHODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
            {f.method !== 'CASH' && <p className="mt-1 text-xs text-muted-foreground">No afecta el efectivo del cajón.</p>}
          </div>
          <div>
            <Label>Responsable</Label>
            <Input list="cash-users" value={f.responsible} onChange={(e) => setF({ ...f, responsible: e.target.value })} />
            <datalist id="cash-users">{users.data?.map((u) => <option key={u.id} value={u.fullName} />)}</datalist>
          </div>
        </div>
        <div>
          <Label>Evidencia fotográfica (opcional)</Label>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={async (e) => {
            const picked = e.target.files?.[0];
            if (!picked) return;
            const blob = await compressImage(picked);
            setFile(blob);
            setPreview(URL.createObjectURL(blob));
          }} />
          <div className="flex items-center gap-3">
            <Button type="button" variant="outline" onClick={() => fileRef.current?.click()}><Camera className="h-4 w-4" />{file ? 'Cambiar foto' : 'Tomar foto'}</Button>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {preview && <img src={preview} alt="Evidencia" className="h-14 w-14 rounded-md object-cover" />}
          </div>
        </div>
        <ErrorText error={save.error} />
        <Button size="lg" className="w-full" disabled={save.isPending}>{save.isPending ? 'Guardando…' : 'Guardar'}</Button>
      </form>
    </Modal>
  );
}

function CollectModal({ order, cur, onClose, onDone }: { order: any; cur?: string; onClose: () => void; onDone: () => void }) {
  const [method, setMethod] = useState('CASH');
  const [amount, setAmount] = useState(String(order.due));
  const pay = useMutation({
    mutationFn: () => api(`/orders/${order.id}/payments`, { body: { method, amount: Number(amount) } }),
    onSuccess: onDone,
  });
  const partial = Number(amount) > 0 && Number(amount) < order.due;
  return (
    <Modal title={`Cobrar ${order.folio}`} onClose={onClose}>
      <form className="space-y-4 p-4" onSubmit={(e) => { e.preventDefault(); pay.mutate(); }}>
        <div className="rounded-lg bg-muted p-3 text-sm">
          <p className="font-medium">{order.vehicle.brand} {order.vehicle.model} · <span className="font-mono">{order.vehicle.plate}</span>{order.clientName && ` · ${order.clientName}`}</p>
          <Row label="Total" value={money(order.total, cur)} />
          <Row label="Pagado" value={money(order.paid, cur)} />
          <Row bold label="Saldo" value={money(order.due, cur)} />
        </div>
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(METHODS).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setMethod(k)} className={cn('rounded-lg border p-3 text-sm font-medium hover:bg-muted', method === k && 'border-primary bg-primary/10 text-primary')}>{l}</button>
          ))}
        </div>
        <div>
          <Label>Monto a cobrar</Label>
          <Input required autoFocus type="number" min="0.01" max={order.due} step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-12 text-lg" />
          {partial && <p className="mt-1 text-xs text-amber-600">Pago parcial: quedará un saldo de {money(order.due - Number(amount), cur)}.</p>}
        </div>
        <ErrorText error={pay.error} />
        <Button size="lg" className="w-full" variant="success" disabled={pay.isPending}>{pay.isPending ? 'Cobrando…' : `Cobrar ${money(Number(amount) || 0, cur)}`}</Button>
      </form>
    </Modal>
  );
}

function CloseModal({ data, cur, onClose, onDone }: { data: any; cur?: string; onClose: () => void; onDone: (id: string) => void }) {
  const f = data.figures;
  const [counted, setCounted] = useState('');
  const [notes, setNotes] = useState('');
  const diff = counted === '' ? null : Math.round((Number(counted) - f.expectedCash) * 100) / 100;
  const close = useMutation({
    mutationFn: () => api<any>(`/cash/sessions/${data.session.id}/close`, { body: { countedCash: Number(counted), notes: notes || undefined } }),
    onSuccess: (r) => onDone(r.session.id),
  });

  return (
    <Modal title="Corte de caja" onClose={onClose}>
      <form className="space-y-4 p-4" onSubmit={(e) => { e.preventDefault(); close.mutate(); }}>
        <div className="rounded-lg bg-muted p-3">
          <Row label="Caja inicial" value={money(f.openingAmount, cur)} />
          <Row label="Total ingresos (todos los métodos)" value={money(f.totalIncome, cur)} />
          <Row label="Total egresos (todos los métodos)" value={money(f.totalExpense, cur)} />
          <p className="mt-2 text-xs font-medium text-muted-foreground">Efectivo en cajón</p>
          <Row label="+ Cobros de órdenes en efectivo" value={money(f.orders.CASH, cur)} />
          <Row label="+ Otros ingresos en efectivo" value={money(f.manualIncome.CASH, cur)} />
          <Row label="− Egresos en efectivo" value={money(f.expense.CASH, cur)} />
          <Row bold label="Caja esperada" value={money(f.expectedCash, cur)} />
        </div>
        <div>
          <Label>Caja real (efectivo contado) *</Label>
          <Input required autoFocus type="number" min="0" step="0.01" inputMode="decimal" value={counted} onChange={(e) => setCounted(e.target.value)} className="h-12 text-lg" />
        </div>
        {diff !== null && (
          <p className={cn('rounded-md px-3 py-2 text-sm font-medium', diff === 0 ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : diff > 0 ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300' : 'bg-red-500/15 text-red-700 dark:text-red-300')}>
            {diff === 0 ? 'Caja cuadrada' : diff > 0 ? `Sobrante: ${money(diff, cur)}` : `Faltante: ${money(Math.abs(diff), cur)}`}
          </p>
        )}
        <div><Label>Notas del corte</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Explique la diferencia si la hay" /></div>
        <p className="text-xs text-muted-foreground">Al cerrar, las cifras quedan guardadas y ya no se podrán registrar movimientos en esta caja.</p>
        <ErrorText error={close.error} />
        <Button size="lg" className="w-full" variant="destructive" disabled={close.isPending || counted === ''}>{close.isPending ? 'Cerrando…' : 'Cerrar caja y generar corte'}</Button>
      </form>
    </Modal>
  );
}

type Tab = 'summary' | 'sale' | 'receivables';

export default function CashPage() {
  const { user, can } = useAuth();
  const router = useRouter();
  const online = useOnline();
  const qc = useQueryClient();
  const cur = user?.tenant.currency;
  const current = useQuery({ queryKey: ['cash', 'current'], queryFn: () => api<any | null>('/cash/current'), refetchInterval: online ? 15_000 : false });
  const sessions = useQuery({ queryKey: ['cash', 'sessions'], queryFn: () => api<any[]>('/cash/sessions') });
  const receivables = useQuery({ queryKey: ['cash', 'receivables'], queryFn: () => api<any[]>('/cash/receivables'), refetchInterval: online ? 30_000 : false });
  const locals = useLocalOrders(user?.tenant.id) ?? [];

  const [tab, setTab] = useState<Tab>(can('orders:create') ? 'sale' : 'summary');
  const [modal, setModal] = useState<null | 'INCOME' | 'EXPENSE' | 'CLOSE'>(null);
  const [collect, setCollect] = useState<any>(null);
  const [opening, setOpening] = useState('');
  const [openNotes, setOpenNotes] = useState('');
  const [rf, setRf] = useState('');
  const [rt, setRt] = useState('');
  const refresh = () => {
    ['cash', 'finance', 'orders', 'dashboard'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  };

  const open = useMutation({ mutationFn: () => api('/cash/open', { body: { openingAmount: Number(opening), notes: openNotes || undefined } }), onSuccess: () => { setOpening(''); setOpenNotes(''); refresh(); } });
  const del = useMutation({ mutationFn: (id: string) => api(`/cash/movements/${id}`, { method: 'DELETE' }), onSuccess: refresh });

  const d = current.data;
  const f = d?.figures;
  const dueTotal = (receivables.data ?? []).reduce((s, o) => s + o.due, 0);
  // Ventas capturadas sin conexión: aún no están en el servidor, por eso no suman en las cifras de la caja
  const unsynced = locals.filter((l) => !l.data.folio);
  const unsyncedPaid = unsynced.reduce((s, l) => s + (l.data.payments ?? []).reduce((a: number, p: any) => a + Number(p.amount), 0), 0);

  return (
    <>
      <PageHeader title="Caja">
        <Input type="date" value={rf} onChange={(e) => setRf(e.target.value)} className="h-8 w-36" aria-label="Desde" />
        <Input type="date" value={rt} onChange={(e) => setRt(e.target.value)} className="h-8 w-36" aria-label="Hasta" />
        <DownloadButton type="cash-sessions" params={{ from: rf, to: rt }} label="Cortes" />
        <DownloadButton type="cash-movements" params={{ from: rf, to: rt }} label="Movimientos" />
      </PageHeader>
      {!online && <p className="mb-3 rounded-md bg-amber-500/15 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">Sin conexión: la caja necesita internet para registrar movimientos, cobrar y hacer el corte. Las ventas nuevas sí se guardan en el dispositivo y se suman a la caja al sincronizar.</p>}

      {current.isLoading ? <p className="text-sm text-muted-foreground">Cargando…</p> : !d ? (
        <Card className="mx-auto max-w-md">
          <CardHeader><CardTitle className="flex items-center gap-2"><Lock className="h-4 w-4" />Caja cerrada</CardTitle></CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); open.mutate(); }}>
              <p className="text-sm text-muted-foreground">Abra la caja para vender y cobrar desde aquí y registrar ingresos y egresos. Se guardan usuario, fecha y hora de apertura. También puede seguir usando <Link href="/pos" className="text-primary underline">Nueva orden</Link>.</p>
              <div><Label>Monto inicial (efectivo en el cajón) *</Label><Input required autoFocus type="number" min="0" step="0.01" inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} className="h-12 text-lg" /></div>
              <div><Label>Notas</Label><Input value={openNotes} onChange={(e) => setOpenNotes(e.target.value)} placeholder="Turno matutino" /></div>
              <ErrorText error={open.error} />
              <Button size="lg" className="w-full" disabled={open.isPending || !online || !can('cash:create')}><Unlock className="h-4 w-4" />Abrir caja</Button>
            </form>
          </CardContent>
        </Card>
      ) : (
        <>
          <p className="mb-3 text-sm text-muted-foreground">
            <Badge className="mr-2 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">Abierta</Badge>
            por <b>{d.session.openedByName}</b> desde {dateTime(d.session.openedAt)}{d.session.openingNotes && ` · ${d.session.openingNotes}`}
          </p>
          <div className="mb-1 flex gap-1 border-b">
            {([['sale', 'Nueva venta', ShoppingCart], ['summary', 'Resumen', Receipt], ['receivables', `Por cobrar${receivables.data?.length ? ` (${receivables.data.length})` : ''}`, Receipt]] as const).filter(([k]) => k !== 'sale' || can('orders:create')).map(([k, label, Icon]) => (
              <button key={k} onClick={() => setTab(k)} className={cn('-mb-px flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-medium', tab === k ? 'border-primary text-primary' : 'border-transparent text-muted-foreground hover:text-foreground')}>
                <Icon className="h-4 w-4" />{label}
              </button>
            ))}
          </div>

          {tab === 'sale' ? (
            <p className="mt-2 text-xs text-muted-foreground">Efectivo esperado en caja: <b>{money(f.expectedCash, cur)}</b> · {f.orders.count} ventas cobradas · Ingresos {money(f.totalIncome, cur)} · Egresos {money(f.totalExpense, cur)}</p>
          ) : (
          <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Card><CardContent><p className="text-xs text-muted-foreground">Caja inicial</p><p className="mt-1 text-2xl font-semibold">{money(f.openingAmount, cur)}</p></CardContent></Card>
            <Card><CardContent><p className="text-xs text-muted-foreground">Ingresos</p><p className="mt-1 text-2xl font-semibold text-emerald-600">{money(f.totalIncome, cur)}</p><p className="text-xs text-muted-foreground">{f.orders.count} {f.orders.count === 1 ? 'venta cobrada' : 'ventas cobradas'}</p></CardContent></Card>
            <Card><CardContent><p className="text-xs text-muted-foreground">Egresos</p><p className="mt-1 text-2xl font-semibold text-red-600">{money(f.totalExpense, cur)}</p></CardContent></Card>
            <Card className="border-primary/40 bg-primary/5"><CardContent><p className="text-xs text-muted-foreground">Efectivo esperado</p><p className="mt-1 text-2xl font-semibold">{money(f.expectedCash, cur)}</p></CardContent></Card>
          </div>
          {unsynced.length > 0 && (
            <p className="mt-2 flex items-center gap-2 rounded-md bg-sky-500/10 px-3 py-2 text-sm text-sky-800 dark:text-sky-300">
              <CloudOff className="h-4 w-4 shrink-0" />{unsynced.length} venta(s) sin sincronizar{unsyncedPaid > 0 && ` por ${money(unsyncedPaid, cur)}`}: se sumarán a la caja en cuanto se envíen al servidor.
            </p>
          )}

          <div className="mt-4 flex flex-wrap gap-2">
            {can('cash:create') && <Button variant="success" disabled={!online} onClick={() => setModal('INCOME')}><ArrowUpCircle className="h-4 w-4" />Registrar ingreso</Button>}
            {can('cash:create') && <Button variant="destructive" disabled={!online} onClick={() => setModal('EXPENSE')}><ArrowDownCircle className="h-4 w-4" />Registrar egreso</Button>}
            {can('cash:close') && <Button variant="outline" disabled={!online} onClick={() => setModal('CLOSE')}><Lock className="h-4 w-4" />Hacer corte</Button>}
          </div>

          </>
          )}

          {tab === 'summary' && (
            <div className="mt-4 grid gap-4 lg:grid-cols-3">
              <div className="space-y-4 lg:col-span-2">
                <Card>
                  <CardHeader><CardTitle>Movimientos de esta caja</CardTitle></CardHeader>
                  <MovementsTable rows={d.movements} cur={cur} onDelete={can('cash:delete') ? (id) => del.mutate(id) : undefined} deleting={del.isPending} />
                  <ErrorText error={del.error} />
                </Card>
                <Card>
                  <CardHeader><CardTitle>Ventas cobradas en esta caja ({d.payments.length})</CardTitle></CardHeader>
                  {d.payments.length === 0 ? <Empty text="Aún no hay cobros" /> : (
                    <div className="divide-y text-sm">
                      {d.payments.map((p: any) => (
                        <Link key={p.id} href={`/orders/detail?id=${p.orderId}`} className="flex items-center justify-between gap-3 p-3 hover:bg-muted/50">
                          <span>{p.folio} · {METHODS[p.method]} · <span className="text-muted-foreground">{dateTime(p.paidAt)}</span></span>
                          <span className="font-medium text-emerald-600">+{money(p.amount, cur)}</span>
                        </Link>
                      ))}
                    </div>
                  )}
                </Card>
              </div>
              <Card className="h-fit">
                <CardHeader><CardTitle>Cobros de órdenes (automático)</CardTitle></CardHeader>
                <CardContent className="text-sm">
                  <Row label="Efectivo" value={money(f.orders.CASH, cur)} />
                  <Row label="Tarjeta" value={money(f.orders.CARD, cur)} />
                  <Row label="Transferencia" value={money(f.orders.TRANSFER, cur)} />
                  <Row bold label={`Total (${f.orders.count} cobros)`} value={money(f.orders.total, cur)} />
                  <p className="mt-2 text-xs text-muted-foreground">Incluye lo vendido desde esta pantalla y desde Nueva orden. Se toman de los pagos de las órdenes desde la apertura; no hay que capturarlos otra vez.</p>
                </CardContent>
              </Card>
            </div>
          )}

          {tab === 'sale' && (
            <div className="mt-4">
              <p className="mb-3 text-sm text-muted-foreground">Cada venta se cobra al momento y se suma a esta caja. (También puedes usar <Link href="/pos" className="text-primary underline">Nueva orden</Link>, que permite cobrar después.)</p>
              <PosRegister cashMode />
            </div>
          )}

          {tab === 'receivables' && (
            <Card className="mt-4">
              <CardHeader><CardTitle>Órdenes con saldo pendiente</CardTitle><span className="text-sm font-semibold text-amber-600">{money(dueTotal, cur)}</span></CardHeader>
              {receivables.data?.length === 0 ? <Empty text="No hay cuentas por cobrar" /> : (
                <div className="divide-y">
                  {receivables.data?.map((o) => (
                    <div key={o.id} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium">{o.folio} · {o.vehicle.brand} {o.vehicle.model} <span className="font-mono text-muted-foreground">{o.vehicle.plate}</span></p>
                        <p className="text-xs text-muted-foreground">{o.clientName ?? 'Sin cliente'} · {dateTime(o.receivedAt)} · <span className={cn('rounded px-1.5', STATUS[o.status as Status].cls)}>{STATUS[o.status as Status].label}</span></p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right"><p className="font-semibold text-amber-600">{money(o.due, cur)}</p><p className="text-xs text-muted-foreground">de {money(o.total, cur)}</p></div>
                        {can('orders:edit_price') && <Link href={`/orders/detail?id=${o.id}`} className="text-xs text-primary underline">Editar precio</Link>}
                        {can('orders:collect') && <Button size="sm" variant="success" disabled={!online} onClick={() => setCollect(o)}>Cobrar</Button>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Card>
          )}
        </>
      )}

      <h2 className="mb-2 mt-8 text-sm font-semibold">Historial de cortes</h2>
      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr><th className="p-3">Apertura</th><th>Usuario</th><th className="text-right">Inicial</th><th className="text-right">Ingresos</th><th className="text-right">Egresos</th><th className="text-right">Esperada</th><th className="text-right">Real</th><th className="text-right">Diferencia</th><th /></tr>
          </thead>
          <tbody className="divide-y">
            {sessions.data?.map((s) => (
              <tr key={s.id}>
                <td className="p-3">{dateTime(s.openedAt)}</td>
                <td>{s.openedByName}</td>
                <td className="text-right">{money(s.openingAmount, cur)}</td>
                <td className="text-right text-emerald-600">{money(s.totalIncome, cur)}</td>
                <td className="text-right text-red-600">{money(s.totalExpense, cur)}</td>
                <td className="text-right">{money(s.expectedCash, cur)}</td>
                <td className="text-right">{s.countedCash != null ? money(s.countedCash, cur) : <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">Abierta</Badge>}</td>
                <td className={cn('text-right font-medium', s.difference < 0 && 'text-red-600', s.difference > 0 && 'text-sky-600')}>{s.difference != null ? money(s.difference, cur) : '—'}</td>
                <td className="pr-3 text-right"><Link href={`/cash/session?id=${s.id}`} className="inline-flex items-center gap-1 text-primary hover:underline"><FileText className="h-4 w-4" />Ver</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
        {sessions.data?.length === 0 && <Empty text="Aún no hay cortes" />}
      </Card>

      {modal === 'INCOME' || modal === 'EXPENSE' ? <MovementModal type={modal} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} /> : null}
      {modal === 'CLOSE' && d && <CloseModal data={d} cur={cur} onClose={() => setModal(null)} onDone={(id) => { setModal(null); refresh(); router.push(`/cash/session?id=${id}`); }} />}
      {collect && <CollectModal order={collect} cur={cur} onClose={() => setCollect(null)} onDone={() => { setCollect(null); refresh(); }} />}
    </>
  );
}
