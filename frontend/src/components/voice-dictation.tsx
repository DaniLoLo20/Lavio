'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Mic, MicOff, Square, Trash2, X } from 'lucide-react';
import { cn, money } from '@/lib/utils';
import { createListener, speechSupported, type ListenFail } from '@/lib/voice/speech';
import { END_MARKER, NEXT_MARKER, missingOf, parseDictation, splitOrders, type Catalog, type DictDraft } from '@/lib/voice/dictation';
import { useVoiceSettings } from '@/lib/voice/settings';
import type { ClientLite } from '@/lib/clients';
import { Button, ErrorText, Input, Label, Select, Textarea } from './ui';
import { Combobox } from './combobox';
import { COLORS } from '@/lib/voice/parsers';
import { VoiceSettingsForm } from './voice-settings';

type Svc = { id: string; name: string; price: number | string };
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
  text: string;
  draft: DictDraft;
  status: 'idle' | 'saving' | 'saved' | 'error';
  error?: string;
  warnings: string[];
  known?: string;
  open: boolean;
}

const FAIL: Record<ListenFail, string | null> = {
  'no-speech': null,
  denied: 'El navegador bloqueó el micrófono. Permite el acceso o escribe el dictado abajo.',
  network: 'El servicio de voz del navegador no respondió (necesita internet en Chrome). Escribe el dictado abajo.',
  mic: 'No se detectó un micrófono.',
  aborted: null,
  unsupported: null,
  error: 'No pude usar el reconocimiento de voz. Escribe el dictado abajo.',
};
const PAY: [string, string][] = [['CASH', 'Efectivo'], ['CARD', 'Tarjeta'], ['TRANSFER', 'Transferencia'], ['LATER', 'Cobrar después']];
let seq = 0;

/**
 * Dictado rápido: una sola grabación con palabras clave. Cada orden se parsea al instante y queda en una cola
 * mientras ya se dicta la siguiente. La API de voz del navegador reconoce en vivo: se guarda el texto entendido,
 * no el audio.
 */
export function DictationMode({ open, onClose, services, clients = [], catalog, taxRate, currency, online, allowLater = true, defaultMethod, onSave }: DictationProps) {
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
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  const brands = (catalog ?? []).map((b) => b.brand);
  const svcName = (id: string) => services.find((s) => s.id === id)?.name ?? '';
  const totalOf = (d: DictDraft) => {
    const sub = Object.entries(d.items).reduce((s, [id, q]) => s + Number(services.find((x) => x.id === id)?.price ?? 0) * q, 0);
    return Math.round(sub * (1 + taxRate / 100) * 100) / 100;
  };

  function addEntries(texts: string[]) {
    const fresh: Entry[] = texts.map((t) => {
      const p = parseDictation(t, ctxRef.current);
      return { id: `d${++seq}`, text: t, draft: p.draft, status: 'idle', warnings: p.warnings, known: p.known?.name ?? undefined, open: p.missing.length > 0 };
    });
    if (fresh.length) setEntries((es) => [...es, ...fresh]);
  }

  /** Texto de la sesión de voz actual: busca "siguiente orden" y cierra las órdenes anteriores a medida que se dicen. */
  function onText(text: string) {
    sessionRef.current = text;
    const rest = text.slice(consumed.current);
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
    capRef.current = true; setCapturing(true); setMsg('');
    let quiet = 0;
    while (capRef.current) {
      consumed.current = 0; sessionRef.current = '';
      const r = await listener.listen({ lang: sRef.current.lang, continuous: true, maxMs: 55_000, onInterim: onText });
      if (r.ok) { quiet = 0; onText(r.text); pending.current = `${pending.current} ${r.text.slice(consumed.current)}`.replace(END_MARKER, '').trim(); consumed.current = 0; }
      else {
        if (r.reason === 'no-speech') { if (++quiet >= 3) { setMsg('No te escuché. Toca el micrófono para continuar.'); break; } continue; }
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

  /** Botón «Siguiente orden»: cierra lo dictado hasta ahora y deja el micrófono listo para la siguiente. */
  function nextOrder() {
    const texts = splitOrders(`${pending.current} ${sessionRef.current.slice(consumed.current)}`);
    if (!texts.length) return;
    pending.current = '';
    consumed.current = sessionRef.current.length; // lo cerrado no se vuelve a leer de esta sesión
    addEntries(texts);
    setLive('');
  }
  // Al cerrar/abrir se reinicia; con órdenes sin guardar se avisa antes de salir.
  useEffect(() => {
    if (!open) { capRef.current = false; listener.stop(); }
    else { setEntries([]); setLive(''); setMsg(''); setTyped(''); pending.current = ''; consumed.current = 0; setShowSettings(false); }
    return () => { capRef.current = false; listener.stop(); };
  }, [open, listener]);

  function close() {
    const unsaved = entriesRef.current.filter((e) => e.status !== 'saved').length;
    if (unsaved && !confirm(`Hay ${unsaved} orden(es) sin guardar. ¿Salir y descartarlas?`)) return;
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
    if (missingOf(e.draft).length) return patch(e.id, { open: true, error: 'Faltan datos obligatorios', status: 'error' });
    patch(e.id, { status: 'saving', error: undefined });
    try { await onSave(e.draft, { silent: true }); patch(e.id, { status: 'saved', open: false }); }
    catch (er) { patch(e.id, { status: 'error', error: (er as Error).message, open: true }); }
  }
  async function saveAll() {
    setSavingAll(true);
    for (const e of entriesRef.current) if (e.status !== 'saved' && e.status !== 'saving' && !missingOf(e.draft).length) await saveOne(e);
    setSavingAll(false);
  }

  if (!open) return null;
  const ready = entries.filter((e) => e.status !== 'saved' && !missingOf(e.draft).length).length;
  const pendingCount = entries.filter((e) => e.status !== 'saved').length;

  return (
    <div className="fixed inset-0 z-[70] flex flex-col bg-background/95 backdrop-blur print:hidden" role="dialog" aria-label="Modo Voz">
      <header className="flex items-center justify-between border-b px-4 py-3">
        <div className="flex items-center gap-2 font-semibold"><span className="grid h-8 w-8 place-items-center rounded-full bg-primary text-primary-foreground"><Mic className="h-4 w-4" /></span>Dictado rápido</div>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="sm" onClick={() => setShowSettings((v) => !v)}>{showSettings ? 'Volver' : 'Ajustes'}</Button>
          <Button variant="ghost" size="icon" onClick={close} aria-label="Cerrar"><X className="h-5 w-5" /></Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-2xl space-y-4 p-4">
          {showSettings ? (
            <div className="rounded-xl border bg-card p-4"><VoiceSettingsForm /></div>
          ) : (
            <>
              <div className="rounded-xl border bg-card p-4 text-center">
                <p className="text-sm text-muted-foreground">Di todo seguido con palabras clave, por ejemplo:</p>
                <p className="mt-1 text-sm font-medium">«placa A B C uno dos tres, marca Nissan, modelo Versa, color gris, nombre Juan Pérez, teléfono 55…, servicio lavado básico»</p>
                <p className="mt-1 text-xs text-muted-foreground">Para empezar otra orden di <b>«siguiente orden»</b> o toca el botón. Para terminar di «terminar».</p>
                <div className="mt-4 flex items-center justify-center gap-3">
                  {!capturing ? (
                    <Button size="lg" onClick={() => void startCapture()} disabled={!supported} className="h-14 px-8 text-base"><Mic className="h-5 w-5" />{entries.length ? 'Seguir dictando' : 'Empezar a dictar'}</Button>
                  ) : (
                    <>
                      <Button size="lg" variant="outline" onClick={nextOrder} className="h-14 text-base" disabled={!live.trim()}>Siguiente orden</Button>
                      <Button size="lg" variant="destructive" onClick={stopCapture} className="h-14 text-base"><Square className="h-5 w-5" />Terminar</Button>
                    </>
                  )}
                </div>
                {capturing && <p className="mt-3 flex items-center justify-center gap-2 text-sm text-red-600"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />Escuchando…</p>}
                {live && <p className="mt-2 rounded-md bg-muted px-3 py-2 text-left text-sm italic" aria-live="polite">«{live}»</p>}
                {!supported && <p className="mt-3 flex items-center justify-center gap-2 text-sm text-amber-700"><MicOff className="h-4 w-4" />Este navegador no soporta voz (usa Chrome). Puedes escribir el dictado abajo.</p>}
                {!online && supported && <p className="mt-2 text-xs text-sky-700">Sin internet: la voz de Chrome suele necesitar conexión. Escribe el dictado abajo; las órdenes se guardan igual en el dispositivo.</p>}
                {msg && <p className="mt-2 text-sm text-amber-700">{msg}</p>}
              </div>

              <details className="rounded-xl border bg-card p-3" open={!supported}>
                <summary className="cursor-pointer text-sm font-medium">Escribir o pegar el dictado</summary>
                <Textarea aria-label="Texto del dictado" className="mt-2" rows={3} value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="placa ABC123 marca Nissan modelo Versa color gris servicio lavado básico siguiente orden placa …" />
                <Button className="mt-2" size="sm" disabled={!typed.trim()} onClick={() => { addEntries(splitOrders(typed)); setTyped(''); }}>Procesar</Button>
              </details>

              {entries.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Las órdenes dictadas aparecen aquí con los datos ya rellenados.</p>}
              {entries.map((e, n) => {
                const miss = missingOf(e.draft);
                const saved = e.status === 'saved';
                return (
                  <div key={e.id} className={cn('rounded-xl border bg-card p-4', saved && 'opacity-60')}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 text-sm">
                        <p className="font-semibold">Orden {n + 1}{e.draft.plate && <span className="ml-2 font-mono">{e.draft.plate}</span>}</p>
                        <p className="text-muted-foreground">{[e.draft.brand, e.draft.model, e.draft.color].filter(Boolean).join(' ') || 'Sin vehículo'}{e.draft.name && ` · ${e.draft.name}`}{e.known && <span className="ml-1 text-emerald-600">(cliente registrado)</span>}</p>
                        <p>{Object.entries(e.draft.items).map(([id, q]) => `${q}× ${svcName(id)}`).join(', ') || <span className="text-amber-600">Sin servicio</span>}</p>
                      </div>
                      <div className="shrink-0 text-right text-sm">
                        <p className="font-semibold">{money(totalOf(e.draft), currency)}</p>
                        {saved ? <span className="inline-flex items-center gap-1 text-emerald-600"><Check className="h-4 w-4" />Guardada</span> : miss.length > 0 ? <span className="text-amber-600">Falta {miss.join(', ')}</span> : <span className="text-emerald-600">Lista</span>}
                      </div>
                    </div>
                    {e.warnings.map((w) => <p key={w} className="mt-1 text-xs text-amber-600">{w}</p>)}
                    {e.error && <ErrorText error={new Error(e.error)} />}

                    {!saved && e.open && (
                      <div className="mt-3 space-y-3 border-t pt-3">
                        <div className="grid gap-2 sm:grid-cols-3">
                          <div><Label>Placa *</Label><Input aria-label="Placa" value={e.draft.plate} onChange={(ev) => patchDraft(e.id, { plate: ev.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8), clientId: undefined })} className="font-mono uppercase" /></div>
                          <div><Label>Marca *</Label><Combobox value={e.draft.brand} options={brands} onChange={(t) => patchDraft(e.id, { brand: t })} /></div>
                          <div><Label>Modelo *</Label><Combobox value={e.draft.model} options={catalog?.find((b) => b.brand === e.draft.brand)?.models ?? []} onChange={(t) => patchDraft(e.id, { model: t })} /></div>
                          <div><Label>Color *</Label><Combobox value={e.draft.color} options={COLORS} onChange={(t) => patchDraft(e.id, { color: t })} /></div>
                          <div><Label>Nombre</Label><Input aria-label="Nombre" value={e.draft.name} onChange={(ev) => patchDraft(e.id, { name: ev.target.value, clientId: undefined })} /></div>
                          <div><Label>Teléfono</Label><Input aria-label="Teléfono" type="tel" value={e.draft.phone} onChange={(ev) => patchDraft(e.id, { phone: ev.target.value.replace(/\D/g, '').slice(0, 10), clientId: undefined })} /></div>
                        </div>
                        <div>
                          <Label>Servicios *</Label>
                          <div className="flex flex-wrap gap-2">
                            {services.map((s) => (
                              <button key={s.id} type="button" onClick={() => toggleSvc(e.id, s.id)} className={cn('rounded-full border px-3 py-1 text-xs', e.draft.items[s.id] ? 'border-primary bg-primary/10 text-primary' : 'hover:bg-muted')}>{s.name} · {money(s.price, currency)}</button>
                            ))}
                          </div>
                        </div>
                        <div><Label>Observaciones</Label><Input value={e.draft.notes} onChange={(ev) => patchDraft(e.id, { notes: ev.target.value })} /></div>
                      </div>
                    )}

                    {!saved && (
                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <Select className="h-9 w-44 text-xs" aria-label="Método de pago" value={e.draft.method} onChange={(ev) => patchDraft(e.id, { method: ev.target.value })}>
                          {PAY.filter(([k]) => allowLater || k !== 'LATER').map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                        </Select>
                        <Button size="sm" variant="outline" onClick={() => patch(e.id, { open: !e.open })}>{e.open ? 'Ocultar' : 'Corregir'}</Button>
                        <Button size="sm" variant="ghost" onClick={() => setEntries((es) => es.filter((x) => x.id !== e.id))}><Trash2 className="h-4 w-4" />Descartar</Button>
                        <Button size="sm" variant="success" className="ml-auto" disabled={e.status === 'saving' || miss.length > 0} onClick={() => void saveOne(e)}>{e.status === 'saving' ? 'Guardando…' : 'Guardar'}</Button>
                      </div>
                    )}
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      {!showSettings && entries.length > 0 && (
        <footer className="border-t bg-card p-3">
          <div className="mx-auto flex max-w-2xl items-center gap-3">
            <p className="flex-1 text-sm text-muted-foreground">{pendingCount} por guardar · {ready} lista(s)</p>
            <Button size="lg" variant="success" disabled={savingAll || ready === 0} onClick={() => void saveAll()}>{savingAll ? 'Guardando…' : `Guardar ${ready} lista${ready === 1 ? '' : 's'}`}</Button>
            {pendingCount === 0 && <Button size="lg" variant="outline" onClick={close}>Terminar</Button>}
          </div>
        </footer>
      )}
    </div>
  );
}
