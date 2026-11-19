'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Empty, ErrorText, Input, Label, PageHeader, Select } from '@/components/ui';
import { CompanySelect, useTenants } from '@/components/company-filter';

const empty = { tenantId: '', fullName: '', email: '', password: '', role: 'WASHER' };

export default function PlatformUsers() {
  const qc = useQueryClient();
  const tenants = useTenants();
  const [filter, setFilter] = useState('');
  const [f, setF] = useState(empty);
  const roles = useQuery({ queryKey: ['platform', 'roles'], queryFn: () => api<any[]>('/platform/roles') });
  const roleList = (roles.data ?? []).filter((r) => r.name !== 'SUPERADMIN');
  const q = useQuery({ queryKey: ['platform', 'users', filter], queryFn: () => api<any[]>(`/platform/users${filter ? `?tenantId=${filter}` : ''}`) });
  const refresh = () => { qc.invalidateQueries({ queryKey: ['platform'] }); };

  const create = useMutation({ mutationFn: () => api('/platform/users', { body: f }), onSuccess: () => { setF({ ...empty, tenantId: f.tenantId }); refresh(); } });
  const patch = useMutation({ mutationFn: ({ id, body }: { id: string; body: object }) => api(`/platform/users/${id}`, { method: 'PATCH', body }), onSuccess: refresh });
  const del = useMutation({ mutationFn: (id: string) => api(`/platform/users/${id}`, { method: 'DELETE' }), onSuccess: refresh });

  const rows = q.data ?? [];
  const sel = tenants.data?.find((t) => t.id === f.tenantId);

  return (
    <>
      <PageHeader title="Usuarios de todas las empresas">
        <CompanySelect value={filter} onChange={setFilter} allLabel="Todas las empresas" className="w-56" />
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <ErrorText error={patch.error ?? del.error} />
          <Card className="divide-y">
            {rows.length === 0 && <Empty text="Sin usuarios" />}
            {rows.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0 text-sm">
                  <p className="font-medium">{u.fullName} <Badge className="bg-muted text-muted-foreground">{u.role.label ?? u.role.name}</Badge> {!u.isActive && <Badge className="bg-destructive/15 text-destructive">Inactivo</Badge>}</p>
                  <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Select value={u.tenant.id} onChange={(e) => e.target.value !== u.tenant.id && confirm(`¿Mover a ${u.fullName} a otra empresa?`) && patch.mutate({ id: u.id, body: { tenantId: e.target.value } })} className="h-8 w-44 text-xs" aria-label="Empresa">
                    {tenants.data?.map((t) => <option key={t.id} value={t.id} disabled={!t.isActive}>{t.name}</option>)}
                  </Select>
                  <Button size="sm" variant="outline" onClick={() => patch.mutate({ id: u.id, body: { isActive: !u.isActive } })}>{u.isActive ? 'Desactivar' : 'Activar'}</Button>
                  <Button size="sm" variant="ghost" onClick={() => confirm(`¿Eliminar a ${u.fullName}?`) && del.mutate(u.id)}>Eliminar</Button>
                </div>
              </div>
            ))}
          </Card>
        </div>
        <Card className="h-fit lg:sticky lg:top-6">
          <CardHeader><CardTitle>Nuevo usuario</CardTitle></CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
              <div><Label>Empresa *</Label><CompanySelect required onlyActive value={f.tenantId} onChange={(id) => setF({ ...f, tenantId: id })} /></div>
              {sel && <p className="text-xs text-muted-foreground">{sel.users} de {sel.maxUsers} usuarios</p>}
              <div><Label>Nombre completo *</Label><Input required value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></div>
              <div><Label>Correo *</Label><Input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
              <div><Label>Contraseña (mín. 8) *</Label><Input required minLength={8} type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
              <div><Label>Rol</Label><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{roleList.map((r) => <option key={r.name} value={r.name}>{r.label ?? r.name}</option>)}</Select></div>
              <ErrorText error={create.error} />
              <Button disabled={create.isPending}>Crear usuario</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
