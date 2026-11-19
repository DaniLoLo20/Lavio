'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { DownloadButton } from '@/components/download-button';
import { Button, Card, CardContent, CardHeader, CardTitle, Empty, ErrorText, Input, Label, PageHeader, Select } from '@/components/ui';

const empty = { name: '', phone: '', email: '', contactPreference: 'NONE' };
const PREF: Record<string, string> = { NONE: 'Ninguno', WHATSAPP: 'WhatsApp', EMAIL: 'Correo' };

export default function ClientsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [f, setF] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const q = useQuery({ queryKey: ['clients', search], queryFn: () => api<any[]>(`/clients?search=${encodeURIComponent(search)}`) });
  const done = () => { setF(empty); setEditing(null); qc.invalidateQueries({ queryKey: ['clients'] }); };

  const save = useMutation({
    mutationFn: () => {
      const body = { name: f.name || undefined, phone: f.phone || undefined, email: f.email || undefined, contactPreference: f.contactPreference };
      return editing ? api(`/clients/${editing}`, { method: 'PATCH', body }) : api('/clients', { body });
    },
    onSuccess: done,
  });
  const del = useMutation({ mutationFn: (id: string) => api(`/clients/${id}`, { method: 'DELETE' }), onSuccess: done });

  return (
    <>
      <PageHeader title="Clientes"><DownloadButton type="clients" /></PageHeader>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <Input placeholder="Buscar nombre, teléfono, correo o placa" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Card className="divide-y">
            {q.data?.length === 0 && <Empty text="Sin clientes" />}
            {q.data?.map((c) => (
              <div key={c.id} className="flex items-center justify-between gap-3 p-4">
                <div className="min-w-0 text-sm">
                  <p className="font-medium">{c.name ?? 'Sin nombre'} <span className="text-xs text-muted-foreground">· {c._count.orders} visitas</span></p>
                  <p className="truncate text-xs text-muted-foreground">{[c.phone, c.email, PREF[c.contactPreference]].filter(Boolean).join(' · ')}</p>
                  <p className="truncate text-xs text-muted-foreground">{c.vehicles.map((v: any) => `${v.brand} ${v.model} (${v.plate})`).join(', ')}</p>
                </div>
                <div className="flex shrink-0 gap-1">
                  {can('clients:edit') && <Button size="sm" variant="outline" onClick={() => { setEditing(c.id); setF({ name: c.name ?? '', phone: c.phone ?? '', email: c.email ?? '', contactPreference: c.contactPreference }); }}>Editar</Button>}
                  {can('clients:delete') && <Button size="sm" variant="ghost" onClick={() => confirm('¿Eliminar cliente?') && del.mutate(c.id)}>Eliminar</Button>}
                </div>
              </div>
            ))}
          </Card>
        </div>
        <Card className={can('clients:create') || editing ? 'h-fit' : 'hidden'}>
          <CardHeader><CardTitle>{editing ? 'Editar cliente' : 'Nuevo cliente'}</CardTitle></CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
              <div><Label>Nombre</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
              <div><Label>Teléfono</Label><Input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
              <div><Label>Correo</Label><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
              <div><Label>Preferencia de contacto</Label>
                <Select value={f.contactPreference} onChange={(e) => setF({ ...f, contactPreference: e.target.value })}>
                  {Object.entries(PREF).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                </Select>
              </div>
              <ErrorText error={save.error ?? del.error} />
              <div className="flex gap-2"><Button disabled={save.isPending}>Guardar</Button>{editing && <Button type="button" variant="ghost" onClick={done}>Cancelar</Button>}</div>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
