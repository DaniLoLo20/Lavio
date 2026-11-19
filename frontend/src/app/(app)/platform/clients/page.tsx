'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Empty, ErrorText, Input, Label, PageHeader, Select } from '@/components/ui';
import { CompanySelect, useTenants } from '@/components/company-filter';

const empty = { tenantId: '', name: '', phone: '', email: '', contactPreference: 'NONE' };
const PREF: Record<string, string> = { NONE: 'Ninguno', WHATSAPP: 'WhatsApp', EMAIL: 'Correo' };

export default function PlatformClients() {
  const qc = useQueryClient();
  const tenants = useTenants();
  const [filter, setFilter] = useState('');
  const [search, setSearch] = useState('');
  const [f, setF] = useState(empty);
  const q = useQuery({
    queryKey: ['platform', 'clients', filter, search],
    queryFn: () => api<any[]>(`/platform/clients?${new URLSearchParams({ ...(filter && { tenantId: filter }), ...(search && { search }) })}`),
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ['platform'] });

  const create = useMutation({
    mutationFn: () => api('/platform/clients', { body: { tenantId: f.tenantId, name: f.name || undefined, phone: f.phone || undefined, email: f.email || undefined, contactPreference: f.contactPreference } }),
    onSuccess: () => { setF({ ...empty, tenantId: f.tenantId }); refresh(); },
  });
  const move = useMutation({ mutationFn: ({ id, tenantId }: { id: string; tenantId: string }) => api(`/platform/clients/${id}`, { method: 'PATCH', body: { tenantId } }), onSuccess: refresh });
  const del = useMutation({ mutationFn: (id: string) => api(`/platform/clients/${id}`, { method: 'DELETE' }), onSuccess: refresh });

  return (
    <>
      <PageHeader title="Clientes de todas las empresas">
        <CompanySelect value={filter} onChange={setFilter} allLabel="Todas las empresas" className="w-56" />
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <Input placeholder="Buscar nombre, teléfono o correo" value={search} onChange={(e) => setSearch(e.target.value)} />
          <ErrorText error={move.error ?? del.error} />
          <Card className="divide-y">
            {q.data?.length === 0 && <Empty text="Sin clientes" />}
            {q.data?.map((c) => {
              const locked = c._count.orders > 0 || c.vehicles.length > 0;
              return (
                <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0 text-sm">
                    <p className="font-medium">{c.name ?? 'Sin nombre'} <Badge className="bg-primary/10 text-primary">{c.tenant.name}</Badge></p>
                    <p className="truncate text-xs text-muted-foreground">{[c.phone, c.email, PREF[c.contactPreference]].filter(Boolean).join(' · ')} · {c._count.orders} visitas</p>
                    <p className="truncate text-xs text-muted-foreground">{c.vehicles.map((v: any) => `${v.brand} ${v.model} (${v.plate})`).join(', ')}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Select value={c.tenant.id} disabled={locked} title={locked ? 'Tiene órdenes o vehículos: no se puede mover' : 'Cambiar de empresa'}
                      onChange={(e) => e.target.value !== c.tenant.id && confirm('¿Mover cliente a otra empresa?') && move.mutate({ id: c.id, tenantId: e.target.value })} className="h-8 w-44 text-xs" aria-label="Empresa">
                      {tenants.data?.map((t) => <option key={t.id} value={t.id} disabled={!t.isActive}>{t.name}</option>)}
                    </Select>
                    <Button size="sm" variant="ghost" onClick={() => confirm('¿Eliminar cliente?') && del.mutate(c.id)}>Eliminar</Button>
                  </div>
                </div>
              );
            })}
          </Card>
        </div>
        <Card className="h-fit lg:sticky lg:top-6">
          <CardHeader><CardTitle>Nuevo cliente</CardTitle></CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
              <div><Label>Empresa *</Label><CompanySelect required onlyActive value={f.tenantId} onChange={(id) => setF({ ...f, tenantId: id })} /></div>
              <div><Label>Nombre</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
              <div><Label>Teléfono</Label><Input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
              <div><Label>Correo</Label><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
              <div><Label>Preferencia de contacto</Label>
                <Select value={f.contactPreference} onChange={(e) => setF({ ...f, contactPreference: e.target.value })}>
                  {Object.entries(PREF).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
              </div>
              <ErrorText error={create.error} />
              <Button disabled={create.isPending}>Crear cliente</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
