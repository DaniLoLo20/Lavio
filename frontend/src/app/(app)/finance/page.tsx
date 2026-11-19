'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Lock, TrendingDown, TrendingUp, Unlock } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CAT_LABEL, SOURCE_LABEL } from '@/lib/cash';
import { METHODS, cn, dateTime, money } from '@/lib/utils';
import { Card, CardContent, CardHeader, CardTitle, Empty, PageHeader } from '@/components/ui';
import { Donut, GroupedBars, HBar, SignedAreaChart } from '@/components/charts';
import { DownloadButton } from '@/components/download-button';

function Utility({ title, d }: { title: string; d: { income: number; expense: number; utility: number } }) {
  const { user } = useAuth();
  const cur = user?.tenant.currency;
  return (
    <Card>
      <CardContent>
        <p className="text-xs text-muted-foreground">{title}</p>
        <p className={cn('mt-1 text-2xl font-semibold tracking-tight', d.utility < 0 ? 'text-red-600' : 'text-emerald-600')}>{money(d.utility, cur)}</p>
        <p className="mt-1 text-xs text-muted-foreground">Ingresos {money(d.income, cur)} · Egresos {money(d.expense, cur)}</p>
      </CardContent>
    </Card>
  );
}

export default function FinancePage() {
  const { user } = useAuth();
  const cur = user?.tenant.currency;
  const [days, setDays] = useState(30);
  const q = useQuery({ queryKey: ['finance', days], queryFn: () => api<any>(`/finance/summary?days=${days}`), refetchInterval: 30_000, placeholderData: (p) => p });
  if (!q.data) return <p className="text-sm text-muted-foreground">Cargando…</p>;
  const d = q.data;
  const fmt = (n: number) => money(n, cur);
  const label = (date: string) => `${date.slice(8)}/${date.slice(5, 7)}`;
  const hasFlow = d.cashflow.some((x: any) => x.income > 0 || x.expense > 0);
  const g = d.weekGrowthPct;

  return (
    <>
      <PageHeader title="Finanzas">
        <div className="flex rounded-md border bg-card p-0.5 text-xs">
          {[7, 30, 90].map((n) => (
            <button key={n} onClick={() => setDays(n)} className={cn('rounded px-3 py-1.5', days === n ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>{n} días</button>
          ))}
        </div>
        <DownloadButton type="cash-movements" params={{ from: d.range.from, to: d.range.to }} label="Movimientos" />
        <DownloadButton type="cash-sessions" params={{ from: d.range.from, to: d.range.to }} label="Cortes" />
      </PageHeader>

      <h2 className="mb-2 text-sm font-medium text-muted-foreground">Utilidad</h2>
      <div className="grid gap-3 md:grid-cols-3">
        <Utility title="Utilidad del día" d={d.today} />
        <Utility title="Utilidad semanal" d={d.week} />
        <Utility title="Utilidad mensual" d={d.month} />
      </div>
      <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
        {g == null ? 'Sin utilidad de la semana anterior para comparar.' : <>{g >= 0 ? <TrendingUp className="h-4 w-4 text-emerald-600" /> : <TrendingDown className="h-4 w-4 text-red-600" />} Semana vs. anterior: <b className={g >= 0 ? 'text-emerald-600' : 'text-red-600'}>{g >= 0 ? '+' : ''}{g}%</b></>}
        <span className="ml-2">Ingresos = cobros de órdenes + ingresos de caja. Egresos = egresos de caja.</span>
      </p>

      <div className="mt-6 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Flujo de efectivo · últimos {d.days} días</CardTitle></CardHeader>
          <CardContent>
            {hasFlow ? <GroupedBars aLabel="Ingresos" bLabel="Egresos" data={d.cashflow.map((x: any) => ({ label: label(x.date), a: x.income, b: x.expense }))} /> : <Empty text="Sin movimientos en el periodo" />}
          </CardContent>
        </Card>
        <Card className="h-fit">
          <CardHeader><CardTitle>Resumen del periodo</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Ingresos</span><span className="font-medium text-emerald-600">{fmt(d.range.income)}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Egresos</span><span className="font-medium text-red-600">{fmt(d.range.expense)}</span></div>
            <div className="flex justify-between border-t pt-2 text-base font-semibold"><span>Utilidad</span><span className={d.range.utility < 0 ? 'text-red-600' : 'text-emerald-600'}>{fmt(d.range.utility)}</span></div>
            <div className="border-t pt-2">
              {d.cashDrawer.open
                ? <Link href="/cash" className="flex items-center gap-2 text-primary hover:underline"><Unlock className="h-4 w-4" />Caja abierta · efectivo esperado {fmt(d.cashDrawer.expectedCash)}</Link>
                : <Link href="/cash" className="flex items-center gap-2 text-muted-foreground hover:underline"><Lock className="h-4 w-4" />Caja cerrada · abrir caja</Link>}
            </div>
          </CardContent>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle>Flujo acumulado (utilidad neta)</CardTitle></CardHeader>
          <CardContent>{hasFlow ? <SignedAreaChart data={d.cashflow.map((x: any) => ({ label: label(x.date), value: x.cumulative }))} format={(n) => new Intl.NumberFormat('es-MX', { notation: 'compact' }).format(n)} /> : <Empty text="Sin datos" />}</CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Ingresos por método</CardTitle></CardHeader>
          <CardContent>{d.incomeByMethod.length ? <Donut data={d.incomeByMethod.map((m: any) => ({ label: METHODS[m.method], value: m.total }))} format={fmt} /> : <Empty text="Sin ingresos" />}</CardContent>
        </Card>
      </div>

      <div className="mt-3 grid gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle>Top gastos por categoría</CardTitle></CardHeader>
          <CardContent>
            {d.topExpenseCategories.length ? <HBar data={d.topExpenseCategories.map((c: any) => ({ label: CAT_LABEL[c.category] ?? c.category, value: c.total, sub: `${c.pct}%` }))} format={fmt} /> : <Empty text="Sin egresos" />}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Mayores egresos</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            {d.topExpenses.length === 0 && <Empty text="Sin egresos" />}
            {d.topExpenses.map((e: any, i: number) => (
              <div key={i} className="flex items-start justify-between gap-2">
                <div className="min-w-0"><p className="truncate font-medium">{e.concept}</p><p className="truncate text-xs text-muted-foreground">{CAT_LABEL[e.category] ?? e.category} · {e.responsibleName} · {dateTime(e.at)}</p></div>
                <span className="shrink-0 font-semibold text-red-600">{fmt(e.amount)}</span>
              </div>
            ))}
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle>Ingresos por fuente</CardTitle></CardHeader>
          <CardContent>
            {d.incomeBySource.length ? <HBar data={d.incomeBySource.map((s: any) => ({ label: SOURCE_LABEL[s.source] ?? s.source, value: s.total }))} format={fmt} /> : <Empty text="Sin ingresos" />}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
