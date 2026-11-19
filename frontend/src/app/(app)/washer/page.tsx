'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CloudOff, MessageCircle } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useOnline } from '@/lib/net';
import { useLocalOrders, usePendingOps } from '@/lib/offline/hooks';
import { mergeOrderList } from '@/lib/offline/merge';
import { changeStatusOffline } from '@/lib/offline/sync';
import { NEXT, STATUS, dateTime, type Status } from '@/lib/utils';
import { Button, Card, CardContent, Empty, ErrorText, PageHeader, StatusBadge } from '@/components/ui';

/** Vista del lavador (y vista de carga de trabajo para el administrador). Sin datos financieros. Funciona sin conexion. */
export default function WasherPage() {
  const { user, can } = useAuth();
  const online = useOnline();
  const isAdmin = !can('orders:own_only');
  const [err, setErr] = useState<unknown>();
  const q = useQuery({ queryKey: ['orders', 'active'], queryFn: () => api<any[]>('/orders?active=true'), refetchInterval: online ? 15_000 : false });
  const locals = useLocalOrders(user?.tenant.id) ?? [];
  const ops = usePendingOps(user?.tenant.id) ?? [];
  const rows = mergeOrderList(q.data, locals, ops, { active: true, assignedToId: isAdmin ? undefined : user?.id });

  /** Aviso rápido "listo para entrega": abre WhatsApp (o correo) con el mensaje precargado; el empleado solo confirma. */
  async function notify(id: string) {
    setErr(undefined);
    try {
      const n = await api<any>(`/orders/${id}/notifications`);
      const url = n.whatsapp ?? n.email;
      if (!url) throw new Error('El cliente no tiene teléfono ni correo registrado');
      window.open(url, '_blank');
    } catch (e) { setErr(e); }
  }

  async function move(id: string, s: Status) {
    setErr(undefined);
    try { await changeStatusOffline(id, s); } catch (e) { setErr(e); }
  }

  return (
    <>
      <PageHeader title={isAdmin ? 'Trabajo en curso' : 'Mis órdenes'} />
      <ErrorText error={err} />
      {rows.length === 0 && <Empty text={q.isLoading ? 'Cargando…' : 'No hay órdenes activas'} />}
      <div className="grid gap-3 md:grid-cols-2">
        {rows.map((o) => {
          const next = (NEXT[o.status as Status] ?? []).filter((s) => s !== 'ENTREGADO');
          return (
            <Card key={o.id}><CardContent className="space-y-3">
              <div className="flex items-start justify-between gap-2">
                <Link href={`/orders/detail?id=${o.id}`} className="min-w-0">
                  <p className="text-lg font-semibold">{o.vehicle.brand} {o.vehicle.model}</p>
                  <p className="text-sm text-muted-foreground">{o.vehicle.color} · <span className="font-mono">{o.vehicle.plate}</span></p>
                  <p className="text-xs text-muted-foreground">
                    {o.folio ?? 'Folio por asignar'} · {dateTime(o.receivedAt)}{isAdmin && ` · ${o.assignedTo?.fullName ?? 'Sin asignar'}`}
                    {o.pending && <CloudOff className="ml-2 inline h-3.5 w-3.5 text-sky-600" aria-label="Pendiente de sincronizar" />}
                  </p>
                </Link>
                <StatusBadge status={o.status} />
              </div>
              <p className="text-sm">{o.items.map((i: any) => `${i.quantity}× ${i.name}`).join(', ')}</p>
              <div className="flex flex-wrap gap-2">
                {next.map((s) => (
                  <Button key={s} variant={s === 'FINALIZADO' ? 'success' : 'default'} onClick={() => move(o.id, s)}>
                    {STATUS[s].label}
                  </Button>
                ))}
                {(o.status === 'FINALIZADO' || o.status === 'SECADO') && (
                  <Button variant="outline" disabled={!online || o.pending} onClick={() => notify(o.id)}><MessageCircle className="h-4 w-4" />Avisar al cliente</Button>
                )}
                <Link href={`/orders/detail?id=${o.id}`} className="inline-flex h-10 items-center rounded-md border px-4 text-sm hover:bg-muted">Fotos y detalle</Link>
              </div>
            </CardContent></Card>
          );
        })}
      </div>
    </>
  );
}
