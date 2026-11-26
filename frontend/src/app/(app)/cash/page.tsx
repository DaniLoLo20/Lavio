'use client';
import { useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownCircle, ArrowUpCircle, Camera, ChevronRight, CloudOff, HandCoins, Lock, Receipt, ShoppingCart, Unlock, Wallet } from 'lucide-react';
import { api, compressImage } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useOnline } from '@/lib/net';
import { useLocalOrders } from '@/lib/offline/hooks';
import { EXPENSE_CATS, INCOME_CATS } from '@/lib/cash';
import { METHODS, STATUS, cn, dateTime, money, type Status, hasVehicle, vehicleName, orderTitle, vehicleText } from '@/lib/utils';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Empty, ErrorText, Input, Label, PageHeader, Select, Textarea } from '@/components/ui';
import { Modal } from '@/components/modal';
import { MovementsTable } from '@/components/cash-movements';
import { TipField, TipsPanel, sendTip, useTips } from '@/components/tips';
import { Action, Glass, GlassPage, Mini, Section, Segmented } from '@/components/glass';
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
  const { can } = useAuth();
  const [method, setMethod] = useState('CASH');
  const [amount, setAmount] = useState(String(order.due));
  const [tip, setTip] = useState('');
  const [tipErr, setTipErr] = useState<string | null>(null);
  const tipN = Number(tip) || 0;
  const pay = useMutation({
    mutationFn: async () => {
      await api(`/orders/${order.id}/payments`, { body: { method, amount: Number(amount) } });
      // La propina se registra aparte (no es venta): si falla, el cobro ya quedó hecho y se avisa
      if (tipN > 0) { const e = await sendTip({ amount: tipN, method, orderId: order.id }); if (e) { setTipErr(e); throw new Error('TIP'); } }
    },
    onSuccess: onDone,
  });
  const partial = Number(amount) > 0 && Number(amount) < order.due;
  return (
    <Modal title={`Cobrar ${order.folio}`} onClose={onClose}>
      <form className="space-y-4 p-4" onSubmit={(e) => { e.preventDefault(); setTipErr(null); pay.mutate(); }}>
        <div className="rounded-2xl bg-black/[0.04] p-3 text-sm dark:bg-white/5">
          <p className="font-medium"><span className={hasVehicle(order) ? 'font-mono' : ''}>{orderTitle(order)}</span>{hasVehicle(order) && vehicleText(order) && ` · ${vehicleText(order)}`}{order.clientName && ` · ${order.clientName}`}</p>
          <Row label="Total" value={money(order.total, cur)} />
          <Row label="Pagado" value={money(order.paid, cur)} />
          <Row bold label="Saldo" value={money(order.due, cur)} />
        </div>
        <div className="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Método de pago">
          {Object.entries(METHODS).map(([k, l]) => (
            <button key={k} type="button" role="radio" aria-checked={method === k} onClick={() => setMethod(k)} className={cn('h-12 rounded-2xl text-sm font-medium transition active:scale-95', method === k ? 'bg-primary text-primary-foreground shadow' : 'bg-black/5 dark:bg-white/10')}>{l}</button>
          ))}
        </div>
        <div>
          <Label>Monto a cobrar</Label>
          <Input required autoFocus type="number" min="0.01" max={order.due} step="0.01" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className="h-12 rounded-2xl text-lg" />
          {partial && <p className="mt-1 text-xs text-amber-600">Pago parcial: quedará un saldo de {money(order.due - Number(amount), cur)}.</p>}
        </div>
        {can('cash:tips') && <TipField base={Number(amount) || 0} value={tip} onChange={setTip} cur={cur} />}
        {tipErr ? <p className="rounded-2xl bg-amber-500/15 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">El pago se cobró, pero la propina no se registró: {tipErr}. Regístrala en la pestaña Propinas.</p> : <ErrorText error={pay.error} />}
        {tipErr
          ? <Button type="button" size="lg" className="h-12 w-full rounded-2xl" onClick={onDone}>Listo</Button>
          : <Button size="lg" className="h-12 w-full rounded-2xl" variant="success" disabled={pay.isPending}>{pay.isPending ? 'Cobrando…' : `Cobrar ${money((Number(amount) || 0) + tipN, cur)}${tipN > 0 ? ' con propina' : ''}`}</Button>}
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
          {f.tips && (f.tips.cashCollected > 0 || f.tips.cashPaidOut > 0) && <>
            <Row label="+ Propinas recibidas en efectivo" value={money(f.tips.cashCollected, cur)} />
            <Row label="- Propinas entregadas en efectivo" value={money(f.tips.cashPaidOut, cur)} />
          </>}
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

type Tab = 'summary' | 'sale' | 'receivables' | 'tips';

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

  const tips = useTips();
  const tipsPending = tips.data?.totals.pending ?? 0;
  const tabItems: { k: Tab; label: string; icon: any; badge?: number }[] = [
    ...(can('orders:create') ? [{ k: 'sale' as Tab, label: 'Vender', icon: ShoppingCart }] : []),
    { k: 'summary', label: 'Resumen', icon: Receipt },
    ...(can('cash:tips') || can('cash:view') ? [{ k: 'tips' as Tab, label: 'Propinas', icon: HandCoins }] : []),
    { k: 'receivables', label: 'Por cobrar', icon: Wallet, badge: receivables.data?.length },
  ];

  return (
    <GlassPage>
      <div className="mx-auto max-w-6xl space-y-4">
        <header className="px-1">
          <h1 className="text-3xl font-bold tracking-tight">Caja</h1>
          <p className="text-sm text-muted-foreground">{d ? 'Turno abierto' : 'Abre la caja para vender y cobrar'}</p>
        </header>

        {!online && (
          <Glass className="border-amber-300/60 bg-amber-100/60 px-4 py-3 text-sm text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
            Sin conexión: la caja necesita internet para registrar movimientos, cobrar y hacer el corte. Las ventas nuevas se guardan en el dispositivo y se suman al sincronizar.
          </Glass>
        )}

        {current.isLoading ? <p className="text-sm text-muted-foreground">Cargando…</p> : !d ? (
          <Glass className="mx-auto max-w-md p-6">
            <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); open.mutate(); }}>
              <div className="flex flex-col items-center text-center">
                <span className="grid h-14 w-14 place-items-center rounded-full bg-slate-700 text-white shadow-lg"><Lock className="h-6 w-6" /></span>
                <h2 className="mt-3 text-xl font-semibold">Caja cerrada</h2>
                <p className="mt-1 text-xs text-muted-foreground">Se guardan usuario, fecha y hora de apertura. También puedes usar <Link href="/pos" className="text-primary underline">Nueva orden</Link>.</p>
              </div>
              <div>
                <Label>Efectivo inicial en el cajón *</Label>
                <Input required autoFocus type="number" min="0" step="0.01" inputMode="decimal" aria-label="Monto inicial" placeholder="0.00" value={opening} onChange={(e) => setOpening(e.target.value)} className="h-16 rounded-2xl text-center text-3xl font-semibold" />
              </div>
              <div><Label>Notas</Label><Input value={openNotes} onChange={(e) => setOpenNotes(e.target.value)} placeholder="Turno matutino" className="rounded-2xl" /></div>
              <ErrorText error={open.error} />
              <Button size="lg" className="h-12 w-full rounded-2xl text-base" disabled={open.isPending || !online || !can('cash:create')}><Unlock className="h-4 w-4" />Abrir caja</Button>
            </form>
          </Glass>
        ) : (
          <>
            {/* Tarjeta principal */}
            <Glass className="relative overflow-hidden p-5">
              <div aria-hidden className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-primary/25 blur-3xl" />
              <div className="relative">
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-500/15 px-2.5 py-1 font-medium text-emerald-700 dark:text-emerald-300"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-500" />Abierta</span>
                  <span className="truncate text-muted-foreground">{d.session.openedByName} · {dateTime(d.session.openedAt)}</span>
                </div>
                <p className="mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">Efectivo esperado</p>
                <p className="text-4xl font-semibold tabular-nums tracking-tight sm:text-5xl" data-testid="expected-cash">{money(f.expectedCash, cur)}</p>
                {d.session.openingNotes && <p className="mt-1 text-xs text-muted-foreground">{d.session.openingNotes}</p>}
                <div className="mt-4 grid grid-cols-3 gap-2">
                  <Mini label="Inicial" value={money(f.openingAmount, cur)} />
                  <Mini label="Ingresos" tone="green" value={money(f.totalIncome, cur)} sub={`${f.orders.count} ${f.orders.count === 1 ? 'venta' : 'ventas'}`} />
                  <Mini label="Egresos" tone="red" value={money(f.totalExpense, cur)} />
                </div>
                {tipsPending > 0.004 && (
                  <button type="button" onClick={() => setTab('tips')} className="mt-2 flex w-full items-center justify-between rounded-2xl bg-amber-500/15 px-3 py-2 text-left text-sm text-amber-800 active:scale-[0.99] dark:text-amber-200">
                    <span className="flex items-center gap-2"><HandCoins className="h-4 w-4" />Propinas por entregar</span>
                    <span className="flex items-center gap-1 font-semibold">{money(tipsPending, cur)}<ChevronRight className="h-4 w-4" /></span>
                  </button>
                )}
                <div className="mt-4 grid grid-cols-3 gap-2">
                  {can('cash:create') && <Action icon={ArrowUpCircle} tone="green" label="Ingreso" disabled={!online} onClick={() => setModal('INCOME')} />}
                  {can('cash:create') && <Action icon={ArrowDownCircle} tone="red" label="Egreso" disabled={!online} onClick={() => setModal('EXPENSE')} />}
                  {can('cash:close') && <Action icon={Lock} tone="slate" label="Corte" disabled={!online} onClick={() => setModal('CLOSE')} />}
                </div>
              </div>
            </Glass>

            {unsynced.length > 0 && (
              <Glass className="flex items-center gap-2 border-sky-300/60 bg-sky-100/60 px-4 py-3 text-sm text-sky-900 dark:bg-sky-500/10 dark:text-sky-200">
                <CloudOff className="h-4 w-4 shrink-0" />{unsynced.length} venta(s) sin sincronizar{unsyncedPaid > 0 && ` por ${money(unsyncedPaid, cur)}`}: se sumarán a la caja al enviarse al servidor.
              </Glass>
            )}

            <Segmented label="Secciones de la caja" value={tab} onChange={setTab} items={tabItems} />

            {tab === 'sale' && (
              <div>
                <p className="mb-3 px-2 text-xs text-muted-foreground">Cada venta se cobra al momento y se suma a esta caja. (En <Link href="/pos" className="text-primary underline">Nueva orden</Link> puedes cobrar después.)</p>
                <PosRegister cashMode />
              </div>
            )}

            {tab === 'summary' && (
              <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-3">
                <div className="min-w-0 space-y-4 lg:col-span-2">
                  <Section title="Movimientos de esta caja">
                    <MovementsTable rows={d.movements} cur={cur} onDelete={can('cash:delete') ? (id) => del.mutate(id) : undefined} deleting={del.isPending} />
                    <ErrorText error={del.error} />
                  </Section>
                  <Section title={`Ventas cobradas (${d.payments.length})`}>
                    {d.payments.length === 0 ? <Empty text="Aún no hay cobros" /> : d.payments.map((p: any) => (
                      <Link key={p.id} href={`/orders/detail?id=${p.orderId}`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm active:bg-black/5">
                        <span className="min-w-0 truncate">{p.folio} · {METHODS[p.method]} · <span className="text-muted-foreground">{dateTime(p.paidAt)}</span></span>
                        <span className="shrink-0 font-semibold tabular-nums text-emerald-600">+{money(p.amount, cur)}</span>
                      </Link>
                    ))}
                  </Section>
                </div>
                <Section title="Cobros por método" className="h-fit min-w-0">
                  <div className="space-y-1 p-4 text-sm">
                    <Row label="Efectivo" value={money(f.orders.CASH, cur)} />
                    <Row label="Tarjeta" value={money(f.orders.CARD, cur)} />
                    <Row label="Transferencia" value={money(f.orders.TRANSFER, cur)} />
                    <Row bold label={`Total (${f.orders.count} cobros)`} value={money(f.orders.total, cur)} />
                    <p className="pt-2 text-xs text-muted-foreground">Incluye lo vendido aquí y en Nueva orden; se toman de los pagos, no hay que capturarlos otra vez.</p>
                  </div>
                </Section>
              </div>
            )}

            {tab === 'tips' && <TipsPanel cur={cur} />}

            {tab === 'receivables' && (
              <Section title="Órdenes con saldo pendiente" right={<span className="text-sm font-semibold tabular-nums text-amber-600">{money(dueTotal, cur)}</span>}>
                {receivables.data?.length === 0 ? <Empty text="No hay cuentas por cobrar" /> : receivables.data?.map((o) => (
                  <div key={o.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0">
                      <p className="font-medium">{o.folio} · <span className={hasVehicle(o) ? 'font-mono' : ''}>{orderTitle(o)}</span> <span className="text-muted-foreground">{hasVehicle(o) ? vehicleText(o) : ''}</span></p>
                      <p className="text-xs text-muted-foreground">{o.clientName ?? 'Sin cliente'} · {dateTime(o.receivedAt)} · <span className={cn('rounded px-1.5', STATUS[o.status as Status].cls)}>{STATUS[o.status as Status].label}</span></p>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right"><p className="font-semibold tabular-nums text-amber-600">{money(o.due, cur)}</p><p className="text-xs text-muted-foreground">de {money(o.total, cur)}</p></div>
                      {can('orders:edit_price') && <Link href={`/orders/detail?id=${o.id}`} className="text-xs text-primary underline">Editar precio</Link>}
                      {can('orders:collect') && <Button size="sm" variant="success" className="rounded-full px-4" disabled={!online} onClick={() => setCollect(o)}>Cobrar</Button>}
                    </div>
                  </div>
                ))}
              </Section>
            )}
          </>
        )}

        <Section
          title="Historial de cortes"
          right={
            <div className="flex flex-wrap items-center gap-2">
              <Input type="date" value={rf} onChange={(e) => setRf(e.target.value)} className="h-8 w-32 rounded-xl text-xs" aria-label="Desde" />
              <Input type="date" value={rt} onChange={(e) => setRt(e.target.value)} className="h-8 w-32 rounded-xl text-xs" aria-label="Hasta" />
              <DownloadButton type="cash-sessions" params={{ from: rf, to: rt }} label="Cortes" />
              <DownloadButton type="cash-movements" params={{ from: rf, to: rt }} label="Movimientos" />
            </div>
          }
        >
          {sessions.data?.length === 0 && <Empty text="Aún no hay cortes" />}
          {sessions.data?.map((s) => (
            <Link key={s.id} href={`/cash/session?id=${s.id}`} className="flex items-center gap-3 px-4 py-3 text-sm active:bg-black/5">
              <div className="min-w-0 flex-1">
                <p className="font-medium">{dateTime(s.openedAt)}</p>
                <p className="truncate text-xs text-muted-foreground">{s.openedByName} · Inicial {money(s.openingAmount, cur)}<span className="hidden md:inline"> · Ingresos {money(s.totalIncome, cur)} · Egresos {money(s.totalExpense, cur)}</span></p>
              </div>
              <div className="text-right">
                <p className="font-semibold tabular-nums">{s.countedCash != null ? money(s.countedCash, cur) : <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">Abierta</Badge>}</p>
                {s.difference != null && <p className={cn('text-xs tabular-nums', s.difference < 0 ? 'text-red-600' : s.difference > 0 ? 'text-sky-600' : 'text-emerald-600')}>{s.difference === 0 ? 'Cuadrada' : money(s.difference, cur)}</p>}
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          ))}
        </Section>
      </div>

      {modal === 'INCOME' || modal === 'EXPENSE' ? <MovementModal type={modal} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} /> : null}
      {modal === 'CLOSE' && d && <CloseModal data={d} cur={cur} onClose={() => setModal(null)} onDone={(id) => { setModal(null); refresh(); router.push(`/cash/session?id=${id}`); }} />}
      {collect && <CollectModal order={collect} cur={cur} onClose={() => setCollect(null)} onDone={() => { setCollect(null); refresh(); }} />}
    </GlassPage>
  );
}