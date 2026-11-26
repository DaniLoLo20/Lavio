'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUp, Check, ChevronDown, Mic, Settings, Square, Trash2, Wallet, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, money } from '@/lib/utils';
import { createListener, speak, speechSupported, type ListenFail } from '@/lib/voice/speech';
import { CASH_CMD, END_MARKER, NEXT_MARKER, highlight, missingOf, parseDictation, splitOrders, type Catalog, type DictDraft, type Mark } from '@/lib/voice/dictation';
import { speechOpts, useVoiceSettings } from '@/lib/voice/settings';
import type { ClientLite } from '@/lib/clients';
import { Button, ErrorText, Input, Label, Select } from './ui';
import { Combobox } from './combobox';
import { COLORS } from '@/lib/voice/parsers';
import { VoiceSettingsForm } from './voice-settings';
import { ColorField, VehicleField } from './vehicle-field';
import { GlassBlobs } from './glass';
import { Portal } from './portal';

type Svc = { id: string; name: string; price: number | string; requiresVehicle?: boolean };
export interface DictationProps {
  open: boolean;
  onClose: () => void;
  services: Svc[];
  clients?: ClientLite[];
  catalog?: Catalog;
  taxRate: number;
  currency?: string;
  online: boolean;
  allowLater?: boolean;
  defaultMethod?: string;
  /** silent: no abrir el ticket ni cerrar el dictado (se guardan varias órdenes seguidas) */
  onSave: (d: DictDraft, o?: { silent?: boolean }) => Promise<void>;
}

interface Entry {
  id: string;
  draft: DictDraft;
  status: 'idle' | 'saving' | 'saved' | 'error';
  error?: string;
  warnings: string[];
  known?: string;
  open: boolean;
}

const FAIL: Record<ListenFail, string | null> = {
  'no-speech': null,
  denied: 'El navegador bloqueó el micrófono. Permite el acceso o escribe abajo.',
  network: 'El reconocimiento de voz no respondió (en Chrome necesita internet). Escribe abajo.',
  mic: 'No se detectó un micrófono.',
  aborted: null,
  unsupported: null,
  error: 'No pude usar el reconocimiento de voz. Escribe abajo.',
};
const PAY: [string, string][] = [['CASH', 'Efectivo'], ['CARD', 'Tarjeta'], ['TRANSFER', 'Transferencia'], ['LATER', 'Cobrar después']];
const MARK_CLS: Record<Mark, string> = {
  plate: 'rounded-md bg-sky-500/15 px-1 font-mono font-semibold text-sky-700 dark:text-sky-300',
  veh: 'rounded-md bg-sky-500/15 px-1 font-semibold text-sky-700 dark:text-sky-300',
  svc: 'rounded-md bg-emerald-500/15 px-1 font-semibold text-emerald-700 dark:text-emerald-300',
  client: 'rounded-md bg-violet-500/15 px-1 font-semibold text-violet-700 dark:text-violet-300',
};
const METER_KEY = 'al_voice_meter';
let seq = 0;

/** Tono corto de confirmación (dos notas). Sin archivos de audio. */
function chime(ok = true) {
  try {
    const AC = window.AudioContext || (window as any).webkitAudioContext;
    const c: AudioContext = new AC();
    const now = c.currentTime;
    (ok ? [880, 1320] : [440, 330]).forEach((f, i) => {
      const o = c.createOscillator(); const g = c.createGain();
      o.type = 'sine'; o.frequency.value = f;
      const t0 = now + i * 0.12;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.2, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.18);
      o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + 0.2);
    });
    setTimeout(() => c.close().catch(() => undefined), 700);
  } catch { /* sin audio */ }
}

/** Nivel del micrófono (0..1) mientras se escucha, para que el halo «respire» con la voz. Si el dispositivo no lo permite, queda en 0. */
function useMicLevel(active: boolean) {
  const [level, setLevel] = useState(0);
  useEffect(() => {
    if (!active || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return;
    try { if (localStorage.getItem(METER_KEY) === 'off') return; } catch { /* sin storage */ }
    let stop = false; let raf = 0; let ctx: AudioContext | undefined; let stream: MediaStream | undefined;
    (async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
        if (stop) { stream.getTracks().forEach((t) => t.stop()); return; }
        const AC = window.AudioContext || (window as any).webkitAudioContext;
        ctx = new AC();
        if (ctx.state === 'suspended') await ctx.resume().catch(() => undefined);
        const an = ctx.createAnalyser(); an.fftSize = 512;
        ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Uint8Array(an.fftSize); let last = 0;
        const tick = (ts: number) => {
          an.getByteTimeDomainData(buf);
          let s = 0; for (let i = 0; i < buf.length; i++) { const x = (buf[i] - 128) / 128; s += x * x; }
          if (ts - last > 60) { setLevel(Math.min(1, Math.sqrt(s / buf.length) * 5)); last = ts; }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch { /* sin medidor: se usa la animación normal */ }
    })();
    return () => { stop = true; cancelAnimationFrame(raf); stream?.getTracks().forEach((t) => t.stop()); ctx?.close().catch(() => undefined); setLevel(0); };
  }, [active]);
  return level;
}

/**
 * Asistente de voz: hablas natural («Un Versa gris, placas ABC-123, lavado básico para Juan Pérez»), la transcripción
 * aparece en vivo con las palabras reconocidas resaltadas, y cada orden entendida queda lista para guardar en un toque.
 * La voz la reconoce el navegador (reglas propias, sin IA externa): se guarda el texto, no el audio.
 */
export function DictationMode({ open, onClose, services, clients = [], catalog, taxRate, currency, online, allowLater = true, defaultMethod, onSave }: DictationProps) {
  const { can } = useAuth();
  const settings = useVoiceSettings();
  const sRef = useRef(settings);
  sRef.current = settings;
  const supported = useMemo(() => speechSupported(), []);
  const listener = useRef(createListener()).current;
  const capRef = useRef(false);
  const consumed = useRef(0);
  const pending = useRef('');
  const sessionRef = useRef('');
  const ctxRef = useRef({ services, catalog, clients, method: defaultMethod ?? 'CASH', allowLater });
  ctxRef.current = { services, catalog, clients, method: defaultMethod ?? (allowLater ? 'LATER' : 'CASH'), allowLater };

  const [entries, setEntries] = useState<Entry[]>([]);
  const [capturing, setCapturing] = useState(false);
  const [live, setLive] = useState('');
  const [msg, setMsg] = useState('');
  const [typed, setTyped] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [savingAll, setSavingAll] = useState(false);
  const [cashInfo, setCashInfo] = useState<string | null>(null);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const listRef = useRef<HTMLDivElement>(null);
  const level = useMicLevel(capturing);

  const brands = (catalog ?? []).map((b) => b.brand);
  /** ¿Pide vehículo? Solo si algún servicio de la orden lo pide (o si aún no hay servicio). */
  const needV = (d: DictDraft) => { const ids = Object.keys(d.items); return !ids.length || ids.some((id) => services.find((s) => s.id === id)?.requiresVehicle !== false); };
  const missingFor = (d: DictDraft) => missingOf(d, needV(d));
  const svcName = (id: string) => services.find((s) => s.id === id)?.name ?? '';
  const totalOf = (d: DictDraft) => {
    const sub = Object.entries(d.items).reduce((s, [id, q]) => s + Number(services.find((x) => x.id === id)?.price ?? 0) * q, 0);
    return Math.round(sub * (1 + taxRate / 100) * 100) / 100;
  };

  /** Lo que se está dictando ahora, ya interpretado, para resaltar las palabras reconocidas. */
  const liveDraft = useMemo(() => (live ? parseDictation(live, ctxRef.current).draft : null), [live]);

  /** Consulta rápida de la caja (botón o comando de voz «consultar caja»). */
  async function showCash() {
    if (!can('cash:view')) { setCashInfo('No tienes permiso para ver la caja.'); return; }
    try {
      const c = await api<any | null>('/cash/current');
      setCashInfo(c ? `Caja abierta · efectivo esperado ${money(c.figures.expectedCash, currency)} · ${c.figures.orders.count} ventas · ingresos ${money(c.figures.totalIncome, currency)}` : 'La caja está cerrada.');
    } catch (e) { setCashInfo((e as Error).message); }
  }

  function confirm(entries: Entry[]) {
    const last = entries[entries.length - 1];
    if (!last) return;
    const miss = missingFor(last.draft);
    chime(miss.length === 0);
    // Hablar mientras el micrófono escucha haría que se transcriba a sí mismo: solo se habla con el micrófono apagado.
    if (!capRef.current && sRef.current.speakPrompts) {
      const veh = [last.draft.brand, last.draft.model, last.draft.color].filter(Boolean).join(' ');
      const txt = miss.length ? `Me falta ${miss.join(', ')}.` : `Listo: ${veh || 'orden'}${last.draft.plate ? `, placas ${last.draft.plate.split('').join(' ')}` : ''}.`;
      void speak(txt, speechOpts(sRef.current));
    }
  }

  function addEntries(texts: string[]) {
    const fresh: Entry[] = [];
    for (const raw of texts) {
      let t = raw;
      if (CASH_CMD.test(t)) { void showCash(); t = t.replace(CASH_CMD, '').trim(); if (!t) continue; }
      const p = parseDictation(t, ctxRef.current);
      fresh.push({ id: `d${++seq}`, draft: p.draft, status: 'idle', warnings: p.warnings, known: p.known?.name ?? undefined, open: false });
    }
    if (!fresh.length) return;
    setEntries((es) => [...es, ...fresh]);
    confirm(fresh);
    setTimeout(() => listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' }), 60);
  }

  /** Texto de la sesión de voz: «siguiente orden» cierra la orden anterior; «consultar caja» se ejecuta al momento. */
  function onText(text: string) {
    sessionRef.current = text;
    let rest = text.slice(consumed.current);
    const cmd = rest.match(CASH_CMD);
    if (cmd) {
      pending.current = `${pending.current} ${rest.slice(0, cmd.index)}`.trim();
      consumed.current += (cmd.index ?? 0) + cmd[0].length;
      void showCash();
      rest = text.slice(consumed.current);
    }
    const marks = [...rest.matchAll(NEXT_MARKER)];
    if (marks.length) {
      const last = marks[marks.length - 1];
      addEntries(splitOrders(`${pending.current} ${rest.slice(0, last.index)}`));
      pending.current = '';
      consumed.current += (last.index ?? 0) + last[0].length;
    }
    setLive(`${pending.current} ${text.slice(consumed.current)}`.trim());
    if (END_MARKER.test(text.slice(consumed.current))) stopCapture();
  }

  async function startCapture() {
    if (capRef.current || !supported) return;
    capRef.current = true; setCapturing(true); setMsg(''); setCashInfo(null);
    let quiet = 0; let retriedMeter = false;
    while (capRef.current) {
      consumed.current = 0; sessionRef.current = '';
      const r = await listener.listen({ lang: sRef.current.lang, continuous: true, maxMs: 55_000, onInterim: onText });
      if (r.ok) { quiet = 0; onText(r.text); pending.current = `${pending.current} ${r.text.slice(consumed.current)}`.replace(END_MARKER, '').trim(); consumed.current = 0; }
      else {
        if (r.reason === 'no-speech') { if (++quiet >= 3) { setMsg('No te escuché. Toca el micrófono para continuar.'); break; } continue; }
        // Algunos celulares no dejan medir el volumen y reconocer a la vez: se apaga el medidor y se reintenta.
        if (r.reason === 'mic' && !retriedMeter) { retriedMeter = true; try { localStorage.setItem(METER_KEY, 'off'); } catch { /* */ } continue; }
        const m = FAIL[r.reason]; if (m) setMsg(m);
        if (r.reason !== 'aborted') break;
        if (!capRef.current) break;
      }
    }
    capRef.current = false; setCapturing(false);
    const rest = pending.current.replace(END_MARKER, '').trim();
    pending.current = ''; setLive('');
    if (rest) addEntries(splitOrders(rest));
  }
  function stopCapture() { capRef.current = false; listener.end(); }

  /** «Siguiente orden»: cierra lo dictado hasta ahora y el micrófono sigue escuchando. */
  function nextOrder() {
    const texts = splitOrders(`${pending.current} ${sessionRef.current.slice(consumed.current)}`);
    if (!texts.length) return;
    pending.current = '';
    consumed.current = sessionRef.current.length;
    addEntries(texts);
    setLive('');
  }

  /** Chip rápido: agrega el texto a la orden que se está dictando (o a la barra de texto si el micrófono está apagado). */
  function chip(text: string) {
    if (capRef.current) { pending.current = `${pending.current} ${text}`.trim(); setLive(`${pending.current} ${sessionRef.current.slice(consumed.current)}`.trim()); }
    else setTyped((t) => (t.trim() ? `${t.trim()}, ${text}` : text));
  }
  function sendTyped() { if (!typed.trim()) return; addEntries(splitOrders(typed)); setTyped(''); }

  useEffect(() => {
    if (!open) { capRef.current = false; listener.stop(); }
    else { setEntries([]); setLive(''); setMsg(''); setTyped(''); setCashInfo(null); pending.current = ''; consumed.current = 0; setShowSettings(false); }
    return () => { capRef.current = false; listener.stop(); };
  }, [open, listener]);

  function close() {
    const unsaved = entriesRef.current.filter((e) => e.status !== 'saved').length;
    if (unsaved && !window.confirm(`Hay ${unsaved} orden(es) sin guardar. ¿Salir y descartarlas?`)) return;
    capRef.current = false; listener.stop();
    onClose();
  }

  const patch = (id: string, p: Partial<Entry>) => setEntries((es) => es.map((e) => (e.id === id ? { ...e, ...p } : e)));
  const patchDraft = (id: string, d: Partial<DictDraft>) => setEntries((es) => es.map((e) => (e.id === id ? { ...e, draft: { ...e.draft, ...d }, status: e.status === 'error' ? 'idle' : e.status } : e)));
  const toggleSvc = (id: string, sid: string) => setEntries((es) => es.map((e) => {
    if (e.id !== id) return e;
    const items = { ...e.draft.items };
    if (items[sid]) delete items[sid]; else items[sid] = 1;
    return { ...e, draft: { ...e.draft, items } };
  }));

  async function saveOne(e: Entry) {
    if (missingFor(e.draft).length) return patch(e.id, { open: true, error: 'Faltan datos obligatorios', status: 'error' });
    patch(e.id, { status: 'saving', error: undefined });
    try { await onSave(e.draft, { silent: true }); patch(e.id, { status: 'saved', open: false }); chime(true); }
    catch (er) { patch(e.id, { status: 'error', error: (er as Error).message, open: true }); chime(false); }
  }
  async function saveAll() {
    setSavingAll(true);
    for (const e of entriesRef.current) if (e.status !== 'saved' && e.status !== 'saving' && !missingFor(e.draft).length) await saveOne(e);
    setSavingAll(false);
  }

  if (!open) return null;
  const ready = entries.filter((e) => e.status !== 'saved' && !missingFor(e.draft).length).length;
  const pendingCount = entries.filter((e) => e.status !== 'saved').length;
  const chips: { label: string; run: () => void; icon?: React.ComponentType<{ className?: string }> }[] = [
    ...services.slice(0, 3).map((s) => ({ label: s.name, run: () => chip(s.name.toLowerCase()) })),
    ...(can('cash:view') ? [{ label: 'Consultar caja', run: () => void showCash(), icon: Wallet }] : []),
  ];
  const halo = capturing ? 1 + level * 0.6 : 1;

  return (
    <Portal>
      <div className="fixed inset-0 z-[70] isolate flex flex-col bg-background" role="dialog" aria-label="Modo Voz">
        <GlassBlobs />
        <header className="flex shrink-0 items-center justify-between px-4 pb-2 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <p className="flex items-center gap-2 text-sm font-semibold"><span className="grid h-7 w-7 place-items-center rounded-full bg-primary/10 text-primary"><Mic className="h-4 w-4" /></span>Asistente de voz</p>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" aria-label="Ajustes de voz" onClick={() => setShowSettings((v) => !v)}><Settings className="h-5 w-5" /></Button>
            <Button variant="ghost" size="icon" onClick={close} aria-label="Cerrar"><X className="h-5 w-5" /></Button>
          </div>
        </header>

        {showSettings ? (
          <div className="flex-1 overflow-y-auto px-4 pb-6">
            <div className="mx-auto max-w-xl space-y-3">
              <div className="rounded-3xl border border-white/60 bg-white/60 p-4 backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06]"><VoiceSettingsForm /></div>
              <Button className="w-full rounded-2xl" onClick={() => setShowSettings(false)}>Volver al asistente</Button>
            </div>
          </div>
        ) : (
          <>
            {/* Centro: transcripción en vivo y órdenes entendidas */}
            <div ref={listRef} className="flex-1 overflow-y-auto px-4">
              <div className="mx-auto flex min-h-full max-w-xl flex-col justify-end gap-3 pb-3">
                {!entries.length && !live && (
                  <div className="py-6 text-center">
                    <p className="text-2xl font-semibold tracking-tight">{capturing ? 'Te escucho…' : '¿Qué vamos a lavar?'}</p>
                    <p className="mx-auto mt-2 max-w-xs text-sm text-muted-foreground">Ej.: “Un Versa gris, placas ABC-123, lavado básico para Juan Pérez”</p>
                  </div>
                )}

                {cashInfo && (
                  <div className="flex items-start gap-3 rounded-3xl border border-white/60 bg-white/70 p-3 text-sm shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06]" data-testid="cash-info">
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-700 text-white"><Wallet className="h-4 w-4" /></span>
                    <p className="flex-1">{cashInfo}</p>
                    <button type="button" aria-label="Cerrar consulta de caja" onClick={() => setCashInfo(null)} className="text-muted-foreground"><X className="h-4 w-4" /></button>
                  </div>
                )}

                {entries.map((e, n) => {
                  const miss = missingFor(e.draft);
                  const saved = e.status === 'saved';
                  const veh = [e.draft.brand, e.draft.model, e.draft.color].filter(Boolean).join(' ');
                  const svcs = Object.entries(e.draft.items).map(([id, q]) => `${q > 1 ? `${q}× ` : ''}${svcName(id)}`).join(' + ');
                  return (
                    <article key={e.id} className={cn('rounded-3xl border border-white/60 bg-white/70 p-3.5 shadow-[0_8px_30px_rgba(30,41,90,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06]', saved && 'opacity-60')}>
                      <div className="flex items-start gap-3">
                        <span className={cn('grid h-8 w-8 shrink-0 place-items-center rounded-full text-xs font-bold text-white', saved ? 'bg-emerald-500' : miss.length ? 'bg-amber-500' : 'bg-primary')}>{saved ? <Check className="h-4 w-4" /> : n + 1}</span>
                        <button type="button" className="min-w-0 flex-1 text-left" onClick={() => !saved && patch(e.id, { open: !e.open })} aria-expanded={e.open}>
                          <span className="block truncate text-sm font-semibold"><span className="font-mono">{e.draft.plate || 'Sin placa'}</span>{veh && ` · ${veh}`}</span>
                          <span className="block truncate text-xs text-muted-foreground">{[e.draft.name && `${e.draft.name}${e.known ? ' ✓' : ''}`, svcs || 'Sin servicio'].filter(Boolean).join(' · ')}</span>
                          <span className={cn('mt-0.5 block text-xs font-medium', saved ? 'text-emerald-600' : miss.length ? 'text-amber-600' : 'text-emerald-600')}>{saved ? 'Guardada' : miss.length ? `Falta ${miss.join(', ')} · toca para completar` : 'Lista para guardar'}</span>
                        </button>
                        <div className="shrink-0 text-right">
                          <p className="text-sm font-semibold tabular-nums">{money(totalOf(e.draft), currency)}</p>
                          {!saved && <ChevronDown className={cn('ml-auto mt-1 h-4 w-4 text-muted-foreground transition', e.open && 'rotate-180')} />}
                        </div>
                      </div>
                      {e.warnings.map((w) => <p key={w} className="mt-1 text-xs text-amber-600">{w}</p>)}
                      {e.error && <ErrorText error={new Error(e.error)} />}

                      {!saved && e.open && (
                        <div className="mt-3 space-y-3 border-t border-black/5 pt-3 dark:border-white/10">
                          <div className="grid grid-cols-2 gap-2">
                            <div className="col-span-2"><Label className="text-xs">Placa</Label><Input aria-label="Placa" value={e.draft.plate} onChange={(ev) => patchDraft(e.id, { plate: ev.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8), clientId: undefined })} className="rounded-2xl font-mono uppercase" /></div>
                            <div className="col-span-2"><Label className="text-xs">Vehículo (opcional)</Label><VehicleField value={[e.draft.brand, e.draft.model].filter(Boolean).join(' ')} catalog={catalog ?? []} onChange={(t) => patchDraft(e.id, { brand: t, model: '' })} onCommit={(pv) => patchDraft(e.id, { brand: pv.brand, model: pv.model, color: e.draft.color || pv.color })} /></div>
                            <div className="col-span-2"><Label className="text-xs">Color (opcional)</Label><ColorField value={e.draft.color} onChange={(color) => patchDraft(e.id, { color })} /></div>
                            <div><Label className="text-xs">Nombre</Label><Input aria-label="Nombre" value={e.draft.name} onChange={(ev) => patchDraft(e.id, { name: ev.target.value, clientId: undefined })} className="rounded-2xl" /></div>
                            <div><Label className="text-xs">Teléfono</Label><Input aria-label="Teléfono" type="tel" value={e.draft.phone} onChange={(ev) => patchDraft(e.id, { phone: ev.target.value.replace(/\D/g, '').slice(0, 10), clientId: undefined })} className="rounded-2xl" /></div>
                          </div>
                          <div>
                            <Label className="text-xs">Servicios *</Label>
                            <div className="flex flex-wrap gap-2">
                              {services.map((s) => (
                                <button key={s.id} type="button" onClick={() => toggleSvc(e.id, s.id)} className={cn('rounded-full px-3 py-1.5 text-xs font-medium', e.draft.items[s.id] ? 'bg-primary text-primary-foreground' : 'bg-black/5 dark:bg-white/10')}>{s.name} · {money(s.price, currency)}</button>
                              ))}
                            </div>
                          </div>
                          <div><Label className="text-xs">Observaciones</Label><Input value={e.draft.notes} onChange={(ev) => patchDraft(e.id, { notes: ev.target.value })} className="rounded-2xl" /></div>
                        </div>
                      )}

                      {!saved && (
                        <div className="mt-3 flex items-center gap-2">
                          <Select className="h-10 w-36 rounded-2xl text-sm" aria-label="Método de pago" value={e.draft.method} onChange={(ev) => patchDraft(e.id, { method: ev.target.value })}>
                            {PAY.filter(([k]) => allowLater || k !== 'LATER').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                          </Select>
                          <Button size="icon" variant="ghost" aria-label="Descartar orden" onClick={() => setEntries((es) => es.filter((x) => x.id !== e.id))}><Trash2 className="h-4 w-4" /></Button>
                          <Button size="sm" variant="success" className="ml-auto h-10 rounded-full px-5" disabled={e.status === 'saving' || miss.length > 0} onClick={() => void saveOne(e)}>{e.status === 'saving' ? 'Guardando…' : 'Guardar'}</Button>
                        </div>
                      )}
                    </article>
                  );
                })}

                {live && (
                  <div className="rounded-3xl border border-white/60 bg-white/70 px-4 py-3 text-base leading-relaxed shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06]" aria-live="polite" data-testid="live">
                    <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Entendiendo…</p>
                    {liveDraft ? highlight(live, liveDraft, services).map((s, i) => (s.k ? <span key={i} className={MARK_CLS[s.k]} data-mark={s.k}>{s.t}</span> : <span key={i}>{s.t}</span>)) : live}
                  </div>
                )}
                {msg && <p className="text-center text-xs text-amber-700">{msg}</p>}
                {!supported && <p className="text-center text-xs text-amber-700">Este navegador no soporta voz (usa Chrome). Escribe abajo.</p>}
                {!online && supported && <p className="text-center text-xs text-sky-700">Sin internet la voz de Chrome puede fallar; escribe abajo y se guardará en el dispositivo.</p>}
              </div>
            </div>

            {/* Base (zona del pulgar): chips, micrófono y barra de texto */}
            <div className="shrink-0 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2">
              <div className="mx-auto max-w-xl space-y-3">
                {ready > 0 && !capturing && (
                  <Button size="lg" variant="success" className="h-12 w-full rounded-2xl text-base shadow-lg" disabled={savingAll} onClick={() => void saveAll()}>
                    {savingAll ? 'Guardando…' : `Guardar ${ready} lista${ready === 1 ? '' : 's'}`}{pendingCount > ready && <span className="ml-1 text-xs opacity-80">({pendingCount - ready} por completar)</span>}
                  </Button>
                )}

                <div className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]" aria-label="Comandos rápidos">
                  {capturing && <button type="button" onClick={nextOrder} disabled={!live.trim()} className="shrink-0 rounded-full bg-primary px-3.5 py-2 text-xs font-semibold text-primary-foreground shadow disabled:opacity-40">Siguiente orden</button>}
                  {chips.map((c) => (
                    <button key={c.label} type="button" onClick={c.run} className="flex shrink-0 items-center gap-1.5 rounded-full border border-white/60 bg-white/60 px-3.5 py-2 text-xs font-medium shadow-sm backdrop-blur-xl active:scale-95 dark:border-white/10 dark:bg-white/10">
                      {c.icon && <c.icon className="h-3.5 w-3.5" />}{c.label}
                    </button>
                  ))}
                </div>

                <div className="flex justify-center py-1">
                  <div className="relative grid h-28 w-28 place-items-center">
                    {/* halo de vidrio que crece con el volumen de la voz */}
                    <span aria-hidden className={cn('absolute inset-0 rounded-full border border-white/70 bg-white/40 backdrop-blur-xl transition-transform duration-100 dark:border-white/10 dark:bg-white/10', capturing && level === 0 && 'animate-pulse')} style={{ transform: `scale(${halo})` }} />
                    <span aria-hidden className={cn('absolute inset-3 rounded-full transition-transform duration-100', capturing ? 'bg-red-500/25' : 'bg-primary/15')} style={{ transform: `scale(${capturing ? 1 + level * 0.35 : 1})` }} />
                    <button
                      type="button"
                      aria-label={capturing ? 'Terminar de dictar' : 'Empezar a dictar'}
                      disabled={!supported && !capturing}
                      onClick={() => (capturing ? stopCapture() : void startCapture())}
                      data-level={level.toFixed(2)}
                      className={cn('relative grid h-20 w-20 place-items-center rounded-full text-white shadow-xl transition active:scale-95 disabled:opacity-40', capturing ? 'bg-red-500 shadow-red-500/40' : 'bg-primary shadow-primary/40')}
                    >
                      {capturing ? <Square className="h-7 w-7" /> : <Mic className="h-9 w-9" />}
                    </button>
                  </div>
                </div>

                <form className="flex items-center gap-2 rounded-full border border-white/60 bg-white/70 p-1.5 pl-4 shadow-sm backdrop-blur-xl dark:border-white/10 dark:bg-white/10" onSubmit={(e) => { e.preventDefault(); sendTyped(); }}>
                  <input aria-label="Texto del dictado" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="Escribe aquí si hay mucho ruido…" className="min-w-0 flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground sm:text-sm" />
                  <button type="submit" aria-label="Enviar" disabled={!typed.trim()} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground transition active:scale-90 disabled:opacity-30"><ArrowUp className="h-5 w-5" /></button>
                </form>
              </div>
            </div>
          </>
        )}
      </div>
    </Portal>
  );
}