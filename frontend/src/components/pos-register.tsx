'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { QRCodeSVG } from 'qrcode.react';
import { Banknote, Camera, ChevronDown, CreditCard, Landmark, Mic, Minus, Plus, Search, Trash2, X, Clock, Car, UserRound } from 'lucide-react';
import { api } from '@/lib/api';
import { useOnline } from '@/lib/net';
import { getDb } from '@/lib/offline/db';
import { addPhotoOffline, createOrderOffline, discardOp, waitForOp } from '@/lib/offline/sync';
import { compressImage } from '@/lib/api';
import { scanRear } from '@/lib/vehicle-scan';
import { VoiceFill, type FillField } from '@/components/voice-fill';
import { useAuth } from '@/lib/auth';
import { cn, money } from '@/lib/utils';
import { Button, ErrorText, Input, Label, Select, Textarea, buttonClass } from '@/components/ui';
import { Combobox } from '@/components/combobox';
import { VoiceFab, VoiceMode, type VoiceDraft } from '@/components/voice-mode';
import { ClientSuggest, SelectedClientNote } from '@/components/client-suggest';
import { TipField, sendTip } from '@/components/tips';
import { CarArt, ProductArt } from '@/components/car-art';
import { ColorField, VehicleField, joinVehicle, splitVehicle } from '@/components/vehicle-field';
import { GlassPage } from '@/components/glass';
import { Portal } from '@/components/portal';
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

/** Sección agrupada tipo iOS dentro de la ventana. */
const Group = ({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) => (
  <section>
    <div className="mb-1.5 flex items-center justify-between px-1"><p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>{right}</div>
    <div className="rounded-3xl border border-black/5 bg-white/75 p-3 shadow-sm dark:border-white/10 dark:bg-white/5">{children}</div>
  </section>
);
const SWATCH: Record<string, string> = { Blanco: '#ffffff', Negro: '#111827', Gris: '#8b9099', Plata: '#c7ccd4', Rojo: '#dc2626', Azul: '#2563eb', Verde: '#16a34a', Vino: '#7f1d1d' };

/** Ventana de la venta: vidrio, se dibuja en <body> (por encima de las barras) y en celular sube desde abajo. */
function Modal({ title, onClose, children, footer }: { title: string; onClose?: () => void; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <Portal>
      <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/30 p-0 backdrop-blur-sm sm:items-center sm:p-4 print:hidden">
        <div className="flex max-h-[94dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-3xl border border-white/60 bg-card/90 shadow-2xl backdrop-blur-2xl sm:rounded-3xl dark:border-white/10">
          <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-black/15 sm:hidden dark:bg-white/20" />
          <div className="flex items-center justify-between border-b border-black/5 px-4 py-3">
            <h2 className="font-semibold">{title}</h2>
            {onClose && <Button variant="ghost" size="icon" onClick={onClose} aria-label="Cerrar"><X className="h-4 w-4" /></Button>}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">{children}</div>
          {footer && <div className="shrink-0 border-t border-black/5 bg-white/80 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur-xl dark:border-white/10 dark:bg-slate-900/80">{footer}</div>}
        </div>
      </div>
    </Portal>
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
  const [tip, setTip] = useState('');
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(emptyV);
  const vRef = useRef(v);
  vRef.current = v;
  const [c, setC] = useState(emptyC);
  const [clientId, setClientId] = useState<string | undefined>();
  const clients = useClientIndex();
  const picked = clients.find((x) => x.id === clientId);
  const [showClient, setShowClient] = useState(false);
  /** Cómo se identifica la orden: por placa o por el nombre del cliente (se recuerda la última elección). */
  const [idMode, setIdMode] = useState<'plate' | 'name'>(() => { try { return localStorage.getItem('al_pos_id_mode') === 'name' ? 'name' : 'plate'; } catch { return 'plate'; } });
  const changeMode = (m: 'plate' | 'name') => { setIdMode(m); try { localStorage.setItem('al_pos_id_mode', m); } catch { /* sin storage */ } };
  /** Campo único «Vehículo» (marca y modelo juntos). Se sincroniza cuando otro lado llena marca/modelo (foto, voz, cliente). */
  const [vehText, setVehText] = useState('');
  const vehEditing = useRef(false);
  const [notes, setNotes] = useState('');
  const [washer, setWasher] = useState('');
  const [method, setMethod] = useState(cashMode ? 'CASH' : 'LATER'); // Nueva orden: «Cobrar después» por defecto
  const [ocrMsg, setOcrMsg] = useState('');
  const [ocrBusy, setOcrBusy] = useState(false);
  /** Foto trasera: se usa para detectar placa/marca/modelo/color y se guarda en la orden como foto «Trasera». */
  const [rear, setRear] = useState<{ blob: Blob; url: string } | null>(null);
  const [scanFound, setScanFound] = useState<string[]>([]);
  /** Campos que la foto no pudo leer: se piden por voz (micrófono automático). */
  const [voiceFill, setVoiceFill] = useState<{ k: number; missing: FillField[] } | null>(null);
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
    /** null = venta sin vehículo */
    vehicle: { plate: string; brand: string; model: string; color: string } | null;
    client: { id?: string; name?: string; phone?: string; email?: string; contactPreference?: string };
    notes?: string;
    items: { id: string; qty: number }[];
    discount: number;
    washerId?: string;
    method: string;
    tip?: number;
  }, opts: { silent?: boolean } = {}) {
    const washerName = washers.data?.find((w) => w.id === p.washerId)?.fullName;
    const { id, code, opId } = await createOrderOffline({
      vehicle: p.vehicle ? { ...p.vehicle, plate: p.vehicle.plate.trim() } : null,
      client: p.client,
      notes: p.notes || undefined,
      items: p.items.map((i) => { const s = all.find((x) => x.id === i.id)!; const price = ov[s.id] !== undefined ? ov[s.id] : Number(s.price); return { serviceId: s.id, name: s.name, price, quantity: i.qty, priceEdited: price !== Number(s.price) }; }),
      discount: p.discount,
      taxRate,
      assignedToId: p.washerId || undefined,
      assignedToName: washerName,
      payment: p.method === 'LATER' ? null : { method: p.method },
    });
    // la foto trasera queda en la orden (se sube sola; también sin conexión)
    if (rear && !opts.silent) await addPhotoOffline(id, 'REAR', rear.blob).catch(() => undefined);
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
    // Propina: se registra en la caja abierta (requiere conexión y orden ya sincronizada)
    let tipNote: string | null = null;
    const tipAmount = p.method === 'LATER' ? 0 : p.tip ?? 0;
    if (tipAmount > 0) {
      tipNote = r.state === 'synced' ? await sendTip({ amount: tipAmount, method: p.method, orderId: id, washerId: p.washerId || undefined }) : 'La orden aún no se sincroniza: registra la propina en Caja > Propinas.';
      if (!tipNote) qc.invalidateQueries({ queryKey: ['cash'] });
    }
    if (!opts.silent) {
      setOpen(false);
      setVoiceOpen(false);
      setDone({ id, code, folio: server?.folio ?? null, pending: r.state !== 'synced', order, tip: tipAmount > 0 ? { amount: tipAmount, error: tipNote } : null });
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
        vehicle: needVehicle && v.plate.trim().length >= 3 ? (vehEditing.current ? { ...v, ...(({ brand, model }) => ({ brand, model }))(splitVehicle(vehText, catalog.data ?? [])) } : v) : null,
        client: { id: clientId, name: c.name || undefined, phone: c.phone || undefined, email: c.email || undefined, contactPreference: c.contactPreference },
        notes,
        items: lines.map((l) => ({ id: l.id, qty: qty[l.id] })),
        discount: disc,
        washerId: washer,
        method,
        tip: Number(tip) || 0,
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
      // sin placa y con servicios que no la piden = venta sin vehículo
      vehicle: d.plate.trim().length >= 3 ? { plate: d.plate, brand: d.brand, model: d.model, color: d.color } : null,
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
    setDone(null); setV(emptyV); setC(emptyC); setClientId(undefined); setOv({}); setTip(''); setQty({}); setNotes(''); setDiscount('');
    setMethod(cashMode ? 'CASH' : 'LATER'); setWasher(''); setOcrMsg(''); setScanFound([]); setVoiceFill(null); setRear((old) => { if (old) URL.revokeObjectURL(old.url); return null; }); setShowClient(false); setSaveError('');
  }

  /** Foto trasera: detecta en el dispositivo la placa, marca/modelo (emblemas) y color; solo rellena lo que esté vacío. */
  async function runOcr(file: File) {
    setOcrBusy(true); setScanFound([]);
    setOcrMsg('Analizando la foto trasera…');
    try {
      const blob = await compressImage(file);
      setRear((old) => { if (old) URL.revokeObjectURL(old.url); return { blob, url: URL.createObjectURL(blob) }; });
      const r = await scanRear(blob, catalog.data ?? []);
      if (typeof console !== 'undefined') console.debug('[foto trasera] leído:', r.words.join(' '));
      const cur = vRef.current;
      const n = { ...cur };
      const found: string[] = [];
      if (r.plate && !cur.plate.trim()) { n.plate = r.plate; found.push(`placa ${r.plate}`); }
      if (r.brand && !cur.brand.trim()) { n.brand = r.brand; found.push(r.brand); }
      if (r.model && !cur.model.trim()) { n.model = r.model; found.push(r.model); }
      if (r.color && !cur.color.trim()) { n.color = r.color; found.push(`color ${r.color}`); }
      setV(n);
      // placa ya registrada: trae su vehículo y cliente (sin pisar lo detectado)
      const hit = n.plate ? findByPlate(clients, n.plate) : undefined;
      if (hit && !clientId && !c.name && !c.phone) pickClient({ ...hit.client, vehicles: [] });
      setScanFound(found);
      const still = ([!n.plate.trim() && 'placa', !n.brand.trim() && 'marca', !n.model.trim() && 'modelo'].filter(Boolean)) as FillField[]; // el color es opcional: no se pregunta
      setVoiceFill(still.length ? { k: Date.now(), missing: still } : null);
      const missing = [!r.plate && 'placa', !r.brand && 'marca', !r.model && 'modelo', !r.color && 'color'].filter(Boolean);
      setOcrMsg(r.ocrError ?? (found.length ? `Detectado: ${found.join(' · ')}.${missing.length ? ` No se leyó: ${missing.join(', ')}.` : ''} Verifícalo.` : 'No se pudo leer la foto. Captura los datos a mano.'));
    } catch {
      setOcrMsg('No se pudo analizar la foto. Captura los datos a mano.');
    } finally {
      setOcrBusy(false);
      if (fileRef.current) fileRef.current.value = '';
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

  useEffect(() => { if (!vehEditing.current) setVehText(joinVehicle(v.brand, v.model)); }, [v.brand, v.model]);

  /** ¿Algún servicio elegido pide vehículo? Si ninguno (productos, lavado de tapetes…), se vende solo con nombre y teléfono. */
  const needVehicle = lines.length === 0 || lines.some((l) => l.requiresVehicle !== false);
  // basta la placa o el nombre del cliente; marca, modelo y color son opcionales
  const validVehicle = !needVehicle || v.plate.trim().length >= 3 || c.name.trim().length >= 2;

  const Root: any = cashMode ? 'div' : GlassPage;
  const missing = validVehicle ? [] : [idMode === 'plate' ? 'la placa (o cambia a «Nombre»)' : 'el nombre del cliente (o cambia a «Placa»)'];
  const clientFields = (
    <>
      <div><Label className="text-xs">Nombre</Label><Input aria-label="Nombre" value={c.name} autoComplete="off" onChange={(e) => { setClientId(undefined); setC({ ...c, name: e.target.value }); }} className="rounded-2xl" /><ClientSuggest clients={clients} query={c.name} selectedId={clientId} onPick={pickClient} /></div>
      <div><Label className="text-xs">Teléfono</Label><Input aria-label="Teléfono" type="tel" inputMode="tel" autoComplete="off" value={c.phone} onChange={(e) => { setClientId(undefined); setC({ ...c, phone: e.target.value }); }} placeholder="10 dígitos" className="rounded-2xl" /><ClientSuggest clients={clients} query={c.phone} selectedId={clientId} onPick={pickClient} /></div>
    </>
  );
  const moreFields = (
    <>
      <div><Label className="text-xs">Correo</Label><Input type="email" value={c.email} onChange={(e) => setC({ ...c, email: e.target.value })} className="rounded-2xl" /></div>
      <div><Label className="text-xs">Avisarle por</Label>
        <Select value={c.contactPreference} onChange={(e) => setC({ ...c, contactPreference: e.target.value })} className="rounded-2xl">
          <option value="NONE">Ninguno</option><option value="WHATSAPP">WhatsApp</option><option value="EMAIL">Correo</option>
        </Select>
      </div>
      <div className="sm:col-span-2"><Label className="text-xs">Observaciones</Label><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Rayones, objetos de valor, etc." className="rounded-2xl" /></div>
    </>
  );
  /** Venta de productos/servicios que no piden vehículo: solo cliente (opcional). */
  const clientGroup = (
    <Group title="Cliente" right={<span className="text-[11px] font-medium text-violet-600">Venta sin vehículo</span>}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2"><SelectedClientNote client={picked} onClear={() => setClientId(undefined)} /></div>
        {clientFields}
        {moreFields}
      </div>
    </Group>
  );
  /** Placa (+ foto trasera), vehículo en un solo campo y color: todo opcional salvo la placa cuando se identifica por placa. */
  const plateBlock = (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input aria-label="Placa" autoFocus={idMode === 'plate' && typeof window !== 'undefined' && window.innerWidth >= 640} value={v.plate} onChange={(e) => onPlate(e.target.value.toUpperCase())} placeholder="ABC123" className="h-14 min-w-0 flex-1 rounded-2xl text-center font-mono text-2xl uppercase tracking-[0.2em]" />
        <button type="button" onClick={() => fileRef.current?.click()} disabled={ocrBusy} aria-label="Tomar foto trasera"
          className="relative grid h-14 w-14 shrink-0 place-items-center overflow-hidden rounded-2xl bg-primary text-primary-foreground shadow transition active:scale-95 disabled:opacity-60">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {rear && <img src={rear.url} alt="Foto trasera" className="absolute inset-0 h-full w-full object-cover opacity-70" />}
          {ocrBusy ? <span className="relative h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Camera className="relative h-6 w-6 drop-shadow" />}
        </button>
        <input ref={fileRef} type="file" accept="image/*" capture="environment" hidden onChange={(e) => e.target.files?.[0] && runOcr(e.target.files[0])} />
      </div>
      <p className="text-xs text-muted-foreground" data-testid="scan-msg">{ocrMsg || 'Con la cámara tomas la foto trasera: detecta placa, vehículo y color.'}</p>
      {voiceFill && (
        <VoiceFill key={voiceFill.k} missing={voiceFill.missing} catalog={catalog.data ?? []} onClose={() => setVoiceFill(null)}
          onFill={(f) => setV((p) => ({ ...p, ...(f.plate && !p.plate.trim() ? { plate: f.plate } : {}), ...(f.brand && !p.brand.trim() ? { brand: f.brand } : {}), ...(f.model && !p.model.trim() ? { model: f.model } : {}), ...(f.color && !p.color.trim() ? { color: f.color } : {}) }))} />
      )}
      {scanFound.length > 0 && <div className="flex flex-wrap gap-1.5">{scanFound.map((f) => <span key={f} className="rounded-full bg-emerald-500/15 px-2.5 py-1 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">✓ {f}</span>)}</div>}
      <div>
        <Label className="text-xs">Vehículo <span className="font-normal text-muted-foreground">(opcional)</span></Label>
        <VehicleField value={vehText} catalog={catalog.data ?? []}
          onChange={(text) => { vehEditing.current = true; setVehText(text); }}
          onCommit={(pv) => { vehEditing.current = false; setV((p) => ({ ...p, brand: pv.brand, model: pv.model, color: p.color || pv.color })); }} />
      </div>
      <div>
        <Label className="text-xs">Color <span className="font-normal text-muted-foreground">(opcional)</span></Label>
        <ColorField value={v.color} onChange={(col) => setV((p) => ({ ...p, color: col }))} />
      </div>
    </div>
  );
  const nameBlock = (
    <div className="space-y-2">
      <div>
        <Input aria-label="Nombre del cliente" autoFocus={idMode === 'name' && typeof window !== 'undefined' && window.innerWidth >= 640} value={c.name} autoComplete="off" placeholder="Nombre del cliente"
          onChange={(e) => { setClientId(undefined); setC({ ...c, name: e.target.value }); }} className="h-14 rounded-2xl text-center text-xl font-semibold" />
        <ClientSuggest clients={clients} query={c.name} selectedId={clientId} onPick={pickClient} />
      </div>
      <div>
        <Input aria-label="Teléfono" type="tel" inputMode="tel" autoComplete="off" value={c.phone} placeholder="Teléfono (opcional, para avisarle)" onChange={(e) => { setClientId(undefined); setC({ ...c, phone: e.target.value }); }} className="rounded-2xl" />
        <ClientSuggest clients={clients} query={c.phone} selectedId={clientId} onPick={pickClient} />
      </div>
      <SelectedClientNote client={picked} onClear={() => setClientId(undefined)} />
    </div>
  );
  /** Identificador de la orden: el empleado elige Placa o Nombre (basta uno). */
  const idGroup = (
    <Group title="Identificar la orden" right={picked ? <span className="text-[11px] font-medium text-emerald-600">Cliente registrado</span> : undefined}>
      <div className="space-y-3">
        <div role="radiogroup" aria-label="Identificar por" className="grid grid-cols-2 gap-1 rounded-2xl bg-black/5 p-1 dark:bg-white/10">
          {([['plate', 'Placa', Car], ['name', 'Nombre', UserRound]] as const).map(([k, label, Icon]) => (
            <button key={k} type="button" role="radio" aria-checked={idMode === k} onClick={() => changeMode(k)}
              className={cn('flex h-10 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition active:scale-95', idMode === k ? 'bg-white text-foreground shadow-sm dark:bg-white/20' : 'text-muted-foreground')}>
              <Icon className="h-4 w-4" />{label}
            </button>
          ))}
        </div>
        {idMode === 'plate' ? plateBlock : nameBlock}
      </div>
    </Group>
  );
  const extraSummary = idMode === 'plate' ? [c.name, c.phone].filter(Boolean).join(' · ') : [v.plate, joinVehicle(v.brand, v.model), v.color].filter(Boolean).join(' · ');
  /** Lo que no se usó para identificar la orden, plegado: cliente (si fue por placa) o vehículo (si fue por nombre). */
  const extraGroup = (
    <Group title={idMode === 'plate' ? 'Cliente y observaciones' : 'Vehículo y observaciones'}
      right={<button type="button" onClick={() => setShowClient(!showClient)} className="flex items-center gap-1 text-xs font-medium text-primary">{showClient ? 'Ocultar' : 'Agregar'}<ChevronDown className={cn('h-4 w-4 transition', showClient && 'rotate-180')} /></button>}>
      {!showClient ? (
        <button type="button" onClick={() => setShowClient(true)} className="w-full text-left text-sm text-muted-foreground" data-testid="extra-summary">
          {extraSummary || (idMode === 'plate' ? 'Opcional: nombre, teléfono para avisarle, notas' : 'Opcional: placa, vehículo, color, notas')}
        </button>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {idMode === 'plate' ? (
            <>
              <div className="sm:col-span-2"><SelectedClientNote client={picked} onClear={() => setClientId(undefined)} /></div>
              {clientFields}
            </>
          ) : <div className="sm:col-span-2">{plateBlock}</div>}
          {moreFields}
        </div>
      )}
    </Group>
  );  const checkoutForm = (
    <form id="checkout-form" className="space-y-4 p-4" onSubmit={(e) => { e.preventDefault(); if (validVehicle) void submitOrder(); }}>
      <Group title="Servicios">
        <div className="divide-y divide-black/5 dark:divide-white/10">
          {lines.map((l) => (
            <div key={l.id} className="flex items-center gap-3 py-2 first:pt-0 last:pb-0">
              {l.requiresVehicle === false ? <ProductArt name={l.name} className="h-11 w-14 shrink-0 rounded-xl" /> : <CarArt name={l.name} className="h-11 w-14 shrink-0 rounded-xl" />}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold">{l.name}</p>
                <p className="truncate text-xs text-muted-foreground">{l.description || 'Sin descripción'}</p>
              </div>
              <div className="flex shrink-0 items-center rounded-full bg-black/5 p-0.5 dark:bg-white/10">
                <button type="button" aria-label={qty[l.id] > 1 ? `Menos ${l.name}` : `Quitar ${l.name}`} onClick={() => (qty[l.id] > 1 ? add(l.id, -1) : removeLine(l.id))} className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm active:scale-90 dark:bg-white/15">
                  {qty[l.id] > 1 ? <Minus className="h-3.5 w-3.5" /> : <Trash2 className="h-3.5 w-3.5 text-red-500" />}
                </button>
                <span className="w-7 text-center text-sm font-semibold tabular-nums">{qty[l.id]}</span>
                <button type="button" aria-label={`Más ${l.name}`} onClick={() => add(l.id)} className="grid h-8 w-8 place-items-center rounded-full bg-white shadow-sm active:scale-90 dark:bg-white/15"><Plus className="h-3.5 w-3.5" /></button>
              </div>
            </div>
          ))}
        </div>
        {all.some((s) => !(qty[s.id] > 0)) && (
          <div className="-mx-3 mt-3 flex gap-2 overflow-x-auto px-3 [scrollbar-width:none]" aria-label="Agregar otro servicio">
            {all.filter((s) => !(qty[s.id] > 0)).map((s) => (
              <button key={s.id} type="button" onClick={() => add(s.id)} className="shrink-0 rounded-full bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary active:scale-95">+ {s.name} · {money(s.price, cur)}</button>
            ))}
          </div>
        )}
      </Group>

      {needVehicle ? idGroup : clientGroup}

      <Group title="Cobro">
        <div className="space-y-3">
          <div className={cn('grid gap-1.5', cashMode ? 'grid-cols-3' : 'grid-cols-4')} role="radiogroup" aria-label="Método de pago">
            {PAY_OPTIONS.filter((p) => !cashMode || p.value !== 'LATER').map((p) => (
              <button key={p.value} type="button" role="radio" aria-checked={method === p.value} onClick={() => setMethod(p.value)}
                className={cn('flex h-14 flex-col items-center justify-center gap-0.5 rounded-2xl text-[11px] font-medium leading-tight transition active:scale-95', method === p.value ? 'bg-primary text-primary-foreground shadow' : 'bg-black/5 text-foreground dark:bg-white/10')}>
                <p.icon className="h-5 w-5 shrink-0" /><span className="max-w-full truncate px-1">{p.value === 'LATER' ? 'Después' : p.label}</span>
              </button>
            ))}
          </div>
          {can('cash:tips') && method !== 'LATER' && <TipField base={total} value={tip} onChange={setTip} cur={cur} />}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Lavador</Label>
              <Select value={washer} onChange={(e) => setWasher(e.target.value)} aria-label="Lavador asignado" className="rounded-2xl">
                <option value="">Sin asignar</option>
                {washers.data?.filter((w) => w.isActive).map((w) => <option key={w.id} value={w.id}>{w.fullName}</option>)}
              </Select>
            </div>
            <div>
              <Label className="text-xs">Descuento</Label>
              <Input type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" aria-label="Descuento" value={discount} onChange={(e) => setDiscount(e.target.value)} className="rounded-2xl text-right" />
            </div>
          </div>
        </div>
      </Group>

      {needVehicle && extraGroup}

      <Group title="Resumen">
        <div className="space-y-1.5 text-sm">
          {lines.map((l) => <div key={l.id} className="flex items-center justify-between gap-2"><span className="min-w-0 flex-1 truncate">{qty[l.id]} × {l.name}</span><PriceField price={Number(l.price)} base={l.base} cur={cur} canEdit={canPrice} onChange={(n) => setOv((o) => ({ ...o, [l.id]: n }))} onReset={() => setOv(({ [l.id]: _, ...r }) => r)} /><span className="w-20 text-right tabular-nums">{money(Number(l.price) * qty[l.id], cur)}</span></div>)}
          <div className="flex justify-between border-t border-black/5 pt-1.5 text-muted-foreground dark:border-white/10"><span>Subtotal</span><span className="tabular-nums">{money(subtotal, cur)}</span></div>
          {disc > 0 && <div className="flex justify-between text-muted-foreground"><span>Descuento</span><span className="tabular-nums">-{money(disc, cur)}</span></div>}
          <div className="flex justify-between text-muted-foreground"><span>IVA ({taxRate}%)</span><span className="tabular-nums">{money(tax, cur)}</span></div>
        </div>
      </Group>
      <ErrorText error={saveError ? new Error(saveError) : undefined} />
    </form>
  );
  const checkoutFooter = (
    <div className="space-y-2">
      {!validVehicle && <p className="text-center text-xs text-muted-foreground">Falta: {missing.join(', ')}</p>}
      <div className="flex items-center gap-3">
        <div className="min-w-0">
          <p className="text-[11px] text-muted-foreground">{count} {count === 1 ? 'servicio' : 'servicios'}</p>
          <p className="text-xl font-bold tabular-nums">{money(total, cur)}</p>
        </div>
        <Button form="checkout-form" type="submit" size="lg" className="h-12 flex-1 rounded-2xl text-base" disabled={!validVehicle || saving}>
          {saving ? 'Guardando…' : method === 'LATER' ? 'Crear orden' : 'Confirmar pago'}
        </Button>
      </div>
    </div>
  );
  return (
    <Root className={cashMode ? '' : 'px-0 pb-0 pt-0 md:px-0 md:pb-0 md:pt-0'}>
      <div className={cn('grid', cashMode ? 'lg:grid-cols-[1fr_380px]' : 'min-h-[calc(100vh-3.5rem)] md:min-h-screen')}>
        {/* Productos */}
        <section className={cashMode ? 'min-w-0 pb-32 pt-1 lg:pb-6' : 'p-4 pb-24 md:p-6'}>
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
                  'relative flex min-h-[130px] flex-col rounded-lg border bg-card p-3 text-left shadow-sm transition active:scale-[0.98] hover:border-primary',
                  'rounded-2xl border-white/60 bg-white/60 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06]',
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
                {s.requiresVehicle === false ? <ProductArt name={s.name} className="mt-2 h-10 w-14 shrink-0 rounded" /> : <CarArt name={s.name} className="mt-2 h-10 w-14 shrink-0 rounded" />}
                <p className="mt-auto pt-2 text-sm font-semibold">{money(s.price, cur)}</p>
              </button>
            ))}
          </div>
        </section>

        {/* Resumen lateral: solo en la caja. En Nueva orden el servicio abre directo la ventana de pago */}
        {cashMode && (
        <aside className="fixed inset-x-0 bottom-14 z-30 border-t bg-card/80 backdrop-blur-xl lg:static lg:bottom-auto lg:flex lg:flex-col lg:border-l lg:border-t-0">
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
            <Button size="lg" className="w-full" disabled={count === 0 || saving} onClick={() => setOpen(true)}>{cashMode ? 'Cobrar' : 'Pagar'}</Button>
          </div>
        </aside>
        )}
      </div>

      {/* Ventana de datos y pago (en la caja el formulario va en la misma pantalla) */}
      {open && (
        <Modal title={`${cashMode ? 'Cobrar' : 'Pagar'} · ${money(total, cur)}`} onClose={() => setOpen(false)} footer={checkoutFooter}>
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
          <Modal title={cashMode ? 'Venta registrada' : 'Orden creada'} onClose={reset}>
            <div className="space-y-4 p-4 sm:p-6">
              <Button size="lg" className="h-14 w-full rounded-2xl text-lg shadow-lg" onClick={reset}><Plus className="h-5 w-5" />{cashMode ? 'Nueva venta' : 'Nueva orden'}</Button>
              <div className="text-center">
                <p className="text-sm text-muted-foreground">Folio</p>
                <p className="text-3xl font-semibold">{o?.folio ?? done.folio ?? 'Por asignar'}</p>
              {done.tip && (done.tip.error
                ? <p className="mx-auto mt-2 max-w-md rounded-md bg-amber-500/15 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">Propina de {money(done.tip.amount, cur)} sin registrar: {done.tip.error}</p>
                : <p className="mx-auto mt-2 max-w-md rounded-md bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300">Propina registrada: {money(done.tip.amount, cur)}</p>)}
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
                <Link href={`/orders/detail?id=${done.id}`} className={cn(buttonClass('outline'), 'flex-1 rounded-2xl')}>Abrir orden y tomar fotos</Link>
              </div>
            </div>
          </Modal>
        );
      })()}
    </Root>
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
