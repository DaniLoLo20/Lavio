'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, Mic, MicOff, Minus, Plus, Settings, Volume2, VolumeX, X } from 'lucide-react';
import { cn, money } from '@/lib/utils';
import { createListener, cancelSpeech, speak, speechSupported, type ListenFail } from '@/lib/voice/speech';
import { COLORS, detectCommand, detectSummaryCommand, matchBrand, matchCatalogValue, parseName, parseNotes, parsePhone, parsePlate, parseServices, parseVehicle } from '@/lib/voice/parsers';
import { saveVoiceSettings, speechOpts, useVoiceSettings } from '@/lib/voice/settings';
import { Button, ErrorText, Input, Label, Select, Textarea } from './ui';
import { Combobox } from './combobox';
import { DraggableFab } from './draggable-fab';
import { VoiceSettingsForm } from './voice-settings';
import { ClientSuggest } from './client-suggest';
import { DictationMode } from './voice-dictation';
import { GlassBlobs } from './glass';
import { Portal } from './portal';
import { findByExactName, findByPhone, findByPlate, searchClients, type ClientLite } from '@/lib/clients';

export interface VoiceDraft {
  plate: string; brand: string; model: string; color: string;
  name: string; phone: string; notes: string;
  /** Cliente ya registrado (autocompletado): la orden se liga a él en vez de crear otro */
  clientId?: string;
  items: Record<string, number>;
  method: string;
}
export const emptyDraft: VoiceDraft = { plate: '', brand: '', model: '', color: '', name: '', phone: '', notes: '', items: {}, method: 'LATER' };

const STEPS = [
  { key: 'service', title: 'Servicio', prompt: '¿Qué servicio desea?', example: 'Di: "lavado básico y aspirado"', optional: false },
  { key: 'plate', title: 'Placa', prompt: '¿Cuál es la placa del vehículo?', example: 'Di: "A B C uno dos tres"', optional: false },
  { key: 'vehicle', title: 'Vehículo', prompt: 'Dime la marca, el modelo y el color del vehículo.', example: 'Di: "Nissan Versa gris" o "Volkswagen Vento rojo"', optional: false },
  { key: 'name', title: 'Nombre', prompt: '¿Cómo se llama el cliente?', example: 'Di el nombre, o "saltar"', optional: true },
  { key: 'phone', title: 'Teléfono', prompt: '¿Cuál es su teléfono?', example: 'Di los diez dígitos, o "saltar"', optional: true },
  { key: 'notes', title: 'Observaciones', prompt: '¿Alguna observación del vehículo?', example: 'Di "ninguna" si no hay', optional: true },
] as const;
const SUMMARY = STEPS.length;

const PAY: [string, string][] = [['CASH', 'Efectivo'], ['CARD', 'Tarjeta'], ['TRANSFER', 'Transferencia'], ['LATER', 'Cobrar después']];
const PAY_SPOKEN: Record<string, string> = { CASH: 'en efectivo', CARD: 'con tarjeta', TRANSFER: 'por transferencia', LATER: 'se cobra después' };

type Svc = { id: string; name: string; price: number | string; requiresVehicle?: boolean };
interface Props {
  open: boolean;
  onClose: () => void;
  services: Svc[];
  /** Clientes registrados, para reconocer por placa, nombre o teléfono */
  clients?: ClientLite[];
  catalog?: { brand: string; models: string[] }[];
  taxRate: number;
  currency?: string;
  online: boolean;
  /** false en el modo caja: toda venta se cobra al momento */
  allowLater?: boolean;
  defaultMethod?: string;
  /** Cada respuesta llena el formulario del POS en tiempo real */
  onChange?: (d: VoiceDraft) => void;
  onSave: (d: VoiceDraft, o?: { silent?: boolean }) => Promise<void>;
  onOpenInForm: (d: VoiceDraft) => void;
}

const FAIL: Record<ListenFail, (online: boolean) => string | null> = {
  'no-speech': () => 'No te escuché. Toca el micrófono para intentar de nuevo, o escribe la respuesta.',
  denied: () => 'El navegador bloqueó el micrófono. Permite el acceso o escribe la respuesta.',
  network: (online) =>
    online
      ? 'El servicio de voz del navegador no respondió. Intenta de nuevo o escribe la respuesta.'
      : 'Sin internet: el reconocimiento de voz de este navegador suele necesitar conexión. Escribe la respuesta; la orden se guardará igual en el dispositivo.',
  mic: () => 'No se detectó un micrófono.',
  aborted: () => null,
  unsupported: () => null,
  error: () => 'No pude usar el reconocimiento de voz. Escribe la respuesta.',
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const spell = (s: string) => s.split('').join(' ');
const listJoin = (a: string[]) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} y ${a[a.length - 1]}`);

/** Botón flotante "Activar Modo Voz". Se puede arrastrar a cualquier parte para que no estorbe (se recuerda dónde lo dejaste). */
export function VoiceFab({ onClick, ctx = 'global' }: { onClick: () => void; ctx?: 'pos' | 'global' }) {
  const defaultPos = useCallback((vw: number, vh: number, w: number, h: number) => {
    return vw >= 768 ? { x: vw - w - 24, y: vh - h - 24 } : { x: vw - w - 16, y: vh - h - 80 };
  }, [ctx]);
  return (
    <DraggableFab label="Activar Modo Voz" onActivate={onClick} defaultPos={defaultPos} className="flex h-14 items-center gap-2 rounded-full bg-primary px-4 text-primary-foreground shadow-lg shadow-primary/30">
      <Mic className="h-6 w-6" />
      <span className="hidden text-sm font-semibold sm:inline">Activar Modo Voz</span>
    </DraggableFab>
  );
}

function GuidedVoiceMode({ open, onClose, services, clients = [], catalog, taxRate, currency, online, allowLater = true, defaultMethod, onChange, onSave, onOpenInForm }: Props) {
  const settings = useVoiceSettings();
  const sRef = useRef(settings);
  sRef.current = settings;
  const supported = useMemo(() => speechSupported(), []);
  const listener = useRef(createListener()).current;
  const runId = useRef(0);
  const adv = useRef<ReturnType<typeof setTimeout> | null>(null);
  const followUps = useRef(0);
  /** Datos que ya vienen de un cliente reconocido: se omiten esas preguntas */
  const known = useRef({ vehicle: false, name: false, phone: false });

  const [idx, setIdx] = useState(0);
  const [draft, setDraft] = useState<VoiceDraft>(emptyDraft);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const [status, setStatus] = useState<'idle' | 'speaking' | 'listening'>('idle');
  const [heard, setHeard] = useState('');
  const [msg, setMsg] = useState<{ tone: 'error' | 'info'; text: string } | null>(null);
  const [ambiguous, setAmbiguous] = useState<{ id: string; name: string }[]>([]);
  const [advancing, setAdvancing] = useState(false);
  const [nonce, setNonce] = useState(0);
  const [dictating, setDictating] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [showSettings, setShowSettings] = useState(false);

  const voice = () => speechOpts(sRef.current);
  const brands = (catalog ?? []).map((b) => b.brand);

  // totales y faltantes de un borrador
  /** Si ningún servicio elegido pide vehículo, se omiten placa y vehículo (venta solo con nombre/teléfono). */
  const needsVehicle = (d: VoiceDraft) => { const ids = Object.entries(d.items).filter(([, q]) => q > 0).map(([id]) => id); return !ids.length || ids.some((id) => services.find((s) => s.id === id)?.requiresVehicle !== false); };
  const calc = (d: VoiceDraft) => {
    const lines = services.filter((s) => (d.items[s.id] ?? 0) > 0);
    const subtotal = lines.reduce((s, l) => s + Number(l.price) * d.items[l.id], 0);
    const tax = (subtotal * taxRate) / 100;
    const total = Math.round((subtotal + tax) * 100) / 100;
    const missing: string[] = [];
    if (needsVehicle(d)) {
      if (d.plate.length < 3) missing.push('la placa');
      if (!d.brand.trim()) missing.push('la marca');
      if (!d.model.trim()) missing.push('el modelo');
      if (!d.color.trim()) missing.push('el color');
    }
    if (!lines.length) missing.push('el servicio');
    return { lines, subtotal, tax, total, missing };
  };

  /** Texto que se lee en voz alta como resumen. */
  const summaryText = (d: VoiceDraft) => {
    const c = calc(d);
    const cur = !currency || currency === 'MXN' ? 'pesos' : currency;
    const whole = Math.floor(c.total), cents = Math.round((c.total - whole) * 100);
    const p = ['Resumen de la orden.', `Placa ${spell(d.plate)}.`, `Vehículo: ${[d.brand, d.model, d.color].filter(Boolean).join(' ') || 'sin datos'}.`];
    if (d.name) p.push(`Cliente ${d.name}${d.clientId ? ', ya registrado' : ''}.`);
    if (d.phone) p.push(`Teléfono ${spell(d.phone)}.`);
    if (d.notes) p.push(`Observaciones: ${d.notes}.`);
    p.push(`Servicios: ${c.lines.map((l) => `${d.items[l.id]} ${l.name}`).join(', ') || 'ninguno'}.`);
    p.push(`Total estimado ${whole} ${cur}${cents ? ` con ${cents} centavos` : ''}, ${PAY_SPOKEN[d.method] ?? ''}.`);
    p.push(c.missing.length ? `Falta ${listJoin(c.missing)}.` : '¿Guardo la orden? Di guardar, corregir o cancelar.');
    return p.join(' ');
  };

  useEffect(() => { try { localStorage.removeItem('al_voice_tts'); } catch { /* sin storage */ } }, []);

  // Reinicia al abrir
  useEffect(() => {
    if (open) {
      setDraft({ ...emptyDraft, method: defaultMethod ?? 'LATER' });
      setIdx(0); setMsg(null); setHeard(''); setAmbiguous([]); setSaveError(''); setNonce(0); setShowSettings(false);
      followUps.current = 0;
      known.current = { vehicle: false, name: false, phone: false };
    } else {
      runId.current++;
      listener.stop(); cancelSpeech();
    }
  }, [open, listener, defaultMethod]);

  // El formulario del POS se llena con cada respuesta
  const first = useRef(true);
  useEffect(() => { if (first.current) { first.current = false; return; } if (open) onChange?.(draft); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [draft]);

  const update = <K extends keyof VoiceDraft>(k: K, v: VoiceDraft[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const clearAdvance = () => { if (adv.current) clearTimeout(adv.current); adv.current = null; setAdvancing(false); };
  const stopAll = () => { runId.current++; clearAdvance(); listener.stop(); cancelSpeech(); setStatus('idle'); };
  const goTo = (n: number) => { stopAll(); followUps.current = 0; setMsg(null); setHeard(''); setAmbiguous([]); setIdx(n); };
  const goNext = (i: number) => {
    let n = i + 1;
    const k = known.current;
    const noVeh = !needsVehicle(draftRef.current);
    while (n < STEPS.length && (((STEPS[n].key === 'plate' || STEPS[n].key === 'vehicle') && noVeh) || (STEPS[n].key === 'vehicle' && k.vehicle) || (STEPS[n].key === 'name' && k.name) || (STEPS[n].key === 'phone' && k.phone))) n++;
    goTo(n >= STEPS.length ? SUMMARY : n);
  };

  /** Cliente registrado reconocido: rellena sus datos y evita volver a preguntarlos. */
  function applyClient(cl: ClientLite, vehicle?: ClientLite['vehicles'][number]) {
    setDraft((d) => ({ ...d, clientId: cl.id, name: cl.name ?? d.name, phone: cl.phone ?? d.phone, ...(vehicle ? { brand: vehicle.brand, model: vehicle.model, color: vehicle.color } : {}) }));
    known.current = { vehicle: known.current.vehicle || !!vehicle, name: !!cl.name, phone: !!cl.phone };
    const text = `Cliente registrado: ${cl.name || cl.phone}.`;
    setMsg({ tone: 'info', text });
    if (sRef.current.speakPrompts) void speak(vehicle ? `Reconocí el vehículo de ${cl.name || 'un cliente'}.` : text, voice());
  }
  const schedule = (i: number) => {
    clearAdvance();
    const ms = sRef.current.advanceSec * 1000;
    if (ms <= 0) return; // avance manual
    setAdvancing(true);
    adv.current = setTimeout(() => goNext(i), ms);
  };

  function addItems(items: { id: string; qty: number }[]) {
    setDraft((d) => {
      const next = { ...d.items };
      for (const it of items) next[it.id] = Math.min((next[it.id] ?? 0) + it.qty, 99);
      return { ...d, items: next };
    });
  }

  async function listenNow(i: number, my: number) {
    clearAdvance();
    setHeard(''); setMsg(null); setAmbiguous([]); setStatus('listening');
    const r = await listener.listen({ lang: sRef.current.lang, maxMs: sRef.current.listenSec * 1000, onInterim: (t) => { if (my === runId.current) setHeard(t); } });
    if (my !== runId.current) return;
    setStatus('idle');
    handleResult(i, r);
  }

  /** Repite una pregunta más específica (p. ej. "Me falta el color") y vuelve a escuchar. */
  async function followUp(i: number, text: string) {
    const my = ++runId.current;
    if (sRef.current.speakPrompts) { setStatus('speaking'); await speak(text, voice()); }
    if (my !== runId.current) return;
    await listenNow(i, my);
  }

  function handleResult(i: number, r: Awaited<ReturnType<typeof listener.listen>>) {
    if (!r.ok) { const m = FAIL[r.reason](online); setMsg(m ? { tone: 'error', text: m } : null); return; }
    const text = r.text;
    setHeard(text);
    const cmd = detectCommand(text);
    if (cmd === 'cancel') return onClose();
    if (cmd === 'repeat') return setNonce((n) => n + 1);
    if (cmd === 'back') return goTo(Math.max(0, i - 1));
    if (cmd === 'skip') return STEPS[i].optional ? goNext(i) : setMsg({ tone: 'error', text: 'Este dato es obligatorio.' });

    switch (STEPS[i].key) {
      case 'plate': {
        const p = parsePlate(text);
        known.current = { vehicle: false, name: false, phone: false };
        setDraft((d) => ({ ...d, plate: p.value, clientId: undefined }));
        if (p.valid) {
          const hit = findByPlate(clients, p.value);
          if (hit) applyClient(hit.client, hit.vehicle);
          schedule(i);
        } else setMsg({ tone: 'error', text: `No pude armar una placa válida${p.value ? ` (entendí "${p.value}")` : ''}. Repite o escríbela.` });
        break;
      }
      case 'vehicle': {
        // una sola frase: se clasifica en marca, modelo y color; lo que ya se tenía se conserva
        const v = parseVehicle(text, catalog ?? []);
        const cur = draftRef.current;
        const merged = { ...cur, brand: v.brand || cur.brand, model: v.model || cur.model, color: v.color || cur.color };
        setDraft(merged);
        const missing = [!merged.brand && 'la marca', !merged.model && 'el modelo', !merged.color && 'el color'].filter(Boolean) as string[];
        if (!missing.length) { schedule(i); break; }
        setMsg({ tone: 'info', text: `Entendí ${[merged.brand, merged.model, merged.color].filter(Boolean).join(' ') || 'poco'}. Me falta ${listJoin(missing)}.` });
        if (sRef.current.autoListen && supported && followUps.current < 2) {
          followUps.current++;
          void followUp(i, `Me falta ${listJoin(missing)}. Dímelo.`);
        }
        break;
      }
      case 'name': {
        const nm = parseName(text);
        const hit = findByExactName(clients, nm);
        if (hit) { applyClient(hit); schedule(i); break; }
        setDraft((d) => ({ ...d, name: nm, clientId: undefined }));
        const near = searchClients(clients, nm);
        if (near.length) setMsg({ tone: 'info', text: `Hay ${near.length} cliente(s) parecido(s). Elige uno de la lista para no crearlo de nuevo.` });
        schedule(i);
        break;
      }
      case 'phone': {
        const p = parsePhone(text);
        update('phone', p.value);
        if (p.valid) {
          const hit = findByPhone(clients, p.value);
          if (hit) applyClient(hit);
          schedule(i);
        } else setMsg({ tone: 'info', text: `Entendí ${p.value.length} dígitos y se necesitan 10. Repite o corrígelo.` });
        break;
      }
      case 'notes': update('notes', parseNotes(text)); schedule(i); break;
      case 'service': {
        const res = parseServices(text, services);
        if (res.items.length) { addItems(res.items); schedule(i); }
        else if (res.ambiguous.length) { setAmbiguous(res.ambiguous); setMsg({ tone: 'info', text: 'Eso se parece a varios servicios. Elige uno.' }); }
        else setMsg({ tone: 'error', text: 'No reconocí ese servicio. Elígelo de la lista o repite.' });
        break;
      }
    }
  }

  // Paso guiado: lee la pregunta (opcional), pausa configurable y empieza a escuchar
  useEffect(() => {
    if (!open || showSettings || idx >= STEPS.length) return;
    let alive = true;
    const my = ++runId.current;
    (async () => {
      const s = sRef.current;
      if (s.speakPrompts) { setStatus('speaking'); await speak(STEPS[idx].prompt, voice()); }
      if (!alive || my !== runId.current) return;
      if (s.pauseSec > 0) await sleep(s.pauseSec * 1000);
      if (!alive || my !== runId.current) return;
      if (!supported || !s.autoListen) { setStatus('idle'); return; }
      void listenNow(idx, my);
    })();
    return () => { alive = false; listener.stop(); cancelSpeech(); clearAdvance(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, idx, nonce, showSettings]);

  // Resumen: se lee en voz alta y se espera "guardar", "corregir" o "cancelar"
  useEffect(() => {
    if (!open || showSettings || idx !== SUMMARY) return;
    let alive = true;
    const my = ++runId.current;
    (async () => {
      const s = sRef.current;
      if (s.readSummary) { setStatus('speaking'); await speak(summaryText(draftRef.current), voice()); }
      if (!alive || my !== runId.current) return;
      if (!supported || !s.voiceSave || !s.autoListen) { setStatus('idle'); return; }
      void summaryListen(my);
    })();
    return () => { alive = false; listener.stop(); cancelSpeech(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, idx, nonce, showSettings]);

  async function summaryListen(my: number) {
    setHeard(''); setMsg(null); setStatus('listening');
    const r = await listener.listen({ lang: sRef.current.lang, maxMs: sRef.current.listenSec * 1000, onInterim: (t) => { if (my === runId.current) setHeard(t); } });
    if (my !== runId.current) return;
    setStatus('idle');
    handleSummary(r);
  }

  function handleSummary(r: Awaited<ReturnType<typeof listener.listen>>) {
    if (!r.ok) {
      const m = FAIL[r.reason](online);
      if (r.reason === 'no-speech') setMsg({ tone: 'info', text: 'No te escuché. Toca el micrófono y di «guardar», «corregir» o «cancelar».' });
      else if (m) setMsg({ tone: 'error', text: m });
      return;
    }
    setHeard(r.text);
    switch (detectSummaryCommand(r.text)) {
      case 'save': {
        const c = calc(draftRef.current);
        if (c.missing.length) {
          const t = `No puedo guardar: falta ${listJoin(c.missing)}.`;
          setMsg({ tone: 'error', text: t });
          if (sRef.current.speakPrompts) void speak(t, voice());
          return;
        }
        void save();
        return;
      }
      case 'edit':
        setMsg({ tone: 'info', text: 'Corrige lo que necesites y toca «Guardar orden».' });
        if (sRef.current.speakPrompts) void speak('De acuerdo, corrige lo que necesites.', voice());
        return;
      case 'cancel': return onClose();
      case 'repeat': return setNonce((n) => n + 1);
      default: setMsg({ tone: 'info', text: 'No te entendí. Di «guardar», «corregir» o «cancelar».' });
    }
  }

  async function save() {
    stopAll();
    setSaving(true); setSaveError('');
    try { await onSave(draftRef.current); } catch (e) { setSaveError((e as Error).message); } finally { setSaving(false); }
  }

  async function dictate(field: 'plate' | 'brand' | 'model' | 'color' | 'name' | 'phone' | 'notes') {
    stopAll();
    setDictating(field); setMsg(null);
    const r = await listener.listen({ lang: sRef.current.lang, maxMs: sRef.current.listenSec * 1000 });
    setDictating('');
    if (!r.ok) { const m = FAIL[r.reason](online); if (m) setMsg({ tone: 'error', text: m }); return; }
    const models = (catalog ?? []).find((b) => b.brand === draftRef.current.brand)?.models ?? [];
    if (field === 'plate') update('plate', parsePlate(r.text).value);
    else if (field === 'brand') setDraft((d) => ({ ...d, brand: matchBrand(r.text, brands), model: '' }));
    else if (field === 'model') update('model', matchCatalogValue(r.text, models));
    else if (field === 'color') update('color', matchCatalogValue(r.text, COLORS));
    else if (field === 'name') update('name', parseName(r.text));
    else if (field === 'phone') update('phone', parsePhone(r.text).value);
    else update('notes', parseNotes(r.text));
  }

  const MicBtn = ({ field }: { field: Parameters<typeof dictate>[0] }) => supported ? (
    <Button type="button" variant={dictating === field ? 'default' : 'outline'} size="icon" aria-label={`Dictar ${field}`} onClick={() => (dictating === field ? listener.stop() : dictate(field))}>
      <Mic className={cn('h-4 w-4', dictating === field && 'animate-pulse')} />
    </Button>
  ) : null;

  if (!open) return null;
  const c = calc(draft);
  const models = (catalog ?? []).find((b) => b.brand.toLowerCase() === draft.brand.trim().toLowerCase())?.models ?? [];
  const step = idx < STEPS.length ? STEPS[idx] : null;
  const canNext = !step ? false : step.key === 'plate' ? draft.plate.length >= 3 : step.key === 'vehicle' ? !!(draft.brand && draft.model && draft.color) : step.key === 'service' ? c.lines.length > 0 : true;

  const VehicleFields = (
    <div className="grid gap-3 sm:grid-cols-3">
      <div><Label>Marca *</Label><div className="flex gap-2"><Combobox value={draft.brand} placeholder="Ej. VW" options={brands} onChange={(t) => setDraft((d) => ({ ...d, brand: t, model: t.trim().toLowerCase() === d.brand.trim().toLowerCase() ? d.model : '' }))} onPick={(b) => setDraft((d) => ({ ...d, brand: b, model: '' }))} className="flex-1" /><MicBtn field="brand" /></div></div>
      <div><Label>Modelo *</Label><div className="flex gap-2"><Combobox value={draft.model} placeholder={draft.brand ? `Modelos de ${draft.brand}` : 'Elija la marca'} options={models} onChange={(t) => update('model', t)} className="flex-1" /><MicBtn field="model" /></div></div>
      <div><Label>Color *</Label><div className="flex gap-2"><Combobox value={draft.color} placeholder="Rojo" options={COLORS} onChange={(t) => update('color', t)} className="flex-1" /><MicBtn field="color" /></div></div>
    </div>
  );

  return (
    <Portal>
    <div className="fixed inset-0 z-[70] isolate flex flex-col bg-background print:hidden" role="dialog" aria-label="Modo Voz">
        <GlassBlobs />
      <header className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-2 font-semibold"><span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground"><Mic className="h-4 w-4" /></span>{showSettings ? 'Configuración de voz' : 'Modo Voz'}</div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon" onClick={() => saveVoiceSettings({ speakPrompts: !settings.speakPrompts })} aria-label={settings.speakPrompts ? 'Silenciar guía de voz' : 'Activar guía de voz'}>{settings.speakPrompts ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}</Button>
          <Button variant={showSettings ? 'secondary' : 'ghost'} size="icon" onClick={() => { stopAll(); setShowSettings((v) => !v); }} aria-label="Configuración de voz"><Settings className="h-4 w-4" /></Button>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Cerrar"><X className="h-5 w-5" /></Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-xl space-y-4 p-4">
          {showSettings ? (
            <>
              <div className="rounded-3xl border border-white/60 bg-white/60 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06] p-4"><VoiceSettingsForm /></div>
              <Button className="w-full" onClick={() => { setShowSettings(false); setNonce((n) => n + 1); }}>Volver al Modo Voz</Button>
            </>
          ) : (
            <>
              {!supported && <p className="rounded-md bg-amber-500/15 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">Este navegador no soporta reconocimiento de voz (usa Chrome, Edge o Safari). Puedes escribir cada respuesta: el resto funciona igual.</p>}
              {supported && !online && <p className="rounded-md bg-sky-500/10 px-3 py-2 text-xs text-sky-800 dark:text-sky-300">Sin internet: la voz depende del navegador y puede no responder. Si falla, escribe la respuesta; la orden se guarda en el dispositivo y se sincroniza sola.</p>}

              {/* progreso */}
              <ol className="flex items-center justify-between gap-1 text-[11px] text-muted-foreground">
                {[...STEPS.map((s) => s.title), 'Resumen'].map((t, n) => (
                  <li key={t} className={cn('flex flex-1 flex-col items-center gap-1', n === idx && 'font-semibold text-primary')}>
                    <span className={cn('h-1.5 w-full rounded-full bg-muted', n < idx && 'bg-primary/60', n === idx && 'bg-primary')} />{t}
                  </li>
                ))}
              </ol>

              {step ? (
                <>
                  <div className="rounded-3xl border border-white/60 bg-white/60 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06] p-5 text-center shadow-[0_8px_30px_rgba(30,41,90,0.08)]">
                    <p className="text-xs uppercase tracking-wide text-muted-foreground">Paso {idx + 1} de {STEPS.length}{step.optional && ' · opcional'}</p>
                    <h2 className="mt-1 text-xl font-semibold">{step.prompt}</h2>
                    <p className="mt-1 text-sm text-muted-foreground">{step.example}</p>

                    <button
                      type="button"
                      disabled={!supported}
                      onClick={() => (status === 'listening' ? listener.stop() : void listenNow(idx, ++runId.current))}
                      aria-label={status === 'listening' ? 'Detener' : 'Hablar'}
                      className={cn('relative mx-auto mt-5 grid h-20 w-20 place-items-center rounded-full text-primary-foreground shadow-lg transition', status === 'listening' ? 'bg-red-500' : 'bg-primary', !supported && 'bg-muted text-muted-foreground')}
                    >
                      {status === 'listening' && <span className="absolute inset-0 animate-ping rounded-full bg-red-500/40" />}
                      {supported ? <Mic className="relative h-9 w-9" /> : <MicOff className="h-9 w-9" />}
                    </button>
                    <p className="mt-2 h-5 text-sm text-muted-foreground">{status === 'speaking' ? 'Hablando…' : status === 'listening' ? 'Escuchando… habla ahora' : supported ? 'Toca el micrófono para hablar' : 'Escribe la respuesta'}</p>
                    <p className="mt-1 min-h-[1.5rem] text-sm italic text-muted-foreground">{heard && `Escuché: «${heard}»`}</p>
                  </div>

                  {msg && <p className={cn('rounded-md px-3 py-2 text-sm', msg.tone === 'error' ? 'bg-red-500/10 text-red-700 dark:text-red-300' : 'bg-sky-500/10 text-sky-700 dark:text-sky-300')}>{msg.text}</p>}

                  {/* campo editable del paso (corrección manual) */}
                  <div onFocusCapture={clearAdvance} className="space-y-2">
                    {step.key === 'plate' && <div><Label>Placa</Label><Input aria-label="Placa" value={draft.plate} onChange={(e) => { clearAdvance(); update('plate', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)); }} className="h-12 text-center font-mono text-2xl uppercase tracking-widest" placeholder="ABC123" /></div>}
                    {step.key === 'vehicle' && VehicleFields}
                    {step.key === 'name' && <div><Label>Nombre del cliente</Label><Input aria-label="Nombre" value={draft.name} onChange={(e) => { clearAdvance(); setDraft((d) => ({ ...d, name: e.target.value, clientId: undefined })); }} className="h-12 text-lg" autoComplete="off" /><ClientSuggest clients={clients} query={draft.name} selectedId={draft.clientId} onPick={(c) => { clearAdvance(); applyClient(c); goNext(idx); }} /></div>}
                    {step.key === 'phone' && <div><Label>Teléfono</Label><Input aria-label="Teléfono" type="tel" inputMode="tel" value={draft.phone} onChange={(e) => { clearAdvance(); setDraft((d) => ({ ...d, phone: e.target.value.replace(/[^\d]/g, '').slice(0, 10), clientId: undefined })); }} className="h-12 text-center text-xl tracking-wider" /><ClientSuggest clients={clients} query={draft.phone || draft.name} selectedId={draft.clientId} onPick={(c) => { clearAdvance(); applyClient(c); goNext(idx); }} /></div>}
                    {step.key === 'notes' && <div><Label>Observaciones</Label><Textarea aria-label="Observaciones" value={draft.notes} onChange={(e) => { clearAdvance(); update('notes', e.target.value); }} /></div>}
                    {step.key === 'service' && (
                      <div className="space-y-2">
                        <Label>Servicios (toca para agregar o quitar)</Label>
                        <div className="grid grid-cols-2 gap-2">
                          {services.map((s) => {
                            const q = draft.items[s.id] ?? 0;
                            return (
                              <button key={s.id} type="button" onClick={() => { clearAdvance(); setDraft((d) => ({ ...d, items: { ...d.items, [s.id]: q + 1 } })); }}
                                className={cn('relative rounded-2xl border border-white/60 bg-white/60 p-3 text-left text-sm backdrop-blur-xl hover:border-primary dark:border-white/10 dark:bg-white/[0.06]', q > 0 && 'border-primary ring-1 ring-primary')}>
                                {q > 0 && <span className="absolute right-2 top-2 grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1 text-xs font-semibold text-primary-foreground">{q}</span>}
                                <span className="block pr-6 font-medium leading-tight">{s.name}</span>
                                <span className="text-xs text-muted-foreground">{money(s.price, currency)}</span>
                              </button>
                            );
                          })}
                        </div>
                        {ambiguous.length > 0 && <div className="flex flex-wrap gap-2">{ambiguous.map((a) => <Button key={a.id} size="sm" variant="outline" onClick={() => { addItems([{ id: a.id, qty: 1 }]); setAmbiguous([]); setMsg(null); schedule(idx); }}>{a.name}</Button>)}</div>}
                      </div>
                    )}
                  </div>

                  {advancing && <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full animate-voice-bar bg-primary" style={{ animationDuration: `${settings.advanceSec}s` }} /></div>}

                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Button variant="ghost" disabled={idx === 0} onClick={() => goTo(idx - 1)}><ChevronLeft className="h-4 w-4" />Atrás</Button>
                    <div className="flex gap-2">
                      {step.optional && <Button variant="outline" onClick={() => goNext(idx)}>Saltar</Button>}
                      <Button disabled={!canNext} onClick={() => goNext(idx)}>{idx === STEPS.length - 1 ? 'Ver resumen' : 'Siguiente'}</Button>
                    </div>
                  </div>
                </>
              ) : (
                <div onFocusCapture={() => { runId.current++; listener.stop(); cancelSpeech(); setStatus('idle'); }} className="space-y-4">
                  <h2 className="text-lg font-semibold">Resumen — revisa antes de guardar</h2>
                  <p className="-mt-2 text-sm text-muted-foreground">Se lee en voz alta. Di <b>«guardar»</b>, <b>«corregir»</b> o <b>«cancelar»</b>; o corrige los datos escribiendo o con el micrófono de cada campo.</p>

                  {supported && (
                    <div className="flex items-center gap-3 rounded-3xl border border-white/60 bg-white/60 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06] p-3">
                      <button type="button" aria-label={status === 'listening' ? 'Detener' : 'Hablar'} onClick={() => (status === 'listening' ? listener.stop() : void summaryListen(++runId.current))}
                        className={cn('relative grid h-12 w-12 shrink-0 place-items-center rounded-full text-primary-foreground', status === 'listening' ? 'bg-red-500' : 'bg-primary')}>
                        {status === 'listening' && <span className="absolute inset-0 animate-ping rounded-full bg-red-500/40" />}
                        <Mic className="relative h-6 w-6" />
                      </button>
                      <div className="min-w-0 text-sm">
                        <p className="font-medium">{status === 'speaking' ? 'Leyendo el resumen…' : status === 'listening' ? 'Escuchando: di «guardar», «corregir» o «cancelar»' : 'Toca el micrófono para dar una orden de voz'}</p>
                        {heard && <p className="truncate italic text-muted-foreground">Escuché: «{heard}»</p>}
                      </div>
                      {status === 'speaking' && <Button size="sm" variant="ghost" onClick={() => { runId.current++; cancelSpeech(); setStatus('idle'); }}>Omitir</Button>}
                    </div>
                  )}
                  {msg && <p className={cn('rounded-md px-3 py-2 text-sm', msg.tone === 'error' ? 'bg-red-500/10 text-red-700 dark:text-red-300' : 'bg-sky-500/10 text-sky-700 dark:text-sky-300')}>{msg.text}</p>}

                  <div className="space-y-3 rounded-3xl border border-white/60 bg-white/60 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06] p-4">
                    <div><Label>Placa *</Label><div className="flex gap-2"><Input aria-label="Placa" value={draft.plate} onChange={(e) => update('plate', e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8))} className="font-mono uppercase" /><MicBtn field="plate" /></div></div>
                    {VehicleFields}
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div><Label>Nombre</Label><div className="flex gap-2"><Input aria-label="Nombre" value={draft.name} onChange={(e) => update('name', e.target.value)} /><MicBtn field="name" /></div></div>
                      <div><Label>Teléfono</Label><div className="flex gap-2"><Input aria-label="Teléfono" type="tel" inputMode="tel" value={draft.phone} onChange={(e) => update('phone', e.target.value.replace(/[^\d]/g, '').slice(0, 10))} /><MicBtn field="phone" /></div></div>
                    </div>
                    <div><Label>Observaciones</Label><div className="flex gap-2"><Textarea aria-label="Observaciones" value={draft.notes} onChange={(e) => update('notes', e.target.value)} className="min-h-[60px]" /><MicBtn field="notes" /></div></div>

                    <div>
                      <Label>Servicios *</Label>
                      <div className="space-y-2">
                        {c.lines.map((l) => (
                          <div key={l.id} className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
                            <span className="min-w-0 flex-1 truncate">{l.name} <span className="text-xs text-muted-foreground">{money(l.price, currency)}</span></span>
                            <div className="flex items-center gap-1">
                              <Button type="button" variant="outline" size="icon" className="h-7 w-7" onClick={() => setDraft((d) => { const q = (d.items[l.id] ?? 0) - 1; const { [l.id]: _, ...rest } = d.items; return { ...d, items: q > 0 ? { ...rest, [l.id]: q } : rest }; })}><Minus className="h-3 w-3" /></Button>
                              <span className="w-5 text-center">{draft.items[l.id]}</span>
                              <Button type="button" variant="outline" size="icon" className="h-7 w-7" onClick={() => setDraft((d) => ({ ...d, items: { ...d.items, [l.id]: Math.min((d.items[l.id] ?? 0) + 1, 99) } }))}><Plus className="h-3 w-3" /></Button>
                            </div>
                          </div>
                        ))}
                        <Select value="" onChange={(e) => e.target.value && setDraft((d) => ({ ...d, items: { ...d.items, [e.target.value]: (d.items[e.target.value] ?? 0) + 1 } }))} aria-label="Agregar servicio">
                          <option value="">+ Agregar servicio…</option>
                          {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                        </Select>
                      </div>
                    </div>

                    <div>
                      <Label>Pago</Label>
                      <div className="flex flex-wrap gap-2">
                        {PAY.filter(([v]) => allowLater || v !== 'LATER').map(([v, l]) => <button key={v} type="button" onClick={() => update('method', v)} className={cn('rounded-md border px-3 py-1.5 text-sm hover:bg-muted', draft.method === v && 'border-primary bg-primary/10 text-primary')}>{l}</button>)}
                      </div>
                    </div>

                    <div className="space-y-1 border-t pt-3 text-sm">
                      <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span>{money(c.subtotal, currency)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">IVA ({taxRate}%)</span><span>{money(c.tax, currency)}</span></div>
                      <div className="flex justify-between text-base font-semibold"><span>Total estimado</span><span>{money(c.total, currency)}</span></div>
                    </div>
                  </div>

                  {c.missing.length > 0 && <p className="rounded-md bg-amber-500/15 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">Falta: {c.missing.map((m) => m.replace(/^(la|el) /, '')).join(', ')}.</p>}
                  <ErrorText error={saveError ? new Error(saveError) : undefined} />
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Button size="lg" className="flex-1" variant="success" disabled={saving || c.missing.length > 0} onClick={() => void save()}>{saving ? 'Guardando…' : 'Guardar orden'}</Button>
                    <Button size="lg" variant="outline" onClick={() => onOpenInForm(draftRef.current)}>Abrir en el formulario</Button>
                  </div>
                  <Button variant="ghost" className="w-full" onClick={() => goTo(0)}>Volver a capturar desde el inicio</Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
    </Portal>
  );
}

/** Según el ajuste de voz: preguntas guiadas (actual) o dictado rápido con palabras clave y cola de órdenes. */
export function VoiceMode(props: Props) {
  const settings = useVoiceSettings();
  if (settings.mode === 'dictate') {
    const { open, onClose, services, clients, catalog, taxRate, currency, online, allowLater, defaultMethod, onSave } = props;
    return <DictationMode open={open} onClose={onClose} services={services} clients={clients} catalog={catalog} taxRate={taxRate} currency={currency} online={online} allowLater={allowLater} defaultMethod={defaultMethod} onSave={onSave} />;
  }
  return <GuidedVoiceMode {...props} />;
}
