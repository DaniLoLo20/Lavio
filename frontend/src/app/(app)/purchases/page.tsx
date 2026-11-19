'use client';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { money } from '@/lib/utils';
import { DownloadButton } from '@/components/download-button';
import { Button, Card, CardContent, CardHeader, CardTitle, Empty, ErrorText, Input, Label, PageHeader, Select } from '@/components/ui';

const today = () => new Date().toISOString().slice(0, 10);
type Line = { productId: string; quantity: string; unitCost: string };

export default function PurchasesPage() {
  const { user, can } = useAuth();
  const cur = user?.tenant.currency;
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['purchases'], queryFn: () => api<any[]>('/purchases') });
  const products = useQuery({ queryKey: ['products'], queryFn: () => api<any[]>('/inventory/products') });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api<any[]>('/suppliers') });
  const [supplierId, setSupplierId] = useState('');
  const [date, setDate] = useState(today());
  const [rf, setRf] = useState('');
  const [rt, setRt] = useState('');
  const [fromCash, setFromCash] = useState(false);
  const [payMethod, setPayMethod] = useState('CASH');
  const [lines, setLines] = useState<Line[]>([{ productId: '', quantity: '', unitCost: '' }]);

  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0);
  const setLine = (i: number, p: Partial<Line>) => setLines(lines.map((l, j) => (j === i ? { ...l, ...p } : l)));

  const save = useMutation({
    mutationFn: () => api('/purchases', { body: { supplierId, date, ...(fromCash ? { expense: { method: payMethod } } : {}), items: lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity), unitCost: Number(l.unitCost) })) } }),
    onSuccess: () => {
      setLines([{ productId: '', quantity: '', unitCost: '' }]);
      ['purchases', 'products', 'movements', 'dashboard', 'cash', 'finance'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
  });

  return (
    <>
      <PageHeader title="Compras"><Input type="date" value={rf} onChange={(e) => setRf(e.target.value)} className="h-8 w-36" aria-label="Desde" /><Input type="date" value={rt} onChange={(e) => setRt(e.target.value)} className="h-8 w-36" aria-label="Hasta" /><DownloadButton type="purchases" params={{ from: rf, to: rt }} /></PageHeader>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-3 lg:col-span-2">
          {list.data?.length === 0 && <Empty text="Sin compras registradas" />}
          {list.data?.map((p) => (
            <Card key={p.id}><CardContent className="text-sm">
              <div className="flex justify-between font-medium"><span>{p.supplier.name} · {new Date(p.date).toLocaleDateString('es-MX', { timeZone: 'UTC' })}</span><span>{money(p.total, cur)}</span></div>
              <ul className="mt-1 text-xs text-muted-foreground">{p.items.map((i: any) => <li key={i.id}>{Number(i.quantity)} × {i.product.name} @ {money(i.unitCost, cur)}</li>)}</ul>
            </CardContent></Card>
          ))}
        </div>
        <Card className={can('purchases:create') ? 'h-fit' : 'hidden'}>
          <CardHeader><CardTitle>Registrar compra</CardTitle></CardHeader>
          <CardContent>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
              <div><Label>Proveedor</Label><Select required value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Seleccione…</option>{suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
              <div><Label>Fecha</Label><Input required type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
              {lines.map((l, i) => (
                <div key={i} className="space-y-1 rounded-md border p-2">
                  <Select required value={l.productId} onChange={(e) => setLine(i, { productId: e.target.value })}><option value="">Producto…</option>{products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
                  <div className="flex gap-2">
                    <Input required type="number" min="0.001" step="0.001" placeholder="Cant." value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} />
                    <Input required type="number" min="0" step="0.01" placeholder="Costo" value={l.unitCost} onChange={(e) => setLine(i, { unitCost: e.target.value })} />
                    {lines.length > 1 && <Button type="button" variant="ghost" size="icon" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>}
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => setLines([...lines, { productId: '', quantity: '', unitCost: '' }])}><Plus className="h-4 w-4" />Producto</Button>
              <p className="text-sm font-semibold">Total: {money(total, cur)}</p>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={fromCash} onChange={(e) => setFromCash(e.target.checked)} />Registrar también como egreso de caja</label>
              {fromCash && (
                <div>
                  <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value)}><option value="CASH">Efectivo</option><option value="CARD">Tarjeta</option><option value="TRANSFER">Transferencia</option></Select>
                  <p className="mt-1 text-xs text-muted-foreground">Requiere caja abierta. Se registra como categoría Compras.</p>
                </div>
              )}
              <ErrorText error={save.error} />
              <Button disabled={save.isPending}>Guardar y actualizar inventario</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
