'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { money } from '@/lib/utils';
import { DownloadButton } from '@/components/download-button';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorText, Input, Label, PageHeader } from '@/components/ui';

const empty = { name: '', description: '', price: '' };

export default function ServicesPage() {
  const { user, can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['services'], queryFn: () => api<any[]>('/services') });
  const [f, setF] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const done = () => { setF(empty); setEditing(null); qc.invalidateQueries({ queryKey: ['services'] }); };

  const save = useMutation({
    mutationFn: () => {
      const body = { name: f.name, description: f.description || undefined, price: Number(f.price) };
      return editing ? api(`/services/${editing}`, { method: 'PATCH', body }) : api('/services', { body });
    },
    onSuccess: done,
  });
  const toggle = useMutation({ mutationFn: (s: any) => api(`/services/${s.id}`, { method: 'PATCH', body: { isActive: !s.isActive } }), onSuccess: done });
  const del = useMutation({ mutationFn: (id: string) => api(`/services/${id}`, { method: 'DELETE' }), onSuccess: done });

  return (
    <>
      <PageHeader title="Servicios y precios"><DownloadButton type="services" /></PageHeader>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2 divide-y">
          {q.data?.map((s) => (
            <div key={s.id} className="flex items-center justify-between gap-3 p-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">{s.name} {!s.isActive && <Badge className="bg-muted text-muted-foreground">Inactivo</Badge>}</p>
                <p className="truncate text-xs text-muted-foreground">{s.description}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-sm font-medium">{money(s.price, user?.tenant.currency)}</span>
                {can('services:edit') && <Button size="sm" variant="outline" onClick={() => { setEditing(s.id); setF({ name: s.name, description: s.description ?? '', price: String(Number(s.price)) }); }}>Editar</Button>}
                {can('services:edit') && <Button size="sm" variant="ghost" onClick={() => toggle.mutate(s)}>{s.isActive ? 'Desactivar' : 'Activar'}</Button>}
                {can('services:delete') && <Button size="sm" variant="ghost" onClick={() => confirm('¿Eliminar servicio?') && del.mutate(s.id)}>Eliminar</Button>}
              </div>
            </div>
          ))}
        </Card>
        <Card className={can('services:create') || editing ? 'h-fit' : 'hidden'}>
          <CardHeader><CardTitle>{editing ? 'Editar servicio' : 'Nuevo servicio'}</CardTitle></CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
              <div><Label>Nombre</Label><Input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
              <div><Label>Descripción</Label><Input value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} /></div>
              <div><Label>Precio</Label><Input required type="number" min="0" step="0.01" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} /></div>
              <ErrorText error={save.error ?? del.error} />
              <div className="flex gap-2"><Button disabled={save.isPending}>Guardar</Button>{editing && <Button type="button" variant="ghost" onClick={done}>Cancelar</Button>}</div>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
