'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { STATUS, STATUS_ORDER, dateTime, money, vehicleName } from '@/lib/utils';
import { Badge, Card, Empty, Input, PageHeader, Select, StatusBadge } from '@/components/ui';
import { CompanySelect } from '@/components/company-filter';

export default function PlatformOrders() {
  const [filter, setFilter] = useState('');
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const q = useQuery({
    queryKey: ['platform', 'orders', filter, status, search],
    queryFn: () => api<any[]>(`/platform/orders?${new URLSearchParams({ ...(filter && { tenantId: filter }), ...(status && { status }), ...(search && { search }) })}`),
    refetchInterval: 20_000,
  });
  const total = (q.data ?? []).reduce((s, o) => s + Number(o.total), 0);

  return (
    <>
      <PageHeader title="Órdenes de todas las empresas">
        <CompanySelect value={filter} onChange={setFilter} allLabel="Todas las empresas" className="w-56" />
      </PageHeader>
      <div className="mb-4 flex flex-col gap-2 sm:flex-row">
        <Input placeholder="Buscar folio, código, placa o cliente" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-48">
          <option value="">Todos los estados</option>
          {STATUS_ORDER.map((s) => <option key={s} value={s}>{STATUS[s].label}</option>)}
        </Select>
      </div>
      <p className="mb-2 text-xs text-muted-foreground">{q.data?.length ?? 0} órdenes (máx. 200 más recientes) · Para operar una orden, entre a la empresa con el botón Entrar en Empresas.</p>
      <Card className="divide-y">
        {q.data?.length === 0 && <Empty text="Sin órdenes" />}
        {q.data?.map((o) => (
          <div key={o.id} className="flex items-center justify-between gap-3 p-4">
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{o.folio} · {vehicleName(o)} <span className="font-mono text-muted-foreground">{o.vehicle?.plate}</span></p>
              <p className="truncate text-xs text-muted-foreground"><Badge className="mr-1 bg-primary/10 text-primary">{o.tenant.name}</Badge>{dateTime(o.receivedAt)} · {o.client?.name ?? 'Sin cliente'} · {o.assignedTo?.fullName ?? 'Sin asignar'}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <span className="hidden text-sm sm:block">{money(o.total, o.tenant.currency)}</span>
              <StatusBadge status={o.status} />
            </div>
          </div>
        ))}
      </Card>
      {(q.data?.length ?? 0) > 0 && <p className="mt-2 text-right text-xs text-muted-foreground">Suma mostrada: {money(total)} (monedas mezcladas si las empresas usan distintas)</p>}
    </>
  );
}
