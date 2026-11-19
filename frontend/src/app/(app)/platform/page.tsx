'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Building, LogIn } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateTime, money } from '@/lib/utils';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Empty, ErrorText, Input, Label, PageHeader } from '@/components/ui';

const empty = { name: '', slug: '', adminName: '', adminEmail: '', adminPassword: '', taxRate: '16', plan: 'free', maxUsers: '10' };
const slugify = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);

export default function PlatformPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const { enterSupport } = useAuth();
  const q = useQuery({ queryKey: ['platform', 'tenants'], queryFn: () => api<any[]>('/platform/tenants') });
  const [f, setF] = useState(empty);
  const [slugTouched, setSlugTouched] = useState(false);
  const [search, setSearch] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['platform'] });

  const create = useMutation({
    mutationFn: () => api('/platform/tenants', { body: { ...f, taxRate: Number(f.taxRate), maxUsers: Number(f.maxUsers) } }),
    onSuccess: () => { setF(empty); setSlugTouched(false); refresh(); },
  });
  const patch = useMutation({ mutationFn: ({ id, body }: { id: string; body: object }) => api(`/platform/tenants/${id}`, { method: 'PATCH', body }), onSuccess: refresh });
  const del = useMutation({ mutationFn: (id: string) => api(`/platform/tenants/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const enter = useMutation({ mutationFn: (id: string) => enterSupport(id), onSuccess: () => router.replace('/dashboard') });

  const rows = (q.data ?? []).filter((t) => `${t.name} ${t.slug}`.toLowerCase().includes(search.toLowerCase()));
  const active = (q.data ?? []).filter((t) => t.isActive).length;

  return (
    <>
      <PageHeader title="Empresas">
        <Badge className="bg-muted text-muted-foreground">{active} activas de {q.data?.length ?? 0}</Badge>
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <Input placeholder="Buscar empresa" value={search} onChange={(e) => setSearch(e.target.value)} />
          <ErrorText error={patch.error ?? del.error ?? enter.error} />
          <Card className="divide-y">
            {rows.length === 0 && <Empty text="Sin empresas" />}
            {rows.map((t) => (
              <div key={t.id} className="space-y-3 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium">{t.logoUrl ? /* eslint-disable-next-line @next/next/no-img-element */ <img src={t.logoUrl} alt="" className="h-7 w-7 rounded bg-white object-contain ring-1 ring-black/10" /> : <Building className="h-4 w-4 text-muted-foreground" />}{t.name}
                      {!t.isActive && <Badge className="bg-destructive/15 text-destructive">Suspendida</Badge>}
                      <Badge className="bg-primary/10 text-primary">{t.plan}</Badge></p>
                    <p className="font-mono text-xs text-muted-foreground">{t.slug} · alta {dateTime(t.createdAt)}</p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    <Button size="sm" disabled={!t.isActive || enter.isPending} onClick={() => enter.mutate(t.id)}><LogIn className="h-4 w-4" />Entrar</Button>
                    <Button size="sm" variant="outline" onClick={() => patch.mutate({ id: t.id, body: { isActive: !t.isActive } })}>{t.isActive ? 'Suspender' : 'Reactivar'}</Button>
                    <Button size="sm" variant="ghost" onClick={() => confirm(`¿Eliminar ${t.name}? Se oculta y se suspende; los datos se conservan.`) && del.mutate(t.id)}>Eliminar</Button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  <div><p className="text-xs text-muted-foreground">Usuarios</p><p>{t.users} / {t.maxUsers}</p></div>
                  <div><p className="text-xs text-muted-foreground">Órdenes (30 d)</p><p>{t.orders30d} <span className="text-xs text-muted-foreground">de {t.orders}</span></p></div>
                  <div><p className="text-xs text-muted-foreground">Ventas (30 d)</p><p>{money(t.sales30d, t.currency)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Última orden</p><p>{t.lastOrderAt ? dateTime(t.lastOrderAt) : '—'}</p></div>
                </div>
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <span className="text-muted-foreground">Plan</span>
                  {['free', 'pro', 'business'].map((p) => (
                    <button key={p} onClick={() => patch.mutate({ id: t.id, body: { plan: p, ...(p === 'free' ? { maxUsers: Math.max(t.users, 3) } : p === 'pro' ? { maxUsers: Math.max(t.users, 10) } : { maxUsers: Math.max(t.users, 50) }) } })}
                      className={`rounded border px-2 py-1 ${t.plan === p ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted'}`}>{p}</button>
                  ))}
                  <span className="ml-2 text-muted-foreground">Máx. usuarios</span>
                  <Input type="number" min={t.users || 1} defaultValue={t.maxUsers} className="h-7 w-20 text-xs"
                    onBlur={(e) => Number(e.target.value) !== t.maxUsers && patch.mutate({ id: t.id, body: { maxUsers: Number(e.target.value) } })} />
                </div>
              </div>
            ))}
          </Card>
        </div>

        <Card className="h-fit lg:sticky lg:top-6">
          <CardHeader><CardTitle>Nueva empresa</CardTitle></CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
              <div><Label>Nombre *</Label><Input required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, slug: slugTouched ? f.slug : slugify(e.target.value) })} /></div>
              <div><Label>Identificador (slug) *</Label><Input required pattern="[a-z0-9\-]{3,40}" value={f.slug} onChange={(e) => { setSlugTouched(true); setF({ ...f, slug: e.target.value.toLowerCase() }); }} /></div>
              <p className="pt-1 text-xs font-semibold">Administrador inicial</p>
              <div><Label>Nombre *</Label><Input required value={f.adminName} onChange={(e) => setF({ ...f, adminName: e.target.value })} /></div>
              <div><Label>Correo *</Label><Input required type="email" value={f.adminEmail} onChange={(e) => setF({ ...f, adminEmail: e.target.value })} /></div>
              <div><Label>Contraseña temporal (mín. 8) *</Label><Input required minLength={8} type="password" autoComplete="new-password" value={f.adminPassword} onChange={(e) => setF({ ...f, adminPassword: e.target.value })} /></div>
              <div className="grid grid-cols-3 gap-2">
                <div><Label>IVA %</Label><Input type="number" min="0" max="100" step="0.01" value={f.taxRate} onChange={(e) => setF({ ...f, taxRate: e.target.value })} /></div>
                <div><Label>Plan</Label><Input value={f.plan} onChange={(e) => setF({ ...f, plan: e.target.value })} /></div>
                <div><Label>Máx. usuarios</Label><Input type="number" min="1" value={f.maxUsers} onChange={(e) => setF({ ...f, maxUsers: e.target.value })} /></div>
              </div>
              <p className="text-xs text-muted-foreground">Se crean 3 servicios básicos de ejemplo.</p>
              <ErrorText error={create.error} />
              <Button disabled={create.isPending}>Crear empresa</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
