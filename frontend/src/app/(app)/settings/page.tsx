'use client';
import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { LogoUploader } from '@/components/logo-uploader';
import { VoiceSettingsForm } from '@/components/voice-settings';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, ErrorText, Input, Label, PageHeader } from '@/components/ui';

export default function SettingsPage() {
  const { refresh, can } = useAuth();
  const q = useQuery({ queryKey: ['tenant', 'settings'], queryFn: () => api<any>('/tenant/settings') });
  const [f, setF] = useState({ name: '', taxId: '', phone: '', address: '', taxRate: '16', currency: 'MXN', countryCode: '52' });
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (q.data) setF({ name: q.data.name, taxId: q.data.taxId ?? '', phone: q.data.phone ?? '', address: q.data.address ?? '', taxRate: String(q.data.taxRate), currency: q.data.currency, countryCode: q.data.countryCode });
  }, [q.data]);

  const save = useMutation({
    mutationFn: () => api('/tenant/settings', { method: 'PATCH', body: { ...f, taxRate: Number(f.taxRate) } }),
    onSuccess: async () => { await refresh(); setSaved(true); setTimeout(() => setSaved(false), 2500); },
  });

  return (
    <>
      <PageHeader title="Configuración de la empresa">
        {q.data && <Badge className="bg-primary/10 text-primary">Plan {q.data.plan} · {q.data.users}/{q.data.maxUsers} usuarios</Badge>}
      </PageHeader>
      <Card className="max-w-2xl">
        <CardHeader><CardTitle>{q.data?.slug ? `Datos de ${q.data.slug}` : 'Datos'}</CardTitle></CardHeader>
        <CardContent>
          <form className="grid gap-3 sm:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <div className="sm:col-span-2"><Label>Nombre comercial</Label><Input required minLength={2} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>
            <div><Label>RFC</Label><Input value={f.taxId} onChange={(e) => setF({ ...f, taxId: e.target.value.toUpperCase() })} /></div>
            <div><Label>Teléfono</Label><Input type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></div>
            <div className="sm:col-span-2"><Label>Dirección</Label><Input value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></div>
            <div><Label>IVA (%)</Label><Input type="number" min="0" max="100" step="0.01" value={f.taxRate} onChange={(e) => setF({ ...f, taxRate: e.target.value })} /></div>
            <div><Label>Moneda (ISO)</Label><Input maxLength={3} value={f.currency} onChange={(e) => setF({ ...f, currency: e.target.value.toUpperCase() })} /></div>
            <div><Label>Lada del país (WhatsApp)</Label><Input inputMode="numeric" value={f.countryCode} onChange={(e) => setF({ ...f, countryCode: e.target.value.replace(/\D/g, '') })} /></div>
            <div className="flex items-end sm:col-span-2">
              <div className="space-y-2">
                <ErrorText error={save.error} />
                <div className="flex items-center gap-3">{can('settings:edit') && <Button disabled={save.isPending}>Guardar cambios</Button>}{saved && <span className="text-sm text-emerald-600">Guardado</span>}</div>
              </div>
            </div>
          </form>
          <p className="mt-4 text-xs text-muted-foreground">El IVA nuevo aplica a las órdenes que se creen a partir de ahora; las anteriores conservan el suyo.</p>
        </CardContent>
      </Card>
      {can('settings:edit') && <div className="mt-4"><LogoUploader /></div>}
      <Card className="mt-4 max-w-2xl">
        <CardHeader><CardTitle>Modo Voz (este dispositivo)</CardTitle></CardHeader>
        <CardContent><VoiceSettingsForm /></CardContent>
      </Card>
    </>
  );
}
