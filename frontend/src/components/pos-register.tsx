'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { Banknote, Camera, ChevronDown, CreditCard, Landmark, Mic, Minus, Plus, Search, Trash2, X, Clock } from 'lucide-react';
import { api } from '@/lib/api';
import { useOnline } from '@/lib/net';
import { getDb } from '@/lib/offline/db';
import { createOrderOffline, discardOp, waitForOp } from '@/lib/offline/sync';
import { useAuth } from '@/lib/auth';
import { cn, money } from '@/lib/utils';
import { Button, ErrorText, Input, Label, Select, Textarea, buttonClass } from '@/components/ui';
import { Combobox } from '@/components/combobox';
import { VoiceFab, VoiceMode, type VoiceDraft } from '@/components/voice-mode';
import { ClientSuggest, SelectedClientNote } from '@/components/client-suggest';
import { findByPlate, useClientIndex, type ClientLite } from '@/lib/clients';
import { TicketActions, TicketView } from '@/components/ticket';

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
const PAY_OPTIONS = [
  { value: 'CASH', label: 'Efectivo', icon: Banknote },
  { value: 'CARD', label: 'Tarjeta', icon: CreditCard },
  { value: 'TRANSFER', label: 'Transferencia', icon: Landmark },
  { value: 'LATER', label: 'Cobrar después', icon: Clock },
];
const emptyV = { plate: '', brand: '', model: '', color: '' };
const emptyC = { name: '', phone: '', email: '', contactPreference: 'NONE' };

function Modal({ title, onClose, children }: { title: string; onClose?: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[95vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-xl border bg-card shadow-xl sm:rounded-xl">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold">{title}</h2>
          {onClose && <Button variant="ghost" size="icon" onClick={onClose} aria-label="Cerrar"><X className="h-4 w-4" /></Button>}
        </div>
        <div className="overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}

export function PosRegister({ cashMode = false }: { cashMode?: boolean }) {
  const { user, can } = useAuth();
  const canPrice = can('orders:edit_price');
  const qc = useQueryClient();
  const cur = user?.tenant.currency;
  const taxRate = user?.tenant.taxRate ?? 0;

  const services = useQuery({ queryKey: ['services', 'active'], queryFn: () => api<any[]>('/services?active=true') });
  const washers = useQuery({ queryKey: ['washers'], queryFn: () => api<any[]>('/users/washers') });

  const catalog = useQuery({ queryKey: ['catalog', 'vehicles'], queryFn: () => api<{ brand: string; models: string[] }[]>('/catalog/vehicles'), staleTime: Infinity });
  const [search, setSearch] = useState('');
  const [qty, setQty] = useState<Record<string, number>>({});
  /** Precios editados para esta orden (el del catálogo no cambia) */
  const [ov, setOv] = useState<Record<string, number>>({});
  const [discount, setDiscount] = useState('');
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(emptyV);
  const [c, setC] = useState(emptyC);
  const [clientId, setClientId] = useState<string | undefined>();
  const clients = useClientIndex();
  const picked = clients.find((x) => x.id === clientId);
  const [showClient, setShowClient] = useState(false);
  const [notes, setNotes] = useState('');
  const [washer, setWasher] = useState('');
  const [method, setMethod] = useState(cashMode ? 'CASH' : 'LATER'); // Nueva orden: «Cobrar después» por defecto
  const [ocrMsg, setOcrMsg] = useState('');
  const [ocrBusy, setOcrBusy] = useState(false);
  const [done, setDone] = useState<any>(null);
  const online = useOnline();
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [voiceOpen, setVoiceOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const ticketRef = useRef<HTMLDivElement>(null);

  const add = (id: string, d = 1) => setQty((q) => {
    const n = Math.max((q[id] || 0) + d, 0);
    const { [id]: _, ...rest } = q;
    return n ? { ...rest, [id]: n } : rest;
  });

  const all = services.data ?? [];
  const shown = useMemo(() => all.filter((s) => s.name.toLowerCase().includes(search.toLowerCase())), [all, search]);
  const lines = all.filter((s) => qty[s.id] > 0).map((s) => ({ ...s, base: Number(s.price), price: ov[s.id] !== undefined ? ov[s.id] : s.price }));
  const count = lines.reduce((n, l) => n + qty[l.id], 0);
  const subtotal = r2(lines.reduce((s, l) => s + Number(l.price) * qty[l.id], 0));
  const disc = Math.min(Math.max(Number(discount) || 0, 0), subtotal);
  const tax = r2(((subtotal - disc) * taxRate) / 100);
  const total = r2(subtotal - disc + tax);

  /**
   * Offline-first: la orden se guarda primero en el dispositivo y se sincroniza sola.
   * Con conexión se espera unos segundos para mostrar el folio real y reportar errores del servidor al instante.
   * Lo usan el formulario normal y el Modo Voz.
   */
  async function persist(p: {
    vehicle: { plate: string; brand: string; model: string; color: string };
    client: { id?: string; name?: string; phone?: string; email?: string; contactPreference?: string };
    notes?: string;
    items: { id: string; qty: number }[];
    discount: number;
    washerId?: string;
    method: string;
  }, opts: { silent?: boolean } = {}) {
    const washerName = washers.data?.find((w) => w.id === p.washerId)?.fullName;
    const { id, code, opId } = await createOrderOffline({
      vehicle: { ...p.vehicle, plate: p.vehicle.plate.trim() },
      client: p.client,
      notes: p.notes || undefined,
      items: p.items.map((i) => { const s = all.find((x) => x.id === i.id)!; const price = ov[s.id] !== undefined ? ov[s.id] : Number(s.price); return { serviceId: s.id, name: s.name, price, quantity: i.qty, priceEdited: price !== Number(s.price) }; }),
      discount: p.discount,
      taxRate,
      assignedToId: p.washerId || undefined,
      assignedToName: washerName,
      payment: p.method === 'LATER' ? null : { method: p.method },
    });
    const r = await waitForOp(opId, online ? 5000 : 0);
    if (r.state === 'failed') {
      // El servidor rechazó la orden (p. ej. un servicio que ya está inactivo): se descarta y se corrige en pantalla
      const op = await getDb().outbox.where('opId').equals(opId).first();
      if (op?.seq) await discardOp(op.seq);
      throw new Error(r.error || 'El servidor rechazó la orden');
    }
    const server = qc.getQueryData<any>(['order', id]);
    // para el ticket: la orden del servidor o, si aun no se sincroniza, la copia local (con precios estimados)
    const order = server ?? (await getDb().orders.get(id))?.data;
    if (!opts.silent) {
      setOpen(false);
      setVoiceOpen(false);
      setDone({ id, code, folio: server?.folio ?? null, pending: r.state !== 'synced', order });
    }
    qc.invalidateQueries({ queryKey: ['orders'] });
    qc.invalidateQueries({ queryKey: ['dashboard'] });
    qc.invalidateQueries({ queryKey: ['cash'] });
    qc.invalidateQueries({ queryKey: ['finance'] });
  }

  async function submitOrder() {
    setSaving(true);
    setSaveError('');
    try {
      await persist({
        vehicle: v,
        client: { id: clientId, name: c.name || undefined, phone: c.phone || undefined, email: c.email || undefined, contactPreference: c.contactPreference },
        notes,
        items: lines.map((l) => ({ id: l.id, qty: qty[l.id] })),
        discount: disc,
        washerId: washer,
        method,
      });
    } catch (e) {
      setSaveError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  // ----- Modo Voz -----
  async function saveVoice(d: VoiceDraft, o?: { silent?: boolean }) {
    await persist({
      vehicle: { plate: d.plate, brand: d.brand, model: d.model, color: d.color },
      client: { id: d.clientId, name: d.name || undefined, phone: d.phone || undefined, contactPreference: d.phone ? 'WHATSAPP' : 'NONE' },
      notes: d.notes,
      items: Object.entries(d.items).filter(([, q]) => q > 0).map(([id, q]) => ({ id, qty: q })),
      discount: 0,
      method: cashMode && d.method === 'LATER' ? 'CASH' : d.method,
    }, o);
  }

  /** Cada respuesta de voz llena el formulario del POS (por si se quiere seguir en modo manual). */
  function applyDraft(d: VoiceDraft) {
    setV({ plate: d.plate, brand: d.brand, model: d.model, color: d.color });
    const known = clients.find((x) => x.id === d.clientId);
    setClientId(d.clientId);
    setC((p) => ({ ...p, name: d.name, phone: d.phone, email: known?.email ?? p.email, contactPreference: known?.contactPreference && known.contactPreference !== 'NONE' ? known.contactPreference : d.phone ? 'WHATSAPP' : p.contactPreference }));
    setNotes(d.notes);
    setQty(d.items);
    if (d.method !== 'LATER' || method === 'LATER') setMethod(d.method);
  }

  useEffect(() => {
    // Acceso directo desde el botón flotante de otras pantallas: /pos?voice=1
    if (new URLSearchParams(location.search).get('voice') === '1') {
      setVoiceOpen(true);
      history.replaceState(null, '', '/pos');
    }
  }, []);
  /** Autocompletar: al elegir un cliente existente se rellenan sus datos (y su vehículo si aún no hay placa). */
  function pickClient(cl: ClientLite) {
    setClientId(cl.id);
    setC({ name: cl.name ?? '', phone: cl.phone ?? '', email: cl.email ?? '', contactPreference: cl.contactPreference ?? 'NONE' });
    setShowClient(true);
    const veh = cl.vehicles[0];
    if (veh && !v.plate.trim()) setV({ plate: veh.plate, brand: veh.brand, model: veh.model, color: veh.color });
  }
  /** Placa conocida: trae el vehículo y a su cliente. */
  function onPlate(plate: string) {
    const hit = findByPlate(clients, plate);
    if (hit && !v.brand && !v.model) setV({ plate, brand: hit.vehicle.brand, model: hit.vehicle.model, color: hit.vehicle.color });
    else setV((p) => ({ ...p, plate }));
    if (hit && !clientId && !c.name && !c.phone) pickClient({ ...hit.client, vehicles: [] });
  }

  /** Nueva orden: tocar un servicio lo selecciona y abre directo la ventana de pago (un paso menos). */
  function pickAndPay(id: string) {
    setQty({ [id]: 1 });
    setOv({});
    setSaveError('');
    setOpen(true);
  }
  /** Quita un renglón desde la ventana de pago; sin renglones se cierra. */
  function removeLine(id: string) {
    const rest = Object.fromEntries(Object.entries(qty).filter(([k]) => k !== id));
    setQty(rest);
    if (!Object.keys(rest).length) setOpen(false);
  }

  function reset() {
    setDone(null); setV(emptyV); setC(emptyC); setClientId(undefined); setOv({}); setQty({}); setNotes(''); setDiscount('');
    setMethod(cashMode ? 'CASH' : 'LATER'); setWasher(''); setOcrMsg(''); setShowClient(false); setSaveError('');
  }

  async function runOcr(file: File) {
    setOcrBusy(true);
    setOcrMsg('Leyendo placa…');
    try {
      const { createWorker } = await import('tesseract.js');
      const w = await createWorker('eng');
      await w.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-' });
      const { data } = await w.recognize(file);
      await w.terminate();
      const cand = data.text.toUpperCase().split(/\s+/).map((t) => t.replace(/[^A-Z0-9]/g, '')).filter((t) => t.length >= 5 && t.length <= 8).sort((a, b) => b.length - a.length)[0];
      if (cand) { setV((p) => ({ ...p, plate: cand })); setOcrMsg(`Placa detectada: ${cand}. Verifíquela.`); }
      else setOcrMsg('No se pudo leer la placa. Captúrela manualmente.');
    } catch {
      setOcrMsg('OCR no disponible (requiere internet la primera vez). Capture la placa manualmente.');
    } finally {
      setOcrBusy(false);
    }
  }

  const brandNames = (catalog.data ?? []).map((b) => b.brand);
  // Abreviaturas comunes -> nombre en el catalogo
  const ALIASES: Record<string, string> = { vw: 'Volkswagen', volks: 'Volkswagen', chevy: 'Chevrolet', chevrolet: 'Chevrolet', mercedes: 'Mercedes-Benz', benz: 'Mercedes-Benz', mb: 'Mercedes-Benz', mercedez: 'Mercedes-Benz', landrover: 'Land Rover', range: 'Land Rover', ram: 'RAM', dodge: 'Dodge', kia: 'Kia', mg: 'MG', gm: 'Chevrolet' };
  const resolveBrand = (text: string) => {
    const t = text.trim().toLowerCase();
    if (!t) return undefined;
    return brandNames.find((b) => b.toLowerCase() === t) ?? (ALIASES[t] && brandNames.includes(ALIASES[t]) ? ALIASES[t] : undefined);
  };
  const brandMatch = (opt: string, q: string) =>
    opt.toLowerCase().includes(q) || Object.entries(ALIASES).some(([k, target]) => target === opt && k.startsWith(q));
  const currentBrandName = resolveBrand(v.brand);
  const currentBrand = catalog.data?.find((b) => b.brand === currentBrandName);
  const brandModels = currentBrand?.models ?? [];
  // Al cambiar a otra marca se limpia el modelo para no mezclar marcas
  const changeBrand = (text: string) =>
    setV((p) => ({ ...p, brand: text, model: resolveBrand(text) === resolveBrand(p.brand) ? p.model : '' }));
  const COLORS = ['Blanco', 'Negro', 'Gris', 'Plata', 'Rojo', 'Azul', 'Verde', 'Amarillo', 'Naranja', 'Café', 'Beige', 'Dorado', 'Vino', 'Morado'];

  const validVehicle = v.plate.trim().length >= 3 && v.brand.trim() && v.model.trim() && v.color.trim();

  const checkoutForm = (
          <form id="checkout-form"
            className="space-y-5 p-4"
            onSubmit={(e) => { e.preventDefault(); if (validVehicle) void submitOrder(); }}
          >
            {!cashMode && (
              <div>
                <p className="mb-2 text-sm font-semibold">Servicios</p>
                <div className="space-y-2">
                  {lines.map((l) => (
                    <div key={l.id} className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate font-medium">{l.name}</span>
                      <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label={`Menos ${l.name}`} onClick={() => (qty[l.id] > 1 ? add(l.id, -1) : removeLine(l.id))}><Minus className="h-3 w-3" /></Button>
                      <span className="w-5 text-center">{qty[l.id]}</span>
                      <Button type="button" variant="outline" size="icon" className="h-8 w-8" aria-label={`Más ${l.name}`} onClick={() => add(l.id)}><Plus className="h-3 w-3" /></Button>
                      <Button type="button" variant="ghost" size="icon" className="h-8 w-8" aria-label={`Quitar ${l.name}`} onClick={() => removeLine(l.id)}><Trash2 className="h-3 w-3" /></Button>
                    </div>
                  ))}
                  {all.some((s) => !(qty[s.id] > 0)) && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      <span className="self-center text-xs text-muted-foreground">Agregar:</span>
                      {all.filter((s) => !(qty[s.id] > 0)).map((s) => (
                        <button key={s.id} type="button" onClick={() => add(s.id)} className="rounded-full border px-3 py-1 text-xs hover:bg-muted">+ {s.name} · {money(s.price, cur)}</button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            <div>
              <p className="mb-2 text-sm font-semibold">Vehículo</p>
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="sm:col-span-3">
                  <Label>Placa *</Label>
                  <div className="flex gap-2">
                    <Input autoFocus={!cashMode} value={v.plate} onChange={(e) => onPlate(e.target.value.toUpperCase())} placeholder="ABC123" className="font-mono uppercase" />
                    <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && runOcr(e.target.files[0])} />
                    <Button type="button" variant="outline" disabled={ocrBusy} onClick={() => fileRef.current?.click()}><Camera className="h-4 w-4" />Escanear</Button>
                  </div>
                  {ocrMsg && <p className="mt-1 text-xs text-muted-foreground">{ocrMsg}</p>}
                </div>
                <div>
                  <Label>Marca *</Label>
                  <Combobox
                    value={v.brand}
                    placeholder="Ej. VW, Nissan"
                    options={brandNames}
                    match={brandMatch}
                    onChange={changeBrand}
                    onPick={(b) => setV((p) => ({ ...p, brand: b, model: '' }))}
                    onBlurValue={(t) => { const b = resolveBrand(t); if (b && b !== v.brand) setV((p) => ({ ...p, brand: b, model: b === resolveBrand(p.brand) ? p.model : '' })); }}
                  />
                </div>
                <div>
                  <Label>Modelo *</Label>
                  <Combobox
                    value={v.model}
                    placeholder={currentBrand ? `Modelos de ${currentBrand.brand}` : 'Elija primero la marca'}
                    options={brandModels}
                    onChange={(t) => setV({ ...v, model: t })}
                  />
                </div>
                <div>
                  <Label>Color *</Label>
                  <Combobox value={v.color} placeholder="Rojo" options={COLORS} onChange={(t) => setV({ ...v, color: t })} />
                </div>
              </div>
            </div>

            <div>
              <button type="button" className="flex w-full items-center justify-between text-sm font-semibold" onClick={() => setShowClient(!showClient)}>
                Cliente y observaciones <span className="flex items-center gap-1 text-xs font-normal text-muted-foreground">opcional <ChevronDown className={cn('h-4 w-4 transition', showClient && 'rotate-180')} /></span>
              </button>
              {showClient && (
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="sm:col-span-2"><SelectedClientNote client={picked} onClear={() => setClientId(undefined)} /></div>
                  <div><Label>Nombre</Label><Input value={c.name} autoComplete="off" onChange={(e) => { setClientId(undefined); setC({ ...c, name: e.target.value }); }} /><ClientSuggest clients={clients} query={c.name} selectedId={clientId} onPick={pickClient} /></div>
                  <div><Label>Teléfono</Label><Input type="tel" inputMode="tel" autoComplete="off" value={c.phone} onChange={(e) => { setClientId(undefined); setC({ ...c, phone: e.target.value }); }} placeholder="10 dígitos" /><ClientSuggest clients={clients} query={c.phone} selectedId={clientId} onPick={pickClient} /></div>
                  <div><Label>Correo</Label><Input type="email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} /></div>
                  <div><Label>Preferencia de contacto</Label>
                    <Select value={c.contactPreference} onChange={(e) => setC({ ...c, contactPreference: e.target.value })}>
                      <option value="NONE">Ninguno</option><option value="WHATSAPP">WhatsApp</option><option value="EMAIL">Correo</option>
                    </Select>
                  </div>
                  <div className="sm:col-span-2"><Label>Observaciones</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Rayones, objetos de valor, etc." /></div>
                </div>
              )}
            </div>

            <div>
              <p className="mb-2 text-sm font-semibold">Método de pago</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {PAY_OPTIONS.filter((p) => !cashMode || p.value !== 'LATER').map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => setMethod(p.value)}
                    className={cn('flex flex-col items-center gap-1 rounded-lg border p-3 text-xs font-medium hover:bg-muted', method === p.value && 'border-primary bg-primary/10 text-primary')}
                  >
                    <p.icon className="h-5 w-5" />{p.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <Label>Lavador asignado</Label>
              <Select value={washer} onChange={(e) => setWasher(e.target.value)}>
                <option value="">Sin asignar</option>
                {washers.data?.filter((w) => w.isActive).map((w) => <option key={w.id} value={w.id}>{w.fullName}</option>)}
              </Select>
            </div>

            <div className="space-y-1 rounded-lg bg-muted p-3 text-sm">
              {lines.map((l) => <div key={l.id} className="flex items-center justify-between gap-2"><span className="min-w-0 flex-1 truncate">{qty[l.id]} × {l.name}</span><PriceField price={Number(l.price)} base={l.base} cur={cur} canEdit={canPrice} onChange={(n) => setOv((o) => ({ ...o, [l.id]: n }))} onReset={() => setOv(({ [l.id]: _, ...r }) => r)} /><span className="w-20 text-right">{money(Number(l.price) * qty[l.id], cur)}</span></div>)}
              <div className="flex justify-between border-t pt-1"><span>Subtotal</span><span>{money(subtotal, cur)}</span></div>
              {!cashMode && (
                <div className="flex items-center justify-between gap-3"><span>Descuento</span><Input type="number" min="0" step="0.01" placeholder="0.00" aria-label="Descuento" value={discount} onChange={(e) => setDiscount(e.target.value)} className="h-8 w-28 text-right" /></div>
              )}
              {cashMode && disc > 0 && <div className="flex justify-between"><span>Descuento</span><span>-{money(disc, cur)}</span></div>}
              <div className="flex justify-between"><span>IVA ({taxRate}%)</span><span>{money(tax, cur)}</span></div>
              <div className="flex justify-between text-base font-semibold"><span>Total</span><span>{money(total, cur)}</span></div>
            </div>

            <ErrorText error={saveError ? new Error(saveError) : undefined} />
            <Button size="lg" className="w-full" disabled={!validVehicle || saving}>
              {saving ? 'Creando…' : method === 'LATER' ? 'Crear orden' : `Confirmar pago · ${money(total, cur)}`}
            </Button>
          </form>
  );

  return (
    <div className={cashMode ? '' : '-mx-4 -mt-4 md:-mx-8 md:-mt-8'}>
      <div className={cn('grid', cashMode ? 'lg:grid-cols-[1fr_380px]' : 'min-h-[calc(100vh-3.5rem)] md:min-h-screen')}>
        {/* Productos */}
        <section className={cashMode ? 'p-4 pb-32 md:p-6 lg:pb-6' : 'p-4 pb-24 md:p-6'}>
          <div className="mb-4 flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <Input className="pl-9" placeholder="Buscar servicio…" value={search} onChange={(e) => setSearch(e.target.value)} />
          </div>
          {/* En la caja el botón de voz va integrado (un botón flotante taparía "Pagar") */}
          {cashMode && <Button type="button" onClick={() => setVoiceOpen(true)} aria-label="Activar Modo Voz"><Mic className="h-4 w-4" /><span className="hidden sm:inline">Modo Voz</span></Button>}
          </div>
          {services.data?.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">No hay servicios activos. Cree uno en Servicios.</p>}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
            {shown.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => (cashMode ? add(s.id) : pickAndPay(s.id))}
                className={cn(
                  'relative flex min-h-[110px] flex-col justify-between rounded-lg border bg-card p-3 text-left shadow-sm transition active:scale-[0.98] hover:border-primary',
                  qty[s.id] > 0 && 'border-primary ring-1 ring-primary',
                )}
              >
                {qty[s.id] > 0 && (
                  <span className="absolute right-2 top-2 grid h-6 min-w-6 place-items-center rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-foreground">{qty[s.id]}</span>
                )}
                <div>
                  <p className="pr-6 text-sm font-medium leading-tight">{s.name}</p>
                  {s.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{s.description}</p>}
                </div>
                <p className="mt-2 text-sm font-semibold">{money(s.price, cur)}</p>
              </button>
            ))}
          </div>
          {cashMode && count > 0 && (
            <div className="mt-6 rounded-xl border bg-card">
              <p className="border-b px-4 py-3 text-sm font-semibold">Datos de la venta y cobro</p>
              {checkoutForm}
            </div>
          )}
        </section>

        {/* Resumen lateral: solo en la caja. En Nueva orden el servicio abre directo la ventana de pago */}
        {cashMode && (
        <aside className="fixed inset-x-0 bottom-14 z-30 border-t bg-card lg:static lg:bottom-auto lg:flex lg:flex-col lg:border-l lg:border-t-0">
          <div className="hidden border-b px-4 py-3 text-sm font-semibold lg:block">Orden actual</div>
          <div className="hidden flex-1 space-y-2 overflow-y-auto p-4 lg:block">
            {lines.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">Toque un servicio para agregarlo</p>}
            {lines.map((l) => (
              <div key={l.id} className="flex items-center gap-2 text-sm">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{l.name}</p>
                  <PriceField price={Number(l.price)} base={l.base} cur={cur} canEdit={canPrice} onChange={(n) => setOv((o) => ({ ...o, [l.id]: n }))} onReset={() => setOv(({ [l.id]: _, ...r }) => r)} />
                </div>
                <div className="flex items-center gap-1">
                  <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => add(l.id, -1)}><Minus className="h-3 w-3" /></Button>
                  <span className="w-5 text-center">{qty[l.id]}</span>
                  <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => add(l.id)}><Plus className="h-3 w-3" /></Button>
                </div>
                <span className="w-20 text-right font-medium">{money(Number(l.price) * qty[l.id], cur)}</span>
                <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => add(l.id, -qty[l.id])}><Trash2 className="h-3 w-3" /></Button>
              </div>
            ))}
          </div>
          <div className="space-y-2 border-t p-4 text-sm">
            <div className="hidden space-y-2 lg:block">
              <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{money(subtotal, cur)}</span></div>
              <div className="flex items-center justify-between gap-3">
                <span className="text-muted-foreground">Descuento</span>
                <Input type="number" min="0" step="0.01" placeholder="0.00" value={discount} onChange={(e) => setDiscount(e.target.value)} className="h-8 w-28 text-right" />
              </div>
              <div className="flex justify-between"><span className="text-muted-foreground">IVA ({taxRate}%)</span><span>{money(tax, cur)}</span></div>
            </div>
            <div className="flex items-baseline justify-between text-lg font-semibold">
              <span>Total <span className="text-xs font-normal text-muted-foreground lg:hidden">({count} serv.)</span></span>
              <span>{money(total, cur)}</span>
            </div>
            <Button size="lg" className="w-full" disabled={count === 0 || saving} onClick={() => {
              if (!cashMode) return setOpen(true);
              const f = document.getElementById('checkout-form') as HTMLFormElement | null;
              if (!f) return;
              if (validVehicle) f.requestSubmit(); else f.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }}>{cashMode ? (validVehicle ? `Cobrar ${money(total, cur)}` : 'Cobrar') : 'Pagar'}</Button>
          </div>
        </aside>
        )}
      </div>

      {/* Ventana de datos y pago (en la caja el formulario va en la misma pantalla) */}
      {open && !cashMode && (
        <Modal title={`Pagar · ${money(total, cur)}`} onClose={() => setOpen(false)}>
          {checkoutForm}
        </Modal>
      )}

      {/* Modo Voz */}
      {!cashMode && <VoiceFab ctx="pos" onClick={() => setVoiceOpen(true)} />}
      <VoiceMode
        open={voiceOpen}
        onClose={() => setVoiceOpen(false)}
        services={all}
        clients={clients}
        catalog={catalog.data}
        taxRate={taxRate}
        currency={cur}
        online={online}
        onChange={applyDraft}
        onSave={saveVoice}
        allowLater={!cashMode}
        defaultMethod={cashMode ? 'CASH' : 'LATER'}
        onOpenInForm={(d) => { applyDraft(d); setVoiceOpen(false); setOpen(true); }}
      />
      {/* Comprobante: folio, código y TICKET con precios para enviar al cliente */}
      {done && (() => {
        const o = qc.getQueryData<any>(['order', done.id]) ?? done.order;
        const trackUrl = `${location.origin}/track/${done.code}`;
        return (
          <Modal title="Orden creada">
            <div className="space-y-4 p-4 sm:p-6">
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Folio</p>
                <p className="text-3xl font-semibold">{o?.folio ?? done.folio ?? 'Por asignar'}</p>
                {done.pending && <p className="mx-auto mt-2 max-w-md rounded-md bg-sky-500/10 px-3 py-2 text-xs text-sky-700 dark:text-sky-300">{online ? 'Sincronizando…' : 'Guardada en este dispositivo.'} El folio se asigna al sincronizar; el código y el QR ya son válidos.</p>}
                <p className="mt-3 text-sm text-muted-foreground">Código de consulta</p>
                <p className="font-mono text-3xl tracking-widest">{done.code}</p>
              </div>
              {o && user && (
                <div className="grid gap-4 sm:grid-cols-2">
                  <TicketView ref={ticketRef} order={o} tenant={user.tenant} trackUrl={trackUrl} />
                  <div className="space-y-3">
                    <p className="text-sm font-medium">Enviar el ticket con precios al cliente</p>
                    <TicketActions order={o} tenant={user.tenant} trackUrl={trackUrl} ticketEl={() => ticketRef.current} />
                    {done.pending && <p className="text-xs text-muted-foreground">Sin conexión el precio es una estimación; el servidor confirma el total al sincronizar.</p>}
                  </div>
                </div>
              )}
              <div className="flex flex-col gap-2 sm:flex-row">
                <Link href={`/orders/detail?id=${done.id}`} className={cn(buttonClass('default'), 'flex-1')}>Abrir orden y tomar fotos</Link>
                <Button variant="outline" className="flex-1" onClick={reset}>Nueva orden</Button>
              </div>
            </div>
          </Modal>
        );
      })()}
    </div>
  );
}

/** Precio unitario del renglón: editable (solo con permiso) antes de cobrar; el del catálogo no cambia. */
function PriceField({ price, base, cur, canEdit, onChange, onReset }: { price: number; base: number; cur?: string; canEdit: boolean; onChange: (n: number) => void; onReset: () => void }) {
  if (!canEdit) return <span className="text-xs text-muted-foreground">{money(price, cur)} c/u</span>;
  const edited = Math.abs(price - base) > 0.001;
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <input type="number" min="0" step="0.01" inputMode="decimal" aria-label="Precio unitario" value={Number.isFinite(price) ? price : ''} onChange={(e) => onChange(Math.max(Number(e.target.value) || 0, 0))} className={cn('h-7 w-20 rounded border bg-background px-1 text-right text-xs', edited && 'border-amber-500')} />
      {edited ? <button type="button" onClick={onReset} className="text-amber-600 underline" title={`Precio de catálogo ${money(base, cur)}`}>restablecer</button> : <span>c/u</span>}
    </span>
  );
}
