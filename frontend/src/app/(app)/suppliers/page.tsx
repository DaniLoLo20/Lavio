'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Mail, Phone } from 'lucide-react';
import { api } from '@/lib/api';
import { Button, Card, CardContent, CardHeader, CardTitle, Empty, ErrorText, Input, Label, PageHeader, Textarea } from '@/components/ui';
import { useAuth } from '@/lib/auth';
import { DownloadButton } from '@/components/download-button';

const empty = { name: '', contactName: '', phone: '', email: '', taxId: '', notes: '' };

export default function SuppliersPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['suppliers'], queryFn: () => api<any[]>('/suppliers') });
  const [f, setF] = useState(empty);
  const [editing, setEditing] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const done = () => { setF(empty); setEditing(null); qc.invalidateQueries({ queryKey: ['suppliers'] }); };

  const save = useMutation({
    mutationFn: () => {
      // Al editar se envía '' para poder limpiar un campo; al crear se omiten los vacíos
      const body: Record<string, string | undefined> = editing ? { ...f } : Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v || undefined]));
      return editing ? api(`/suppliers/${editing}`, { method: 'PATCH', body }) : api('/suppliers', { body });
    },
    onSuccess: done,
  });
  const del = useMutation({ mutationFn: (id: string) => api(`/suppliers/${id}`, { method: 'DELETE' }), onSuccess: done });

  const rows = (q.data ?? []).filter((s) => `${s.name} ${s.contactName ?? ''} ${s.taxId ?? ''}`.toLowerCase().includes(search.toLowerCase()));

  return (
    <>
      <PageHeader title="Proveedores"><DownloadButton type="suppliers" /></PageHeader>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <Input placeholder="Buscar proveedor, contacto o RFC" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Card className="divide-y">
            {rows.length === 0 && <Empty text="Sin proveedores" />}
            {rows.map((s) => (
              <div key={s.id} className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0 space-y-0.5 text-sm">
                  <p className="font-medium">{s.name} {s.taxId && <span className="font-mono text-xs text-muted-foreground">{s.taxId}</span>}</p>
                  {s.contactName && <p className="text-xs text-muted-foreground">Contacto: {s.contactName}</p>}
                  <p className="flex flex-wrap gap-x-3 text-xs text-muted-foreground">
                    {s.phone && <a href={`tel:${s.phone}`} className="inline-flex items-center gap-1 hover:text-foreground"><Phone className="h-3 w-3" />{s.phone}</a>}
                    {s.email && <a href={`mailto:${s.email}`} className="inline-flex items-center gap-1 hover:text-foreground"><Mail className="h-3 w-3" />{s.email}</a>}
                  </p>
                  <p className="text-xs text-muted-foreground">{s._count.products} productos · {s._count.purchases} compras</p>
                  {s.notes && <p className="text-xs">{s.notes}</p>}
                </div>
                <div className="flex shrink-0 gap-1">
                  {can('suppliers:edit') && <Button size="sm" variant="outline" onClick={() => { setEditing(s.id); setF({ name: s.name, contactName: s.contactName ?? '', phone: s.phone ?? '', email: s.email ?? '', taxId: s.taxId ?? '', notes: s.notes ?? '' }); }}>Editar</Button>}
                  {can('suppliers:delete') && <Button size="sm" variant="ghost" onClick={() => confirm(`¿Eliminar a ${s.name}? Sus compras anteriores se conservan.`) && del.mutate(s.id)}>Eliminar</Button>}
                </div>
              </div>
            ))}
          </Card>
        </div>
        <Card className={can('suppliers:create') || editing ? 'h-fit lg:sticky lg:top-6' : 'hidden'}>
          <CardHeader><CardTitle>{editing ? 'Editar proveedor' : 'Nuevo proveedor'}</CardTitle></CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
              <div><Label>Nombre / razón social *</Label><Input required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
              <div><Label>Contacto</Label><Input value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Teléfono</Label><Input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
                <div><Label>RFC</Label><Input value={f.taxId} onChange={(e) => setF({ ...f, taxId: e.target.value.toUpperCase() })} /></div>
              </div>
              <div><Label>Correo</Label><Input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
              <div><Label>Notas</Label><Textarea value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></div>
              <ErrorText error={save.error ?? del.error} />
              <div className="flex gap-2"><Button disabled={save.isPending}>Guardar</Button>{editing && <Button type="button" variant="ghost" onClick={done}>Cancelar</Button>}</div>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
