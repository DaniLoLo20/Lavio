'use client';
import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, Printer } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CAT_LABEL } from '@/lib/cash';
import { BRAND, LogoMark } from '@/components/brand';
import { METHODS, cn, dateTime, money } from '@/lib/utils';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Empty, PageHeader } from '@/components/ui';
import { DownloadButton } from '@/components/download-button';
import { MovementsTable } from '@/components/cash-movements';

const Row = ({ label, value, bold, tone }: { label: React.ReactNode; value: React.ReactNode; bold?: boolean; tone?: string }) => (
  <div className={cn('flex justify-between gap-4 py-1 text-sm', bold && 'border-t pt-2 text-base font-semibold', tone)}><span>{label}</span><span>{value}</span></div>
);

function Report() {
  const id = useSearchParams().get('id') ?? '';
  const { user } = useAuth();
  const cur = user?.tenant.currency;
  const q = useQuery({ queryKey: ['cash', 'session', id], queryFn: () => api<any>(`/cash/sessions/${id}`), enabled: !!id });
  if (!q.data) return <p className="text-sm text-muted-foreground">{q.error ? (q.error as Error).message : 'Cargando…'}</p>;
  const { session: s, figures: f, movements, payments, lateOrderPayments } = q.data;
  const closed = s.status === 'CLOSED';

  return (
    <>
      <div className="print:hidden">
        <PageHeader title={closed ? 'Corte de caja' : 'Caja abierta'}>
          <Link href="/cash" className="inline-flex h-8 items-center gap-1 rounded-md border px-3 text-xs hover:bg-muted"><ArrowLeft className="h-4 w-4" />Caja</Link>
          <DownloadButton type="cash-closing" params={{ sessionId: id }} label="CSV" />
          <Button size="sm" variant="outline" onClick={() => window.print()}><Printer className="h-4 w-4" />Imprimir</Button>
        </PageHeader>
      </div>

      <div className="mb-4 hidden items-center gap-3 print:flex">
        <LogoMark size={44} />
        <div><p className="text-lg font-bold">{BRAND.name} · Corte de caja</p><p className="text-sm">{user?.tenant.name}</p></div>
      </div>

      <Card className="mb-4">
        <CardContent className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><p className="text-xs text-muted-foreground">Estado</p><p><Badge className={closed ? 'bg-muted text-muted-foreground' : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'}>{closed ? 'Cerrada' : 'Abierta'}</Badge></p></div>
          <div><p className="text-xs text-muted-foreground">Abrió</p><p>{s.openedByName}</p></div>
          <div><p className="text-xs text-muted-foreground">Apertura</p><p>{dateTime(s.openedAt)}</p></div>
          <div><p className="text-xs text-muted-foreground">Cierre</p><p>{closed ? `${dateTime(s.closedAt)} · ${s.closedByName}` : '—'}</p></div>
        </CardContent>
      </Card>

      {lateOrderPayments > 0 && (
        <p className="mb-4 rounded-md bg-amber-500/15 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
          Después del corte se sincronizaron cobros por {money(lateOrderPayments, cur)} que ocurrieron durante este turno (órdenes capturadas sin conexión). El corte conserva las cifras del momento en que se cerró.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>Cifras del corte</CardTitle></CardHeader>
          <CardContent>
            <Row label="Caja inicial" value={money(f.openingAmount, cur)} />
            <Row label="Total ingresos" value={money(f.totalIncome, cur)} tone="text-emerald-600" />
            <Row label="Total egresos" value={money(f.totalExpense, cur)} tone="text-red-600" />
            <Row bold label="Caja esperada (efectivo)" value={money(f.expectedCash, cur)} />
            {closed && (
              <>
                <Row label="Caja real" value={money(s.countedCash, cur)} />
                <Row bold label="Diferencia" value={money(s.difference, cur)} tone={s.difference < 0 ? 'text-red-600' : s.difference > 0 ? 'text-sky-600' : 'text-emerald-600'} />
                {s.closingNotes && <p className="mt-2 text-sm text-muted-foreground">Notas: {s.closingNotes}</p>}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Desglose por método</CardTitle></CardHeader>
          <CardContent className="text-sm">
            <div className="grid grid-cols-4 gap-1 border-b pb-1 text-xs text-muted-foreground"><span /><span className="text-right">Efectivo</span><span className="text-right">Tarjeta</span><span className="text-right">Transf.</span></div>
            {[['Cobros de órdenes', f.orders], ['Otros ingresos', f.manualIncome], ['Egresos', f.expense]].map(([label, m]: any) => (
              <div key={label} className="grid grid-cols-4 gap-1 py-1"><span>{label}</span><span className="text-right">{money(m.CASH, cur)}</span><span className="text-right">{money(m.CARD, cur)}</span><span className="text-right">{money(m.TRANSFER, cur)}</span></div>
            ))}
            <p className="mt-2 text-xs text-muted-foreground">Solo el efectivo afecta la caja esperada.</p>
            {Object.keys(f.expenseByCategory).length > 0 && (
              <div className="mt-3 border-t pt-2">
                <p className="mb-1 text-xs font-medium text-muted-foreground">Egresos por categoría</p>
                {Object.entries(f.expenseByCategory).map(([c, v]) => <Row key={c} label={CAT_LABEL[c] ?? c} value={money(v as number, cur)} />)}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="mt-4">
        <CardHeader><CardTitle>Movimientos manuales</CardTitle></CardHeader>
        <MovementsTable rows={movements} cur={cur} />
      </Card>

      <Card className="mt-4">
        <CardHeader><CardTitle>Cobros de órdenes ({payments.length})</CardTitle></CardHeader>
        {payments.length === 0 ? <Empty text="Sin cobros" /> : (
          <div className="divide-y text-sm">
            {payments.map((p: any) => (
              <div key={p.id} className="flex justify-between gap-3 p-3"><span>{p.folio} · {METHODS[p.method]} · {dateTime(p.paidAt)}</span><span className="font-medium">{money(p.amount, cur)}</span></div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}

export default function Page() {
  return (
    <Suspense fallback={<p className="text-sm text-muted-foreground">Cargando…</p>}>
      <Report />
    </Suspense>
  );
}
