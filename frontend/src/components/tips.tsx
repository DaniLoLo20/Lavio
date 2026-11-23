'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { HandCoins, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useOnline } from '@/lib/net';
import { METHODS, cn, dateTime, money } from '@/lib/utils';
import { Modal } from './modal';
import { Glass } from './glass';
import { Badge, Button, CardContent, CardHeader, CardTitle, Empty, ErrorText, Input, Label, Select } from './ui';

interface Person { washerId: string | null; name: string; collected: number; paidOut: number; pending: number }
interface Balance { people: Person[]; totals: { collected: number; paidOut: number; pending: number }; recent: any[] }

export const useTips = (enabled = true) => {
  const { can } = useAuth();
  return useQuery({ queryKey: ['cash', 'tips'], queryFn: () => api<Balance>('/cash/tips'), enabled: enabled && (can('cash:view') || can('cash:tips')), refetchInterval: 30_000 });
};

/** Propina escrita en un cobro: atajos de % sobre el total y monto libre. `onChange` entrega el texto del monto. */
export function TipField({ base, value, onChange, cur, className }: { base: number; value: string; onChange: (v: string) => void; cur?: string; className?: string }) {
  const n = Number(value) || 0;
  const pct = (p: number) => String(Math.round(((base * p) / 100) * 100) / 100);
  return (
    <div className={className}>
      <Label>Propina (opcional)</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input type="number" min="0" step="0.01" inputMode="decimal" aria-label="Propina" placeholder="0.00" className="h-10 w-28" value={value} onChange={(e) => onChange(e.target.value)} />
        {[10, 15, 20].map((p) => (
          <button key={p} type="button" onClick={() => onChange(pct(p))} className={cn('rounded-full border px-3 py-1 text-xs hover:bg-muted', value === pct(p) && 'border-primary bg-primary/10 text-primary')}>{p}%</button>
        ))}
        {n > 0 && <button type="button" onClick={() => onChange('')} className="text-xs text-muted-foreground underline">Quitar</button>}
      </div>
      {n > 0 && <p className="mt-1 text-xs text-muted-foreground">Se registra aparte (no es venta). Total a recibir: <b>{money(base + n, cur)}</b></p>}
    </div>
  );
}

/** Registra la propina de una orden en la caja abierta. Devuelve un mensaje si no se pudo (nunca lanza). */
export async function sendTip(p: { amount: number; method: string; orderId?: string; washerId?: string }): Promise<string | null> {
  if (!(p.amount > 0)) return null;
  try { await api('/cash/tips', { body: p }); return null; }
  catch (e) { return (e as Error).message || 'No se pudo registrar la propina'; }
}

export function TipsPanel({ cur }: { cur?: string }) {
  const { can } = useAuth();
  const online = useOnline();
  const qc = useQueryClient();
  const q = useTips();
  const canTips = can('cash:tips');
  const [modal, setModal] = useState<null | 'new' | Person>(null);
  const refresh = () => ['cash'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
  const d = q.data;

  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <Glass><CardContent><p className="text-xs text-muted-foreground">Recibidas</p><p className="mt-1 text-2xl font-semibold">{money(d?.totals.collected ?? 0, cur)}</p></CardContent></Glass>
        <Glass><CardContent><p className="text-xs text-muted-foreground">Entregadas</p><p className="mt-1 text-2xl font-semibold">{money(d?.totals.paidOut ?? 0, cur)}</p></CardContent></Glass>
        <Glass className={cn((d?.totals.pending ?? 0) > 0.004 && 'border-2 border-amber-500/60 bg-amber-500/10')}><CardContent><p className="text-xs text-muted-foreground">Por entregar</p><p className="mt-1 text-2xl font-bold">{money(d?.totals.pending ?? 0, cur)}</p></CardContent></Glass>
      </div>
      <p className="text-xs text-muted-foreground">Las propinas son dinero del personal: no cuentan como venta ni como gasto, pero sí como efectivo en el cajón hasta que se entregan.</p>

      <Glass>
        <CardHeader className="flex-wrap gap-2">
          <CardTitle>Saldo por persona</CardTitle>
          {canTips && <Button size="sm" disabled={!online} onClick={() => setModal('new')}><Plus className="h-4 w-4" />Registrar propina</Button>}
        </CardHeader>
        {!d?.people.length ? <Empty text="Aún no hay propinas" /> : (
          <div className="divide-y">
            {d.people.map((p) => (
              <div key={p.washerId ?? 'general'} className="flex flex-wrap items-center justify-between gap-3 p-4 text-sm">
                <div className="min-w-0">
                  <p className="font-medium">{p.name}</p>
                  <p className="text-xs text-muted-foreground">Recibidas {money(p.collected, cur)} · Entregadas {money(p.paidOut, cur)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className={cn('text-lg font-bold', p.pending > 0.004 ? 'text-amber-600' : 'text-emerald-600')}>{money(p.pending, cur)}</span>
                  {canTips && p.pending > 0.004 && <Button size="sm" variant="success" disabled={!online} onClick={() => setModal(p)}><HandCoins className="h-4 w-4" />Entregar</Button>}
                </div>
              </div>
            ))}
          </div>
        )}
      </Glass>

      {!!d?.recent.length && (
        <Glass>
          <CardHeader><CardTitle>Últimos movimientos</CardTitle></CardHeader>
          <div className="divide-y">
            {d.recent.map((m) => (
              <div key={m.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0"><p className="truncate">{m.concept}</p><p className="text-xs text-muted-foreground">{m.responsibleName} · {METHODS[m.method]} · {dateTime(m.occurredAt)}</p></div>
                <span className="shrink-0 font-medium">{m.type === 'INCOME' ? <Badge className="bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">+ {money(m.amount, cur)}</Badge> : <Badge className="bg-red-500/15 text-red-700 dark:text-red-300">− {money(m.amount, cur)}</Badge>}</span>
              </div>
            ))}
          </div>
        </Glass>
      )}

      {modal === 'new' && <NewTip cur={cur} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
      {modal && modal !== 'new' && <Payout person={modal} cur={cur} onClose={() => setModal(null)} onDone={() => { setModal(null); refresh(); }} />}
    </div>
  );
}

function NewTip({ cur, onClose, onDone }: { cur?: string; onClose: () => void; onDone: () => void }) {
  const washers = useQuery({ queryKey: ['washers'], queryFn: () => api<any[]>('/users/washers') });
  const [f, setF] = useState({ amount: '', method: 'CASH', washerId: '', note: '' });
  const save = useMutation({
    mutationFn: () => api('/cash/tips', { body: { amount: Number(f.amount), method: f.method, washerId: f.washerId || undefined, note: f.note || undefined } }),
    onSuccess: onDone,
  });
  return (
    <Modal title="Registrar propina" onClose={onClose}>
      <form className="space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <div><Label>Monto *</Label><Input required autoFocus type="number" min="0.01" step="0.01" inputMode="decimal" aria-label="Monto de la propina" className="h-12 text-lg" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /></div>
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(METHODS).map(([k, l]) => <button key={k} type="button" onClick={() => setF({ ...f, method: k })} className={cn('rounded-lg border p-2.5 text-sm font-medium hover:bg-muted', f.method === k && 'border-primary bg-primary/10 text-primary')}>{l}</button>)}
        </div>
        <div><Label>Para</Label>
          <Select value={f.washerId} onChange={(e) => setF({ ...f, washerId: e.target.value })} aria-label="Para quién es la propina">
            <option value="">Propina general (sin asignar)</option>
            {washers.data?.filter((w) => w.isActive).map((w) => <option key={w.id} value={w.id}>{w.fullName}</option>)}
          </Select>
        </div>
        <div><Label>Nota</Label><Input value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Opcional" /></div>
        <ErrorText error={save.error} />
        <Button size="lg" className="w-full" disabled={save.isPending || !(Number(f.amount) > 0)}>{save.isPending ? 'Guardando…' : `Registrar ${money(Number(f.amount) || 0, cur)}`}</Button>
      </form>
    </Modal>
  );
}

function Payout({ person, cur, onClose, onDone }: { person: Person; cur?: string; onClose: () => void; onDone: () => void }) {
  const [amount, setAmount] = useState(String(person.pending));
  const [method, setMethod] = useState('CASH');
  const save = useMutation({
    mutationFn: () => api('/cash/tips/payout', { body: { washerId: person.washerId ?? undefined, amount: Number(amount), method } }),
    onSuccess: onDone,
  });
  const n = Number(amount) || 0;
  return (
    <Modal title={`Entregar propinas · ${person.name}`} onClose={onClose}>
      <form className="space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
        <p className="text-sm text-muted-foreground">Pendiente: <b>{money(person.pending, cur)}</b>. Sale de la caja como «Pago de propinas».</p>
        <div><Label>Monto a entregar</Label><Input required autoFocus type="number" min="0.01" max={person.pending} step="0.01" inputMode="decimal" aria-label="Monto a entregar" className="h-12 text-lg" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(METHODS).map(([k, l]) => <button key={k} type="button" onClick={() => setMethod(k)} className={cn('rounded-lg border p-2.5 text-sm font-medium hover:bg-muted', method === k && 'border-primary bg-primary/10 text-primary')}>{l}</button>)}
        </div>
        <ErrorText error={save.error} />
        <Button size="lg" variant="success" className="w-full" disabled={save.isPending || n <= 0 || n > person.pending + 0.005}>{save.isPending ? 'Entregando…' : `Entregar ${money(n, cur)}`}</Button>
      </form>
    </Modal>
  );
}
