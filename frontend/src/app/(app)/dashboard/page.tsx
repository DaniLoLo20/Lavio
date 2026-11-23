'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, TrendingDown, TrendingUp } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { METHODS, STATUS, cn, money, type Status } from '@/lib/utils';
import { Badge, CardContent, CardHeader, CardTitle, Empty } from '@/components/ui';
import { Glass, GlassPage, Segmented } from '@/components/glass';
import { AreaChart, BarChart, Donut, HBar } from '@/components/charts';
import { DownloadButton } from '@/components/download-button';

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: React.ReactNode }) {
  return (
    <Glass><CardContent>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </CardContent></Glass>
  );
}

const MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

export default function Dashboard() {
  const { user } = useAuth();
  const cur = user?.tenant.currency;
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ['dashboard', days], queryFn: () => api<any>(`/dashboard/summary?days=${days}`), refetchInterval: 30_000, placeholderData: (p) => p });
  if (!q.data) return <p className="text-sm text-muted-foreground">Cargando…</p>;
  const d = q.data;
  const g = d.week.growthPct;
  const fmt = (n: number) => money(n, cur);
  const range = { from: d.range.from, to: d.range.to };
  const hasSales = d.series.some((s: any) => s.sales > 0);

  return (
    <GlassPage>
      <div className="mx-auto max-w-6xl space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-3 px-1">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-sm text-muted-foreground">Resumen de tu autolavado</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Periodo" value={String(days)} onChange={(v) => setDays(Number(v))} items={[7, 30, 90].map((n) => ({ k: String(n), label: `${n} días` }))} />
          <DownloadButton type="orders" params={range} label="Órdenes" />
          <DownloadButton type="payments" params={range} label="Pagos" />
        </div>
      </header>
      <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Hoy</h2>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Vehículos atendidos" value={d.today.vehicles} />
        <Stat label="Ventas" value={fmt(d.today.sales)} />
        <Stat label="Ticket promedio" value={fmt(d.today.avgTicket)} />
        <Stat label="Servicios realizados" value={d.today.services} />
      </div>

      <div className="mt-6 grid gap-3 lg:grid-cols-3">
        <div className="space-y-3">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Semana</h2>
          <Stat label="Ventas de la semana" value={fmt(d.week.sales)} hint={`Semana anterior: ${fmt(d.week.previousSales)}`} />
          <Stat
            label="Crecimiento"
            value={g == null ? '—' : <span className={g >= 0 ? 'text-emerald-600' : 'text-destructive'}>{g >= 0 ? '+' : ''}{g.toFixed(1)}%</span>}
            hint={g == null ? 'Sin datos de la semana anterior' : g >= 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
          />
        </div>
        <div className="space-y-3">
          <h2 className="px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Mes</h2>
          <Stat label="Ingresos" value={fmt(d.month.income)} />
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Vehículos lavados" value={d.month.vehicles} />
            <Stat label="Clientes recurrentes" value={d.month.recurringClients} />
          </div>
        </div>
        <Glass className="self-start">
          <CardHeader><CardTitle>Últimos {d.days} días</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Ventas</span><span className="font-medium">{fmt(d.series.reduce((s: number, x: any) => s + x.sales, 0))}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Vehículos</span><span className="font-medium">{d.series.reduce((s: number, x: any) => s + x.vehicles, 0)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Tiempo promedio de servicio</span><span className="font-medium">{d.range.avgMinutes != null ? `${d.range.avgMinutes} min` : '—'}</span></div>
          </CardContent>
        </Glass>
      </div>

      <div className="mt-6 grid gap-3 lg:grid-cols-3">
        <Glass className="lg:col-span-2">
          <CardHeader><CardTitle>Ventas por día</CardTitle></CardHeader>
          <CardContent>
            {hasSales
              ? <AreaChart data={d.series.map((s: any) => ({ label: s.date.slice(8) + '/' + s.date.slice(5, 7), value: s.sales }))} format={(n) => (n >= 1000 ? new Intl.NumberFormat('es-MX', { notation: 'compact' }).format(n) : String(Math.round(n)))} />
              : <Empty text="Sin ventas en el periodo" />}
          </CardContent>
        </Glass>
        <Glass>
          <CardHeader><CardTitle>Métodos de pago</CardTitle></CardHeader>
          <CardContent>
            {d.paymentMethods.length ? <Donut data={d.paymentMethods.map((p: any) => ({ label: METHODS[p.method], value: p.total }))} format={fmt} /> : <Empty text="Sin pagos" />}
          </CardContent>
        </Glass>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Glass>
          <CardHeader><CardTitle>Ventas por mes</CardTitle></CardHeader>
          <CardContent><BarChart data={d.monthly.map((m: any) => ({ label: MONTHS[Number(m.month.slice(5)) - 1], value: m.sales }))} /></CardContent>
        </Glass>
        <Glass>
          <CardHeader><CardTitle>Servicios más vendidos</CardTitle></CardHeader>
          <CardContent>
            {d.topServices.length ? <HBar data={d.topServices.map((s: any) => ({ label: s.name, value: s.total, sub: `${s.quantity} uds` }))} format={fmt} /> : <Empty text="Sin datos" />}
          </CardContent>
        </Glass>
        <Glass>
          <CardHeader><CardTitle>Horas con más vehículos</CardTitle></CardHeader>
          <CardContent>
            <BarChart height={150} data={d.byHour.map((n: number, h: number) => ({ label: h % 3 === 0 ? String(h) : '', value: n })).slice(6, 22)} format={(n) => String(n)} />
            <p className="mt-1 text-center text-[11px] text-muted-foreground">Hora del día (6 a 21 h)</p>
          </CardContent>
        </Glass>
      </div>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        <Glass>
          <CardHeader><CardTitle>Órdenes activas</CardTitle></CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {d.activeByStatus.length === 0 && <span className="text-sm text-muted-foreground">Sin órdenes activas</span>}
            {d.activeByStatus.map((a: any) => <Badge key={a.status} className={STATUS[a.status as Status].cls}>{STATUS[a.status as Status].label}: {a.count}</Badge>)}
          </CardContent>
        </Glass>
        <Glass>
          <CardHeader><CardTitle>Stock bajo</CardTitle><DownloadButton type="inventory" label="Inventario" /></CardHeader>
          <CardContent className="space-y-1 text-sm">
            {d.lowStock.length === 0 && <span className="text-muted-foreground">Todo en orden</span>}
            {d.lowStock.map((p: any) => (
              <p key={p.id} className="flex items-center gap-2"><AlertTriangle className="h-4 w-4 text-amber-500" />{p.name}: {p.stock} (mín. {p.minStock})</p>
            ))}
          </CardContent>
        </Glass>
      </div>
      </div>
    </GlassPage>
  );
}
