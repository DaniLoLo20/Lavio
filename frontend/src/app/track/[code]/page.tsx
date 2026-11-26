'use client';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { api } from '@/lib/api';
import { STATUS, cn, dateTime, duration, type Status } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, StatusBadge } from '@/components/ui';
import { BRAND, Splash, TenantMark } from '@/components/brand';

export default function TrackPage() {
  const { code } = useParams<{ code: string }>();
  const q = useQuery({
    queryKey: ['track', code],
    queryFn: () => api<any>(`/public/track/${code}`, { auth: false }),
    refetchInterval: 15_000,
    retry: false,
  });

  if (q.isLoading) return <Splash text="Consultando tu vehículo…" />;
  if (q.error || !q.data)
    return (
      <main className="grid min-h-screen place-items-center p-4 text-center">
        <div>
          <p className="font-medium">Código no encontrado</p>
          <Link href="/track" className="text-sm text-primary underline">Intentar de nuevo</Link>
        </div>
      </main>
    );

  const o = q.data;
  const current = o.steps.indexOf(o.status);

  return (
    <main className="mx-auto max-w-lg space-y-4 p-4">
      <div className="flex items-center justify-center gap-2 pt-1"><TenantMark url={o.logoUrl} size={o.logoUrl ? 48 : 32} />{o.logoUrl ? <span className="text-lg font-bold">{o.business}</span> : <span className="brand-text text-lg font-bold">{BRAND.name}</span>}</div>
      <div className="pt-2 text-center">
        <p className="text-sm text-muted-foreground">{o.logoUrl ? o.business : ""}</p>
        <h1 className="text-2xl font-semibold">{[o.vehicle.brand, o.vehicle.model].filter(Boolean).join(' ') || (o.vehicle.plate ? 'Tu vehículo' : 'Tu pedido')}</h1>
        <p className="text-sm text-muted-foreground">{o.vehicle.plate ? `${[o.vehicle.color, o.vehicle.plate].filter(Boolean).join(' · ')} · ` : ''}Folio {o.folio}</p>
        <div className="mt-3"><StatusBadge status={o.status as Status} /></div>
      </div>

      <Card>
        <CardContent className="space-y-4">
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-all" style={{ width: `${o.progress}%` }} />
          </div>
          <ol className="space-y-2">
            {o.steps.map((s: Status, i: number) => (
              <li key={s} className={cn('flex items-center gap-3 text-sm', i > current && 'text-muted-foreground')}>
                <span className={cn('grid h-5 w-5 place-items-center rounded-full border text-[10px]', i <= current && 'border-primary bg-primary text-primary-foreground')}>
                  {i <= current ? <Check className="h-3 w-3" /> : i + 1}
                </span>
                <span className={cn(i === current && 'font-semibold')}>{STATUS[s].label}</span>
                <span className="ml-auto text-xs text-muted-foreground">{dateTime(o.history.find((h: any) => h.status === s)?.at) === '—' ? '' : dateTime(o.history.find((h: any) => h.status === s)?.at)}</span>
              </li>
            ))}
          </ol>
          {o.totalSeconds != null && <p className="text-sm text-muted-foreground">Tiempo total de servicio: {duration(o.totalSeconds)}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Servicios</CardTitle></CardHeader>
        <CardContent className="text-sm">
          {o.services.map((s: any, i: number) => <p key={i}>{s.quantity} × {s.name}</p>)}
        </CardContent>
      </Card>

      {o.photos.length > 0 && (
        <Card>
          <CardHeader><CardTitle>Fotografías</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-2">
            {o.photos.map((p: any, i: number) => (
              <a key={i} href={p.url} target="_blank" rel="noreferrer">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.url} alt={p.type} className="aspect-video w-full rounded-md object-cover" loading="lazy" />
              </a>
            ))}
          </CardContent>
        </Card>
      )}
      <p className="pb-6 text-center text-xs text-muted-foreground">Se actualiza automáticamente · Código {o.code}<br />Seguimiento con {BRAND.name} · {BRAND.tagline}</p>
    </main>
  );
}
