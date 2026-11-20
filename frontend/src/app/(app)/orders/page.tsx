'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, ArchiveRestore, Banknote, Check, CheckCheck, CloudOff, MessageCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useOnline } from '@/lib/net';
import { useLocalOrders, usePendingOps } from '@/lib/offline/hooks';
import { mergeOrderList } from '@/lib/offline/merge';
import { changeStatusOffline } from '@/lib/offline/sync';
import { METHODS, STATUS, STATUS_ORDER, cn, dateTime, money } from '@/lib/utils';
import { Modal } from '@/components/modal';
import { Button, Card, Empty, ErrorText, Input, PageHeader, Select, StatusBadge } from '@/components/ui';
import { DownloadButton } from '@/components/download-button';

type View = 'all' | 'open' | 'due' | 'paid' | 'archived';

/** YYYY-MM-DD en hora local. */
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d); };
const DAY_CHIPS: { label: string; from: () => string; to: () => string }[] = [
  { label: 'Hoy', from: () => daysAgo(0), to: () => daysAgo(0) },
  { label: 'Ayer', from: () => daysAgo(1), to: () => daysAgo(1) },
  { label: '7 días', from: () => daysAgo(6), to: () => daysAgo(0) },
  { label: '30 días', from: () => daysAgo(29), to: () => daysAgo(0) },
  { label: 'Todo', from: () => '', to: () => '' },
];
const paidOf = (o: any) => (o.payments ?? []).reduce((s: number, p: any) => s + Number(p.amount), 0);
const balanceOf = (o: any) => (o.total == null ? 0 : Math.max(Math.round((Number(o.total) - paidOf(o)) * 100) / 100, 0));
const isDone = (o: any) => o.status === 'FINALIZADO' || o.status === 'ENTREGADO';
/** Aún sin folio = creada sin conexión y no sincronizada: cobrar/avisar requieren el servidor. */
const synced = (o: any) => !o.pending && !!o.folio;

export default function OrdersPage() {
  const { user, can } = useAuth();
  const qc = useQueryClient();
  const online = useOnline();
  const cur = user?.tenant.currency;
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [view, setView] = useState<View>('all');
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>();
  const [collect, setCollect] = useState<any[] | null>(null);
  const [notify, setNotify] = useState<any[] | null>(null);

  const q = useQuery({
    queryKey: ['orders', search, status, from, to, view === 'archived'],
    queryFn: () => api<any[]>(`/orders?${new URLSearchParams({ ...(search && { search }), ...(status && { status }), ...(from && { from: new Date(from + 'T00:00:00').toISOString() }), ...(to && { to: new Date(new Date(to + 'T00:00:00').getTime() + 86_400_000).toISOString() }), ...(view === 'archived' && { archived: 'true' }), limit: '200' })}`),
    refetchInterval: online ? 20_000 : false,
  });
  const locals = useLocalOrders(user?.tenant.id) ?? [];
  const ops = usePendingOps(user?.tenant.id) ?? [];
  // Las archivadas vienen solo del servidor (una orden sin sincronizar no puede estar archivada)
  const all = view === 'archived' ? (q.data ?? []) : mergeOrderList(q.data, locals, ops, { search, status, from, to });

  const canPrices = can('orders:prices');
  const canStatus = can('orders:status');
  const canCollect = can('orders:collect') && canPrices;
  const canNotify = can('orders:notify');
  const canArchive = can('orders:archive');

  const dueRows = all.filter((o) => balanceOf(o) > 0.005);
  const dueTotal = dueRows.reduce((s, o) => s + balanceOf(o), 0);
  const rows = useMemo(() => all.filter((o) => (
    view === 'all' || view === 'archived' ? true : view === 'open' ? !isDone(o) : view === 'due' ? balanceOf(o) > 0.005 : o.total != null && balanceOf(o) <= 0.005 && paidOf(o) > 0
  )), [all, view]);
  const chosen = rows.filter((o) => sel.has(o.id));
  const allChecked = rows.length > 0 && rows.every((o) => sel.has(o.id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const toggleAll = () => setSel(allChecked ? new Set() : new Set(rows.map((o) => o.id)));
  const archivable = (o: any) => isDone(o) && o.total != null && balanceOf(o) <= 0.005 && synced(o);
  async function archive(list: any[], archived: boolean) {
    const ids = list.filter((o) => (archived ? archivable(o) : true)).map((o) => o.id);
    if (!ids.length) return;
    setBusy(true); setErr(undefined);
    try { await api('/orders/archive', { body: { ids, archived } }); setSel(new Set()); refresh(); } catch (e) { setErr(e); }
    setBusy(false);
  }
  const refresh = () => ['orders', 'cash', 'dashboard', 'finance'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  /** Marca como finalizadas (funciona sin conexión: queda en cola y se sincroniza). */
  async function finalize(list: any[]) {
    const todo = list.filter((o) => !isDone(o));
    if (!todo.length) return;
    setBusy(true); setErr(undefined);
    try { for (const o of todo) await changeStatusOffline(o.id, 'FINALIZADO'); } catch (e) { setErr(e); }
    setBusy(false);
  }
  async function finalizeAndNotify() {
    await finalize(chosen);
    const ready = chosen.filter((o) => synced(o));
    if (canNotify && ready.length) setNotify(ready);
  }

  const chips: { k: View; label: string; n?: number; cls?: string }[] = [
    { k: 'all', label: 'Todas' },
    { k: 'open', label: 'Por finalizar', n: all.filter((o) => !isDone(o)).length },
    ...(canPrices ? [{ k: 'due' as View, label: 'Por cobrar', n: dueRows.length, cls: 'border-amber-500 text-amber-700 dark:text-amber-300' }, { k: 'paid' as View, label: 'Pagadas' }] : []),
    ...(canArchive ? [{ k: 'archived' as View, label: 'Archivadas' }] : []),
  ];

  return (
    <>
      <PageHeader title="Órdenes e historial">{<DownloadButton type="orders" params={{ from, to }} />}</PageHeader>

      {canPrices && dueRows.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-amber-500/60 bg-amber-500/10 p-4">
          <div className="flex items-center gap-3">
            <Banknote className="h-8 w-8 text-amber-600" />
            <div>
              <p className="text-xs font-medium uppercase tracking-wide text-amber-700 dark:text-amber-300">Pendiente de cobro</p>
              <p className="text-2xl font-bold">{money(dueTotal, cur)} <span className="text-sm font-normal text-muted-foreground">en {dueRows.length} {dueRows.length === 1 ? 'orden' : 'órdenes'}</span></p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => setView('due')}>Ver por cobrar</Button>
            {canCollect && <Button size="lg" variant="success" disabled={!online || !dueRows.some(synced)} onClick={() => setCollect(dueRows.filter(synced))}>Cobrar todas</Button>}
          </div>
        </div>
      )}

      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <Input placeholder="Buscar folio, código, placa o cliente" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-48" aria-label="Estado">
          <option value="">Todos los estados</option>
          {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
        </Select>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="sm:w-40" aria-label="Desde" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="sm:w-40" aria-label="Hasta" />
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2" role="group" aria-label="Filtrar por días">
        <span className="text-xs font-medium text-muted-foreground">Días:</span>
        {DAY_CHIPS.map((c) => {
          const on = from === c.from() && to === c.to();
          return <button key={c.label} aria-pressed={on} onClick={() => { setFrom(c.from()); setTo(c.to()); }} className={cn('rounded-full border px-3 py-1 text-xs font-medium', on ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted')}>{c.label}</button>;
        })}
      </div>
      <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Vista">
        {chips.map((c) => (
          <button key={c.k} role="tab" aria-selected={view === c.k} onClick={() => setView(c.k)} className={cn('rounded-full border px-4 py-1.5 text-sm font-medium', view === c.k ? 'border-primary bg-primary text-primary-foreground' : c.cls ?? 'hover:bg-muted')}>
            {c.label}{c.n !== undefined && <span className="ml-1 opacity-70">({c.n})</span>}
          </button>
        ))}
      </div>

      {chosen.length > 0 && (
        <div className="sticky top-2 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-xl border bg-card p-3 shadow-lg" role="toolbar" aria-label="Acciones masivas">
          <span className="mr-auto text-sm font-semibold">{chosen.length} seleccionada{chosen.length === 1 ? '' : 's'}</span>
          {canStatus && <Button variant="outline" disabled={busy || !chosen.some((o) => !isDone(o))} onClick={() => void finalize(chosen)}><CheckCheck className="h-4 w-4" />Marcar finalizadas</Button>}
          {canStatus && canNotify && <Button disabled={busy || !online || !chosen.some(synced)} onClick={() => void finalizeAndNotify()}><MessageCircle className="h-4 w-4" />Finalizar y avisar</Button>}
          {canNotify && <Button variant="outline" disabled={!online || !chosen.some((o) => isDone(o) && synced(o))} onClick={() => setNotify(chosen.filter((o) => isDone(o) && synced(o)))}><MessageCircle className="h-4 w-4" />Avisar</Button>}
          {canArchive && view !== 'archived' && <Button variant="outline" disabled={busy || !online || !chosen.some(archivable)} title="Solo finalizadas y pagadas" onClick={() => void archive(chosen, true)}><Archive className="h-4 w-4" />Archivar</Button>}
          {canArchive && view === 'archived' && <Button variant="outline" disabled={busy || !online} onClick={() => void archive(chosen, false)}><ArchiveRestore className="h-4 w-4" />Desarchivar</Button>}
          {canCollect && <Button variant="success" disabled={!online || !chosen.some((o) => balanceOf(o) > 0.005 && synced(o))} onClick={() => setCollect(chosen.filter((o) => balanceOf(o) > 0.005 && synced(o)))}><Banknote className="h-4 w-4" />Cobrar</Button>}
          <Button variant="ghost" onClick={() => setSel(new Set())}>Quitar selección</Button>
        </div>
      )}
      <ErrorText error={err} />

      <Card className="divide-y">
        {rows.length > 0 && (
          <label className="flex items-center gap-3 bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
            <input type="checkbox" aria-label="Seleccionar todas" checked={allChecked} onChange={toggleAll} className="h-4 w-4" />
            Seleccionar todas las que se ven ({rows.length})
          </label>
        )}
        {rows.length === 0 && <Empty text={q.isLoading ? 'Cargando…' : 'Sin resultados'} />}
        {rows.map((o) => {
          const bal = balanceOf(o);
          const known = o.total != null;
          return (
            <div key={o.id} className={cn('flex items-center gap-3 p-4', sel.has(o.id) && 'bg-primary/5')}>
              <input type="checkbox" aria-label={`Seleccionar ${o.folio ?? o.vehicle.plate}`} checked={sel.has(o.id)} onChange={() => toggle(o.id)} className="h-5 w-5 shrink-0" />
              <Link href={`/orders/detail?id=${o.id}`} className="min-w-0 flex-1 hover:underline">
                <p className="truncate text-sm font-medium">
                  {o.folio ?? 'Folio por asignar'} · {o.vehicle.brand} {o.vehicle.model} <span className="font-mono text-muted-foreground">{o.vehicle.plate}</span>
                  {o.pending && <CloudOff className="ml-2 inline h-3.5 w-3.5 text-sky-600" aria-label="Pendiente de sincronizar" />}
                </p>
                <p className="truncate text-xs text-muted-foreground">{dateTime(o.receivedAt)} · {o.client?.name ?? 'Sin cliente'} · {o.assignedTo?.fullName ?? 'Sin asignar'}</p>
              </Link>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                {known && <span className="hidden text-sm font-medium sm:block">{money(o.total, cur)}</span>}
                <StatusBadge status={o.status === 'ENTREGADO' ? 'FINALIZADO' : o.status} />
                {known && (bal > 0.005
                  ? <span className="rounded-md bg-amber-500 px-2 py-1 text-xs font-bold text-white" data-testid="due">Por cobrar {money(bal, cur)}</span>
                  : <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300"><Check className="h-3 w-3" />Pagada</span>)}
                {canCollect && bal > 0.005 && <Button size="sm" variant="success" disabled={!online || !synced(o)} title={!synced(o) ? 'Se puede cobrar cuando la orden se sincronice' : undefined} onClick={() => setCollect([o])}>Cobrar</Button>}
                {canStatus && !isDone(o) && <Button size="sm" variant="outline" disabled={busy} onClick={() => void finalize([o])}>Finalizar</Button>}
                {canArchive && view !== 'archived' && archivable(o) && <Button size="sm" variant="ghost" disabled={busy || !online} onClick={() => void archive([o], true)}><Archive className="h-3.5 w-3.5" />Archivar</Button>}
                {canArchive && view === 'archived' && <Button size="sm" variant="ghost" disabled={busy || !online} onClick={() => void archive([o], false)}><ArchiveRestore className="h-3.5 w-3.5" />Desarchivar</Button>}
              </div>
            </div>
          );
        })}
      </Card>

      {collect && <CollectModal orders={collect} cur={cur} onClose={() => { setCollect(null); refresh(); }} />}
      {notify && <NotifyModal orders={notify} onClose={() => { setNotify(null); refresh(); }} />}
    </>
  );
}

/** Cobro de una o varias órdenes con el mismo método de pago (se registra el saldo completo de cada una). */
function CollectModal({ orders, cur, onClose }: { orders: any[]; cur?: string; onClose: () => void }) {
  const [method, setMethod] = useState('CASH');
  const [state, setState] = useState<Record<string, 'ok' | string>>({});
  const [running, setRunning] = useState(false);
  const total = orders.reduce((s, o) => s + balanceOf(o), 0);
  const finished = Object.keys(state).length === orders.length;

  async function run() {
    setRunning(true);
    for (const o of orders) {
      if (state[o.id] === 'ok') continue;
      try { await api(`/orders/${o.id}/payments`, { body: { method } }); setState((s) => ({ ...s, [o.id]: 'ok' })); }
      catch (e) { setState((s) => ({ ...s, [o.id]: (e as Error).message })); }
    }
    setRunning(false);
  }

  return (
    <Modal title={orders.length === 1 ? `Cobrar ${orders[0].folio}` : `Cobrar ${orders.length} órdenes`} onClose={running ? undefined : onClose}>
      <div className="space-y-4 p-4">
        <div className="max-h-56 space-y-1 overflow-y-auto rounded-lg bg-muted p-3 text-sm">
          {orders.map((o) => (
            <div key={o.id} className="flex items-center justify-between gap-2">
              <span className="truncate">{o.folio} · {o.vehicle.plate} · {o.client?.name ?? 'Sin cliente'}</span>
              <span className="shrink-0 font-medium">
                {state[o.id] === 'ok' ? <span className="text-emerald-600">Cobrada</span> : state[o.id] ? <span className="text-red-600" title={state[o.id]}>Error</span> : money(balanceOf(o), cur)}
              </span>
            </div>
          ))}
        </div>
        <p className="flex items-baseline justify-between text-lg font-semibold"><span>Total a cobrar</span><span>{money(total, cur)}</span></p>
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(METHODS).map(([k, l]) => (
            <button key={k} type="button" onClick={() => setMethod(k)} className={cn('rounded-lg border p-3 text-sm font-medium hover:bg-muted', method === k && 'border-primary bg-primary/10 text-primary')}>{l}</button>
          ))}
        </div>
        {Object.values(state).filter((v) => v !== 'ok').map((v, i) => <ErrorText key={i} error={new Error(v)} />)}
        {finished && Object.values(state).every((v) => v === 'ok')
          ? <Button size="lg" className="w-full" onClick={onClose}>Listo</Button>
          : <Button size="lg" variant="success" className="w-full" disabled={running} onClick={() => void run()}>{running ? 'Cobrando…' : `Cobrar ${money(total, cur)}`}</Button>}
      </div>
    </Modal>
  );
}

/** Aviso masivo «tu vehículo está listo»: cada cliente recibe su mensaje; tú confirmas el envío en WhatsApp (sin APIs de pago). */
function NotifyModal({ orders, onClose }: { orders: any[]; onClose: () => void }) {
  const info = useQuery({
    queryKey: ['notify-bulk', orders.map((o) => o.id).join(',')],
    queryFn: async () => Object.fromEntries(await Promise.all(orders.map(async (o) => [o.id, await api<any>(`/orders/${o.id}/notifications`).catch(() => null)]))),
  });
  const [sent, setSent] = useState<Set<string>>(new Set());
  const mark = (id: string) => setSent((s) => new Set(s).add(id));
  const link = (o: any) => info.data?.[o.id]?.whatsapp ?? info.data?.[o.id]?.email ?? null;
  const pending = orders.filter((o) => link(o) && !sent.has(o.id));

  return (
    <Modal title={`Avisar a ${orders.length} cliente${orders.length === 1 ? '' : 's'}`} onClose={onClose}>
      <div className="space-y-3 p-4">
        <p className="text-xs text-muted-foreground">Se abre WhatsApp (o el correo) con el mensaje «listo para entrega» ya escrito; solo confirmas el envío.</p>
        <Button size="lg" className="w-full" disabled={!pending.length} onClick={() => { const o = pending[0]; window.open(link(o), '_blank'); mark(o.id); }}>
          <MessageCircle className="h-4 w-4" />{pending.length ? `Enviar siguiente (${pending.length} por avisar)` : 'Todos avisados'}
        </Button>
        <div className="max-h-72 divide-y overflow-y-auto rounded-lg border">
          {info.isLoading && <p className="p-3 text-sm text-muted-foreground">Preparando mensajes…</p>}
          {orders.map((o) => {
            const n = info.data?.[o.id];
            return (
              <div key={o.id} className="flex items-center justify-between gap-2 p-3 text-sm">
                <span className="min-w-0 truncate">{n?.clientName ?? o.client?.name ?? 'Sin nombre'} · <span className="font-mono">{o.vehicle.plate}</span></span>
                {!info.isLoading && !link(o) ? <span className="shrink-0 text-xs text-amber-600">Sin teléfono ni correo</span>
                  : sent.has(o.id) ? <span className="shrink-0 text-xs text-emerald-600">Avisado</span>
                  : link(o) && <a className="shrink-0 rounded-md border px-3 py-1 text-xs hover:bg-muted" href={link(o)!} target="_blank" rel="noreferrer" onClick={() => mark(o.id)}>{n?.whatsapp ? 'WhatsApp' : 'Correo'}</a>}
              </div>
            );
          })}
        </div>
        <Button variant="outline" className="w-full" onClick={onClose}>Cerrar</Button>
      </div>
    </Modal>
  );
}
