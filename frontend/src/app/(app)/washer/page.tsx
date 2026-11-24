'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, CloudOff, MessageCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useOnline } from '@/lib/net';
import { useLocalOrders, usePendingOps } from '@/lib/offline/hooks';
import { mergeOrderList } from '@/lib/offline/merge';
import { changeStatusOffline } from '@/lib/offline/sync';
import { METHODS, cn, dateTime, money, hasVehicle, vehicleName } from '@/lib/utils';
import { Button, Card, CardContent, Empty, ErrorText, PageHeader, StatusBadge } from '@/components/ui';

const done = (o: any) => o.status === 'FINALIZADO' || o.status === 'ENTREGADO';
const balance = (o: any) => (o.total == null ? 0 : Number(o.total) - (o.payments ?? []).reduce((s: number, p: any) => s + Number(p.amount), 0));

/** Vista de trabajo: dos estados (Recibido / Finalizado). Un toque para finalizar; las finalizadas se cobran y se avisan desde aquí. */
export default function WasherPage() {
  const { user, can } = useAuth();
  const online = useOnline();
  const qc = useQueryClient();
  const isAdmin = !can('orders:own_only');
  const cur = user?.tenant.currency;
  const [tab, setTab] = useState<'ALL' | 'OPEN' | 'DONE'>('ALL');
  const [method, setMethod] = useState('CASH');
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState<unknown>();
  const q = useQuery({ queryKey: ['orders', 'active'], queryFn: () => api<any[]>('/orders?active=true'), refetchInterval: online ? 15_000 : false });
  const locals = useLocalOrders(user?.tenant.id) ?? [];
  const ops = usePendingOps(user?.tenant.id) ?? [];
  const rows = mergeOrderList(q.data, locals, ops, { active: true, assignedToId: isAdmin ? undefined : user?.id });
  const open = rows.filter((o) => !done(o));
  const fin = rows.filter(done);
  const shown = tab === 'OPEN' ? open : tab === 'DONE' ? fin : rows;

  const canCollect = can('orders:collect');
  const canNotify = can('orders:notify');
  const canStatus = can('orders:status');

  async function run(id: string, fn: () => Promise<unknown>) {
    setErr(undefined); setBusy(id);
    try { await fn(); } catch (e) { setErr(e); } finally { setBusy(''); }
  }
  const finish = (id: string) => run(id, () => changeStatusOffline(id, 'FINALIZADO'));
  const finishAll = () => run('all', async () => { for (const o of open) await changeStatusOffline(o.id, 'FINALIZADO'); });
  const collect = (o: any) => run(o.id, async () => {
    await api(`/orders/${o.id}/payments`, { body: { method } });
    ['orders', 'cash', 'dashboard', 'finance'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  });

  async function notify(id: string) {
    setErr(undefined);
    try {
      const n = await api<any>(`/orders/${id}/notifications`);
      const url = n.whatsapp ?? n.email;
      if (!url) throw new Error('El cliente no tiene teléfono ni correo registrado');
      window.open(url, '_blank');
    } catch (e) { setErr(e); }
  }

  const tabs = [{ k: 'ALL', label: 'Todas', n: rows.length }, { k: 'OPEN', label: 'Por finalizar', n: open.length }, { k: 'DONE', label: 'Finalizadas', n: fin.length }] as const;

  return (
    <>
      <PageHeader title={isAdmin ? 'Trabajo en curso' : 'Mis órdenes'}>
        {canStatus && open.length > 1 && <Button variant="outline" size="sm" disabled={busy === 'all'} onClick={() => void finishAll()}><CheckCheck className="h-4 w-4" />Finalizar las {open.length}</Button>}
      </PageHeader>
      <div className="mb-3 flex flex-wrap gap-2" role="tablist" aria-label="Etapa">
        {tabs.map((t) => (
          <button key={t.k} role="tab" aria-selected={tab === t.k} onClick={() => setTab(t.k)}
            className={cn('rounded-full border px-4 py-1.5 text-sm font-medium', tab === t.k ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted')}>
            {t.label} <span className="opacity-70">({t.n})</span>
          </button>
        ))}
      </div>
      <ErrorText error={err} />
      {shown.length === 0 && <Empty text={q.isLoading ? 'Cargando.' : 'No hay órdenes aquí'} />}
      <div className="grid gap-3 md:grid-cols-2">
        {shown.map((o) => {
          const due = balance(o);
          const showMoney = o.total != null;
          const fd = done(o);
          const payNow = fd && canCollect && due > 0.005 && online && !o.pending;
          return (
            <Card key={o.id}><CardContent className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/orders/detail?id=${o.id}`} className="min-w-0">
                  <p className="text-lg font-semibold">{vehicleName(o)}</p>
                  {hasVehicle(o) ? <p className="text-sm text-muted-foreground">{o.vehicle.color} · <span className="font-mono">{o.vehicle.plate}</span></p> : <p className="text-sm text-muted-foreground">{o.client?.name ?? 'Sin cliente'}</p>}
                  <p className="text-xs text-muted-foreground">
                    {o.folio ?? 'Folio por asignar'} · {dateTime(o.receivedAt)}{isAdmin && ` · ${o.assignedTo?.fullName ?? 'Sin asignar'}`}
                    {o.pending && <CloudOff className="ml-2 inline h-3.5 w-3.5 text-sky-600" aria-label="Pendiente de sincronizar" />}
                  </p>
                </Link>
                <StatusBadge status={fd ? 'FINALIZADO' : 'RECIBIDO'} />
              </div>
              <p className="text-sm">{o.items.map((i: any) => `${i.quantity}× ${i.name}`).join(', ')}</p>
              {showMoney && fd && (due > 0.005
                ? <p className="rounded-md bg-amber-500 px-3 py-1.5 text-sm font-bold text-white">Por cobrar {money(due, cur)}</p>
                : <p className="text-sm font-medium text-emerald-600">Pagada</p>)}

              <div className="flex flex-wrap items-center gap-2">
                {!fd && canStatus && (
                  <Button size="lg" variant="success" className="h-12 flex-1 text-base" disabled={busy === o.id} onClick={() => void finish(o.id)}>Finalizar</Button>
                )}
                {payNow && (
                  <>
                    <select className="h-12 rounded-md border bg-background px-2 text-sm" aria-label="Método de pago" value={method} onChange={(e) => setMethod(e.target.value)}>
                      {Object.entries(METHODS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                    <Button size="lg" variant="success" className="h-12 flex-1 text-base" disabled={busy === o.id} onClick={() => void collect(o)}>Cobrar {money(due, cur)}</Button>
                  </>
                )}
                {fd && canNotify && (
                  <Button variant="outline" className="h-12" disabled={!online || o.pending} onClick={() => void notify(o.id)}><MessageCircle className="h-4 w-4" />Avisar</Button>
                )}
                <Link href={`/orders/detail?id=${o.id}`} className="inline-flex h-12 items-center rounded-md border px-4 text-sm hover:bg-muted">Detalle</Link>
              </div>
            </CardContent></Card>
          );
        })}
      </div>
    </>
  );
}
