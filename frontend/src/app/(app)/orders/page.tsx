'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { CloudOff } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useOnline } from '@/lib/net';
import { useLocalOrders, usePendingOps } from '@/lib/offline/hooks';
import { mergeOrderList } from '@/lib/offline/merge';
import { STATUS, STATUS_ORDER, dateTime, money } from '@/lib/utils';
import { Card, Empty, Input, PageHeader, Select, StatusBadge } from '@/components/ui';
import { DownloadButton } from '@/components/download-button';

export default function OrdersPage() {
  const { user } = useAuth();
  const online = useOnline();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const q = useQuery({
    queryKey: ['orders', search, status, from, to],
    queryFn: () => api<any[]>(`/orders?${new URLSearchParams({ ...(search && { search }), ...(status && { status }), ...(from && { from }), ...(to && { to }) })}`),
    refetchInterval: online ? 20_000 : false,
  });
  const locals = useLocalOrders(user?.tenant.id) ?? [];
  const ops = usePendingOps(user?.tenant.id) ?? [];
  const rows = mergeOrderList(q.data, locals, ops, { search, status, from, to });

  return (
    <>
      <PageHeader title="Órdenes e historial">{<DownloadButton type="orders" params={{ from, to }} />}</PageHeader>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Input placeholder="Buscar folio, código, placa o cliente" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-48">
          <option value="">Todos los estados</option>
          {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
        </Select>
        <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="sm:w-40" aria-label="Desde" />
        <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="sm:w-40" aria-label="Hasta" />
      </div>
      <Card className="divide-y">
        {rows.length === 0 && <Empty text={q.isLoading ? 'Cargando…' : 'Sin resultados'} />}
        {rows.map((o) => (
          <Link key={o.id} href={`/orders/detail?id=${o.id}`} className="flex items-center justify-between gap-3 p-4 hover:bg-muted/50">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">
                {o.folio ?? 'Folio por asignar'} · {o.vehicle.brand} {o.vehicle.model} <span className="font-mono text-muted-foreground">{o.vehicle.plate}</span>
                {o.pending && <CloudOff className="ml-2 inline h-3.5 w-3.5 text-sky-600" aria-label="Pendiente de sincronizar" />}
              </p>
              <p className="truncate text-xs text-muted-foreground">{dateTime(o.receivedAt)} · {o.client?.name ?? 'Sin cliente'} · {o.assignedTo?.fullName ?? 'Sin asignar'}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="hidden text-sm sm:block">{o.total != null ? money(o.total, user?.tenant.currency) : ''}</span>
              <StatusBadge status={o.status} />
            </div>
          </Link>
        ))}
      </Card>
    </>
  );
}
