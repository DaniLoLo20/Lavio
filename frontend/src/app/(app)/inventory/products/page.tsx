'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowUpDown, Plus } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { money } from '@/lib/utils';
import { DownloadButton } from '@/components/download-button';
import { Modal } from '@/components/modal';
import { Badge, Button, Card, Empty, ErrorText, Input, Label, PageHeader, Select } from '@/components/ui';

const empty = { sku: '', name: '', category: '', stock: '0', minStock: '0', cost: '0', supplierId: '' };
type SortKey = 'name' | 'sku' | 'category' | 'stock' | 'cost';

export default function ProductsPage() {
  const { user, can } = useAuth();
  const qc = useQueryClient();
  const cur = user?.tenant.currency;
  const products = useQuery({ queryKey: ['products'], queryFn: () => api<any[]>('/inventory/products') });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api<any[]>('/suppliers'), enabled: can('suppliers:view') });
  const canCreate = can('inventory:create');
  const canEdit = can('inventory:edit');
  const canDelete = can('inventory:delete');
  const canAdjust = can('inventory:adjust');

  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [supplier, setSupplier] = useState('');
  const [stockFilter, setStockFilter] = useState('');
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'name', dir: 1 });
  const [form, setForm] = useState<{ id?: string; v: typeof empty } | null>(null);
  const [adj, setAdj] = useState<{ p: any; type: 'IN' | 'OUT' | 'ADJUSTMENT'; quantity: string; reason: string } | null>(null);

  const refresh = () => { qc.invalidateQueries({ queryKey: ['products'] }); qc.invalidateQueries({ queryKey: ['movements'] }); };
  const body = (v: typeof empty) => ({ sku: v.sku, name: v.name, category: v.category, minStock: Number(v.minStock), cost: Number(v.cost), supplierId: v.supplierId || undefined });
  const save = useMutation({
    mutationFn: () => form!.id
      ? api(`/inventory/products/${form!.id}`, { method: 'PATCH', body: body(form!.v) })
      : api('/inventory/products', { body: { ...body(form!.v), stock: Number(form!.v.stock) } }),
    onSuccess: () => { setForm(null); refresh(); },
  });
  const del = useMutation({ mutationFn: (id: string) => api(`/inventory/products/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const move = useMutation({
    mutationFn: () => api('/inventory/movements', { body: { productId: adj!.p.id, type: adj!.type, quantity: Number(adj!.quantity), reason: adj!.reason || undefined } }),
    onSuccess: () => { setAdj(null); refresh(); },
  });

  const categories = useMemo(() => [...new Set((products.data ?? []).map((p) => p.category))].sort(), [products.data]);
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    const list = (products.data ?? []).filter((p) => {
      const stock = Number(p.stock), min = Number(p.minStock);
      return (!s || p.name.toLowerCase().includes(s) || p.sku.toLowerCase().includes(s) || p.category.toLowerCase().includes(s))
        && (!category || p.category === category)
        && (!supplier || (supplier === 'none' ? !p.supplierId : p.supplierId === supplier))
        && (!stockFilter || (stockFilter === 'low' ? stock <= min && stock > 0 : stockFilter === 'out' ? stock <= 0 : stock > min));
    });
    const val = (p: any) => (sort.key === 'stock' || sort.key === 'cost' ? Number(p[sort.key]) : String(p[sort.key]).toLowerCase());
    return list.sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * sort.dir);
  }, [products.data, search, category, supplier, stockFilter, sort]);

  const lowCount = (products.data ?? []).filter((p) => Number(p.stock) <= Number(p.minStock)).length;
  const value = rows.reduce((s, p) => s + Number(p.stock) * Number(p.cost), 0);
  const th = (key: SortKey, label: string, right?: boolean) => (
    <th className={`p-3 ${right ? 'text-right' : ''}`}>
      <button className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => setSort((s) => ({ key, dir: s.key === key ? (-s.dir as 1 | -1) : 1 }))}>{label}<ArrowUpDown className="h-3 w-3" /></button>
    </th>
  );
  const set = (k: keyof typeof empty, v: string) => setForm((f) => f && { ...f, v: { ...f.v, [k]: v } });
  const clear = () => { setSearch(''); setCategory(''); setSupplier(''); setStockFilter(''); };

  return (
    <>
      <PageHeader title="Productos">
        <DownloadButton type="inventory" label="Exportar" />
        {canCreate && <Button size="sm" onClick={() => setForm({ v: empty })}><Plus className="h-4 w-4" />Nuevo producto</Button>}
      </PageHeader>

      <div className="mb-3 flex flex-wrap gap-2">
        <Input className="min-w-[10rem] flex-1" placeholder="Buscar por nombre, SKU o categoría…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select className="w-44" value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Categoría"><option value="">Todas las categorías</option>{categories.map((c) => <option key={c}>{c}</option>)}</Select>
        <Select className="w-44" value={supplier} onChange={(e) => setSupplier(e.target.value)} aria-label="Proveedor"><option value="">Todos los proveedores</option><option value="none">Sin proveedor</option>{suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select>
        <Select className="w-40" value={stockFilter} onChange={(e) => setStockFilter(e.target.value)} aria-label="Existencia"><option value="">Toda existencia</option><option value="ok">En stock</option><option value="low">Stock bajo</option><option value="out">Agotado</option></Select>
        {(search || category || supplier || stockFilter) && <Button variant="ghost" size="sm" onClick={clear}>Limpiar</Button>}
      </div>
      <p className="mb-2 text-xs text-muted-foreground">
        {rows.length} de {products.data?.length ?? 0} productos · valor en inventario {money(value, cur)}
        {lowCount > 0 && <> · <button className="text-amber-600 underline" onClick={() => { clear(); setStockFilter('low'); }}>{lowCount} con stock bajo o agotado</button></>}
      </p>
      <ErrorText error={del.error} />

      <Card className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-xs text-muted-foreground">
            <tr>{th('sku', 'SKU')}{th('name', 'Producto')}{th('category', 'Categoría')}{th('stock', 'Existencia', true)}{th('cost', 'Costo', true)}<th className="p-3">Proveedor</th><th /></tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((p) => {
              const stock = Number(p.stock);
              const low = stock <= Number(p.minStock);
              return (
                <tr key={p.id}>
                  <td className="p-3 font-mono text-xs">{p.sku}</td>
                  <td className="font-medium">{p.name}</td>
                  <td>{p.category}</td>
                  <td className="text-right">
                    {low && <AlertTriangle className="mr-1 inline h-4 w-4 text-amber-500" />}{stock}
                    <span className="text-xs text-muted-foreground"> / mín {Number(p.minStock)}</span>
                    {stock <= 0 && <Badge className="ml-1 bg-destructive/15 text-destructive">Agotado</Badge>}
                  </td>
                  <td className="text-right">{money(p.cost, cur)}</td>
                  <td>{p.supplier?.name ?? '—'}</td>
                  <td className="whitespace-nowrap pr-3 text-right">
                    {canAdjust && <Button size="sm" variant="outline" onClick={() => setAdj({ p, type: 'IN', quantity: '', reason: '' })}>Stock</Button>}{' '}
                    {canEdit && <Button size="sm" variant="outline" onClick={() => setForm({ id: p.id, v: { sku: p.sku, name: p.name, category: p.category, stock: String(Number(p.stock)), minStock: String(Number(p.minStock)), cost: String(Number(p.cost)), supplierId: p.supplierId ?? '' } })}>Editar</Button>}{' '}
                    {canDelete && <Button size="sm" variant="ghost" onClick={() => confirm(`¿Eliminar "${p.name}"?`) && del.mutate(p.id)}>Eliminar</Button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {rows.length === 0 && <Empty text={products.data?.length ? 'Ningún producto coincide con los filtros' : 'Aún no hay productos'} />}
      </Card>
      <p className="mt-3 text-xs text-muted-foreground">Historial de entradas y salidas en <Link href="/inventory/movements" className="text-primary underline">Movimientos</Link>.</p>

      {form && (
        <Modal title={form.id ? 'Editar producto' : 'Nuevo producto'} onClose={() => { setForm(null); save.reset(); }}>
          <form className="space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
            <div className="grid grid-cols-2 gap-2">
              <div><Label>SKU</Label><Input required value={form.v.sku} onChange={(e) => set('sku', e.target.value)} /></div>
              <div><Label>Categoría</Label><Input required list="cats" value={form.v.category} onChange={(e) => set('category', e.target.value)} placeholder="Shampoo" /><datalist id="cats">{categories.map((c) => <option key={c} value={c} />)}</datalist></div>
            </div>
            <div><Label>Nombre</Label><Input required value={form.v.name} onChange={(e) => set('name', e.target.value)} /></div>
            <div className="grid grid-cols-3 gap-2">
              <div><Label>Existencia</Label><Input type="number" min="0" step="0.001" disabled={!!form.id} value={form.v.stock} onChange={(e) => set('stock', e.target.value)} /></div>
              <div><Label>Mínimo</Label><Input type="number" min="0" step="0.001" value={form.v.minStock} onChange={(e) => set('minStock', e.target.value)} /></div>
              <div><Label>Costo</Label><Input type="number" min="0" step="0.01" value={form.v.cost} onChange={(e) => set('cost', e.target.value)} /></div>
            </div>
            {form.id && <p className="text-xs text-muted-foreground">La existencia se cambia con el botón «Stock» para dejar registro del movimiento.</p>}
            <div><Label>Proveedor</Label><Select value={form.v.supplierId} onChange={(e) => set('supplierId', e.target.value)}><option value="">—</option>{suppliers.data?.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></div>
            <ErrorText error={save.error} />
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => { setForm(null); save.reset(); }}>Cancelar</Button><Button disabled={save.isPending}>{form.id ? 'Guardar' : 'Crear producto'}</Button></div>
          </form>
        </Modal>
      )}

      {adj && (
        <Modal title={`Ajustar stock: ${adj.p.name}`} onClose={() => { setAdj(null); move.reset(); }}>
          <form className="space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); move.mutate(); }}>
            <p className="text-sm text-muted-foreground">Existencia actual: <b>{Number(adj.p.stock)}</b></p>
            <div><Label>Tipo</Label><Select value={adj.type} onChange={(e) => setAdj({ ...adj, type: e.target.value as any })}><option value="IN">Entrada</option><option value="OUT">Salida (consumo)</option><option value="ADJUSTMENT">Ajuste (+/−)</option></Select></div>
            <div><Label>Cantidad</Label><Input required autoFocus type="number" step="0.001" value={adj.quantity} onChange={(e) => setAdj({ ...adj, quantity: e.target.value })} /></div>
            <div><Label>Motivo</Label><Input value={adj.reason} onChange={(e) => setAdj({ ...adj, reason: e.target.value })} /></div>
            <ErrorText error={move.error} />
            <div className="flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => { setAdj(null); move.reset(); }}>Cancelar</Button><Button disabled={move.isPending}>Registrar</Button></div>
          </form>
        </Modal>
      )}
    </>
  );
}
