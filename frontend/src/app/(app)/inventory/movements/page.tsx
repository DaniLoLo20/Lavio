'use client';
import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { dateTime } from '@/lib/utils';
import { DownloadButton } from '@/components/download-button';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Empty, ErrorText, Input, Label, PageHeader, Select } from '@/components/ui';

const TYPES: Record<string, { label: string; cls: string; sign: string }> = {
  IN: { label: 'Entrada', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300', sign: '+' },
  OUT: { label: 'Salida', cls: 'bg-red-500/15 text-red-700 dark:text-red-300', sign: '−' },
  ADJUSTMENT: { label: 'Ajuste', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300', sign: '±' },
};

export default function MovementsPage() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const products = useQuery({ queryKey: ['products'], queryFn: () => api<any[]>('/inventory/products') });
  const moves = useQuery({ queryKey: ['movements'], queryFn: () => api<any[]>('/inventory/movements') });
  const canAdjust = can('inventory:adjust');

  const [type, setType] = useState('');
  const [product, setProduct] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [search, setSearch] = useState('');
  const [mv, setMv] = useState({ productId: '', type: 'OUT', quantity: '', reason: '' });

  const move = useMutation({
    mutationFn: () => api('/inventory/movements', { body: { ...mv, quantity: Number(mv.quantity), reason: mv.reason || undefined } }),
    onSuccess: () => { setMv({ ...mv, quantity: '', reason: '' }); qc.invalidateQueries({ queryKey: ['products'] }); qc.invalidateQueries({ queryKey: ['movements'] }); },
  });

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (moves.data ?? []).filter((m) => {
      const d = m.createdAt.slice(0, 10);
      return (!type || m.type === type) && (!product || m.productId === product || m.product?.id === product)
        && (!from || d >= from) && (!to || d <= to)
        && (!s || (m.reason ?? '').toLowerCase().includes(s) || m.product.name.toLowerCase().includes(s));
    });
  }, [moves.data, type, product, from, to, search]);

  return (
    <>
      <PageHeader title="Movimientos de inventario"><DownloadButton type="movements" label="Exportar" /></PageHeader>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          <div className="flex flex-wrap gap-2">
            <Input className="min-w-[10rem] flex-1" placeholder="Buscar producto o motivo…" value={search} onChange={(e) => setSearch(e.target.value)} />
            <Select className="w-36" value={type} onChange={(e) => setType(e.target.value)} aria-label="Tipo"><option value="">Todos los tipos</option>{Object.entries(TYPES).map(([k, t]) => <option key={k} value={k}>{t.label}</option>)}</Select>
            <Select className="w-44" value={product} onChange={(e) => setProduct(e.target.value)} aria-label="Producto"><option value="">Todos los productos</option>{products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
            <Input className="w-36" type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Desde" />
            <Input className="w-36" type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Hasta" />
          </div>
          <p className="text-xs text-muted-foreground">{rows.length} movimientos</p>
          <Card className="divide-y">
            {rows.length === 0 && <Empty text="Sin movimientos" />}
            {rows.slice(0, 200).map((m) => {
              const t = TYPES[m.type] ?? TYPES.ADJUSTMENT;
              return (
                <div key={m.id} className="flex items-center justify-between gap-3 p-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium">{m.product.name} {m.reason && <span className="font-normal text-muted-foreground">({m.reason})</span>}</p>
                    <p className="text-xs text-muted-foreground">{dateTime(m.createdAt)}</p>
                  </div>
                  <div className="shrink-0 text-right"><Badge className={t.cls}>{t.label}</Badge> <b>{t.sign}{Number(m.quantity)}</b></div>
                </div>
              );
            })}
          </Card>
        </div>
        {canAdjust && (
          <Card className="h-fit">
            <CardHeader><CardTitle>Registrar movimiento</CardTitle></CardHeader>
            <CardContent>
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); move.mutate(); }}>
                <div><Label>Producto</Label><Select required value={mv.productId} onChange={(e) => setMv({ ...mv, productId: e.target.value })}><option value="">Producto…</option>{products.data?.map((p) => <option key={p.id} value={p.id}>{p.name} ({Number(p.stock)})</option>)}</Select></div>
                <div><Label>Tipo</Label><Select value={mv.type} onChange={(e) => setMv({ ...mv, type: e.target.value })}><option value="OUT">Salida (consumo)</option><option value="IN">Entrada</option><option value="ADJUSTMENT">Ajuste (+/−)</option></Select></div>
                <div><Label>Cantidad</Label><Input required type="number" step="0.001" value={mv.quantity} onChange={(e) => setMv({ ...mv, quantity: e.target.value })} /></div>
                <div><Label>Motivo</Label><Input value={mv.reason} onChange={(e) => setMv({ ...mv, reason: e.target.value })} /></div>
                <ErrorText error={move.error} />
                <Button disabled={move.isPending}>Registrar</Button>
              </form>
            </CardContent>
          </Card>
        )}
      </div>
    </>
  );
}
