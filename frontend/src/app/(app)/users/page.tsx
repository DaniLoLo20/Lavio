'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { DownloadButton } from '@/components/download-button';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Empty, ErrorText, Input, Label, PageHeader, Select } from '@/components/ui';

const empty = { fullName: '', email: '', password: '', role: 'WASHER' };

export default function UsersPage() {
  const { user, can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['users'], queryFn: () => api<any[]>('/users') });
  const canCreate = can('users:create');
  const canEdit = can('users:edit');
  const canDelete = can('users:delete');
  const roles = useQuery({ queryKey: ['users', 'roles'], queryFn: () => api<any[]>('/users/roles'), enabled: canCreate || canEdit });
  const [f, setF] = useState(empty);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [status, setStatus] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['users'] });

  const create = useMutation({ mutationFn: () => api('/users', { body: f }), onSuccess: () => { setF(empty); refresh(); } });
  const patch = useMutation({ mutationFn: ({ id, body }: { id: string; body: object }) => api(`/users/${id}`, { method: 'PATCH', body }), onSuccess: refresh });
  const del = useMutation({ mutationFn: (id: string) => api(`/users/${id}`, { method: 'DELETE' }), onSuccess: refresh });

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((u) =>
      (!s || u.fullName.toLowerCase().includes(s) || u.email.toLowerCase().includes(s)) &&
      (!roleFilter || u.role.name === roleFilter) &&
      (!status || (status === 'active' ? u.isActive : !u.isActive)));
  }, [q.data, search, roleFilter, status]);
  const roleOptions = useMemo(() => {
    const m = new Map<string, string>();
    (q.data ?? []).forEach((u) => m.set(u.role.name, u.role.label ?? u.role.name));
    return [...m.entries()];
  }, [q.data]);

  return (
    <>
      <PageHeader title="Usuarios"><DownloadButton type="users" /></PageHeader>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <div className="flex flex-wrap gap-2">
            <Input className="min-w-[10rem] flex-1" placeholder="Buscar por nombre o correo…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Select className="w-44" value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)} aria-label="Filtrar por rol"><option value="">Todos los roles</option>{roleOptions.map(([n, l]) => <option key={n} value={n}>{l}</option>)}</Select>
            <Select className="w-36" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filtrar por estado"><option value="">Todos</option><option value="active">Activos</option><option value="inactive">Inactivos</option></Select>
          </div>
          <ErrorText error={patch.error ?? del.error} />
          <Card className="divide-y">
            {rows.length === 0 && <Empty text="Sin usuarios" />}
            {rows.map((u) => {
              const mine = u.id === user?.id;
              const assignable = roles.data?.some((r) => r.name === u.role.name);
              return (
                <div key={u.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div className="min-w-0 text-sm">
                    <p className="font-medium">{u.fullName} <Badge className="bg-muted text-muted-foreground">{u.role.label ?? u.role.name}</Badge> {!u.isActive && <Badge className="bg-destructive/15 text-destructive">Inactivo</Badge>}</p>
                    <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                  </div>
                  {!mine && (
                    <div className="flex shrink-0 flex-wrap items-center gap-1">
                      {canEdit && assignable && (
                        <Select className="h-8 w-40 text-xs" aria-label="Cambiar rol" value={u.role.name} onChange={(e) => patch.mutate({ id: u.id, body: { role: e.target.value } })}>
                          {roles.data?.map((r) => <option key={r.name} value={r.name}>{r.label}</option>)}
                        </Select>
                      )}
                      {canEdit && <Button size="sm" variant="outline" onClick={() => patch.mutate({ id: u.id, body: { isActive: !u.isActive } })}>{u.isActive ? 'Desactivar' : 'Activar'}</Button>}
                      {canDelete && <Button size="sm" variant="ghost" onClick={() => confirm('¿Eliminar usuario?') && del.mutate(u.id)}>Eliminar</Button>}
                    </div>
                  )}
                </div>
              );
            })}
          </Card>
        </div>
        {canCreate && (
          <Card className="h-fit">
            <CardHeader><CardTitle>Nuevo usuario</CardTitle></CardHeader>
            <CardContent>
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
                <div><Label>Nombre completo</Label><Input required value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></div>
                <div><Label>Correo</Label><Input required type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
                <div><Label>Contraseña (mín. 8)</Label><Input required minLength={8} type="password" autoComplete="new-password" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
                <div><Label>Rol</Label><Select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })}>{roles.data?.map((r) => <option key={r.name} value={r.name}>{r.label}</option>)}</Select></div>
                <ErrorText error={create.error} />
                <Button disabled={create.isPending}>Crear usuario</Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
