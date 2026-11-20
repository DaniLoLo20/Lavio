'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Plus, ShoppingCart, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { money } from '@/lib/utils';
import { DownloadButton } from '@/components/download-button';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Empty, ErrorText, Input, Label, PageHeader, Select } from '@/components/ui';

const today = () => new Date().toISOString().slice(0, 10);
type Line = { productId: string; quantity: string; unitCost: string };
const blank = (): Line => ({ productId: '', quantity: '', unitCost: '' });

/** Compras + inventario en una sola pantalla. Una compra: suma al inventario, baja la caja y queda como egreso «Compras». */
export default function PurchasesPage() {
  const { user, can } = useAuth();
  const cur = user?.tenant.currency;
  const qc = useQueryClient();
  const canBuy = can('purchases:create');
  const list = useQuery({ queryKey: ['purchases'], queryFn: () => api<any[]>('/purchases') });
  const products = useQuery({ queryKey: ['products'], queryFn: () => api<any[]>('/inventory/products') });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api<any[]>('/suppliers'), enabled: can('suppliers:view') || canBuy });
  const cash = useQuery({ queryKey: ['cash', 'current'], queryFn: () => api<any | null>('/cash/current'), enabled: can('cash:view') });
  const cashOpen = !!cash.data?.session;

  const [supplierId, setSupplierId] = useState('');
  const [date, setDate] = useState(today());
  const [rf, setRf] = useState('');
  const [rt, setRt] = useState('');
  const [fromCash, setFromCash] = useState(true);
  const [payMethod, setPayMethod] = useState('CASH');
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [search, setSearch] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);
  const [done, setDone] = useState('');
  const formRef = useRef<HTMLDivElement>(null);

  // Si no hay caja abierta no se puede descontar de ella: se desmarca (la compra se registra igual, sin egreso).
  useEffect(() => { if (cash.isSuccess && !cashOpen) setFromCash(false); else if (cash.isSuccess && cashOpen) setFromCash(true); }, [cash.isSuccess, cashOpen]);

  const total = lines.reduce((s, l) => s + (Number(l.quantity) || 0) * (Number(l.unitCost) || 0), 0);
  const setLine = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, ...p } : l)));
  const pickProduct = (i: number, id: string) => {
    const pr = products.data?.find((x) => x.id === id);
    setLine(i, { productId: id, unitCost: pr && Number(pr.cost) ? String(Number(pr.cost)) : '' });
    if (pr?.supplierId && !supplierId) setSupplierId(pr.supplierId);
  };
  /** Botón «Comprar» de la tabla de inventario: agrega el producto al formulario y deja listo el campo de cantidad. */
  function buy(p: any) {
    setDone('');
    setLines((ls) => {
      if (ls.some((l) => l.productId === p.id)) return ls;
      const row: Line = { productId: p.id, quantity: '', unitCost: Number(p.cost) ? String(Number(p.cost)) : '' };
      return ls.length === 1 && !ls[0].productId ? [row] : [...ls, row];
    });
    if (p.supplierId && !supplierId) setSupplierId(p.supplierId);
    setTimeout(() => { formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }); formRef.current?.querySelector<HTMLInputElement>('input[data-qty="empty"]')?.focus(); }, 50);
  }

  const save = useMutation({
    mutationFn: () => api('/purchases', { body: { supplierId, date, ...(fromCash ? { expense: { method: payMethod } } : {}), items: lines.map((l) => ({ productId: l.productId, quantity: Number(l.quantity), unitCost: Number(l.unitCost) })) } }),
    onSuccess: () => {
      setDone(`Compra registrada por ${money(total, cur)}: inventario actualizado${fromCash ? ' y egreso «Compras» descontado de la caja' : ''}.`);
      setLines([blank()]);
      ['purchases', 'products', 'movements', 'dashboard', 'cash', 'finance'].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    },
  });

  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (products.data ?? []).filter((p) => (!s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s) || p.category.toLowerCase().includes(s)) && (!onlyLow || Number(p.stock) <= Number(p.minStock)));
  }, [products.data, search, onlyLow]);
  const lowCount = (products.data ?? []).filter((p) => Number(p.stock) <= Number(p.minStock)).length;

  return (
    <>
      <PageHeader title="Compras e inventario">
        <Input type="date" value={rf} onChange={(e) => setRf(e.target.value)} className="h-8 w-36" aria-label="Desde" />
        <Input type="date" value={rt} onChange={(e) => setRt(e.target.value)} className="h-8 w-36" aria-label="Hasta" />
        <DownloadButton type="purchases" params={{ from: rf, to: rt }} />
      </PageHeader>
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {/* Inventario */}
          <Card>
            <CardHeader className="flex-wrap gap-2">
              <CardTitle>Inventario</CardTitle>
              <div className="flex flex-wrap items-center gap-2">
                <Input className="h-8 w-48" placeholder="Buscar producto…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Buscar en inventario" />
                <label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={onlyLow} onChange={(e) => setOnlyLow(e.target.checked)} />Solo stock bajo ({lowCount})</label>
                {can('inventory:view') && <Link href="/inventory/products" className="text-xs text-primary underline">Administrar productos</Link>}
              </div>
            </CardHeader>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-y text-left text-xs text-muted-foreground"><tr><th className="p-3">Producto</th><th>Categoría</th><th className="text-right">Existencia</th><th className="text-right">Costo</th><th /></tr></thead>
                <tbody className="divide-y">
                  {rows.map((p) => {
                    const low = Number(p.stock) <= Number(p.minStock);
                    return (
                      <tr key={p.id}>
                        <td className="p-3 font-medium">{p.name} <span className="font-mono text-xs font-normal text-muted-foreground">{p.sku}</span></td>
                        <td>{p.category}</td>
                        <td className="text-right">{low && <AlertTriangle className="mr-1 inline h-4 w-4 text-amber-500" />}{Number(p.stock)} <span className="text-xs text-muted-foreground">/ mín {Number(p.minStock)}</span></td>
                        <td className="text-right">{money(p.cost, cur)}</td>
                        <td className="pr-3 text-right">{canBuy && <Button size="sm" variant={low ? 'default' : 'outline'} onClick={() => buy(p)}><ShoppingCart className="h-3.5 w-3.5" />Comprar</Button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {rows.length === 0 && <Empty text={products.data?.length ? 'Ningún producto coincide' : 'Aún no hay productos'} />}
            </div>
          </Card>

          {/* Historial */}
          <div className="space-y-3">
            <h2 className="text-sm font-semibold">Compras registradas</h2>
            {list.data?.length === 0 && <Empty text="Sin compras registradas" />}
            {list.data?.filter((p) => (!rf || p.date.slice(0, 10) >= rf) && (!rt || p.date.slice(0, 10) <= rt)).map((p) => (
              <Card key={p.id}><CardContent className="text-sm">
                <div className="flex justify-between font-medium"><span>{p.supplier.name} · {new Date(p.date).toLocaleDateString('es-MX', { timeZone: 'UTC' })}</span><span>{money(p.total, cur)}</span></div>
                <ul className="mt-1 text-xs text-muted-foreground">{p.items.map((i: any) => <li key={i.id}>{Number(i.quantity)} × {i.product.name} @ {money(i.unitCost, cur)}</li>)}</ul>
              </CardContent></Card>
            ))}
          </div>
        </div>

        <div ref={formRef} className={canBuy ? 'h-fit scroll-mt-4 lg:sticky lg:top-6' : 'hidden'}>
          <Card>
            <CardHeader><CardTitle>Registrar compra</CardTitle></CardHeader>
            <CardContent>
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setDone(''); save.mutate(); }}>
                <div><Label>Proveedor</Label><Select required value={supplierId} onChange={(e) => setSupplierId(e.target.value)}><option value="">Seleccione…</option>{suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
                <div><Label>Fecha</Label><Input required type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
                {lines.map((l, i) => (
                  <div key={i} className="space-y-1 rounded-md border p-2">
                    <Select required value={l.productId} onChange={(e) => pickProduct(i, e.target.value)}><option value="">Producto…</option>{products.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</Select>
                    <div className="flex gap-2">
                      <div className="flex-1"><Label className="text-xs">Cantidad *</Label><Input required data-qty={l.quantity ? 'set' : 'empty'} type="number" min="0.001" step="0.001" placeholder="Cantidad" value={l.quantity} onChange={(e) => setLine(i, { quantity: e.target.value })} /></div>
                      <div className="flex-1"><Label className="text-xs">Costo unitario</Label><Input required type="number" min="0" step="0.01" placeholder="Costo" value={l.unitCost} onChange={(e) => setLine(i, { unitCost: e.target.value })} /></div>
                      {lines.length > 1 && <Button type="button" variant="ghost" size="icon" className="mt-5" aria-label="Quitar" onClick={() => setLines(lines.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>}
                    </div>
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" onClick={() => setLines([...lines, blank()])}><Plus className="h-4 w-4" />Producto</Button>
                <p className="text-sm font-semibold">Total: {money(total, cur)}</p>

                <div className="space-y-2 rounded-md bg-muted p-3 text-sm">
                  <label className="flex items-start gap-2">
                    <input type="checkbox" className="mt-1" checked={fromCash} disabled={!cashOpen} onChange={(e) => setFromCash(e.target.checked)} />
                    <span>Pagar con la caja: se descuenta y queda como <b>egreso · Compras</b></span>
                  </label>
                  {fromCash && (
                    <Select value={payMethod} onChange={(e) => setPayMethod(e.target.value)} aria-label="Forma de pago"><option value="CASH">Efectivo</option><option value="CARD">Tarjeta</option><option value="TRANSFER">Transferencia</option></Select>
                  )}
                  {!cashOpen && cash.isSuccess && <p className="text-xs text-amber-700 dark:text-amber-400">No hay caja abierta: la compra sumará al inventario pero no registrará egreso. Abre la caja para descontarla.</p>}
                  <p className="text-xs text-muted-foreground">La compra siempre suma las cantidades a tu inventario y actualiza el costo.</p>
                </div>
                <ErrorText error={save.error} />
                {done && <p className="rounded-md bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-300">{done}</p>}
                <Button disabled={save.isPending || !supplierId}>{save.isPending ? 'Guardando…' : 'Guardar compra'}</Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  );
}
