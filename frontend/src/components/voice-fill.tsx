'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Mic, MicOff, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { createListener, speak, cancelSpeech, speechSupported } from '@/lib/voice/speech';
import { parsePlate } from '@/lib/voice/parsers';
import { parseDictation } from '@/lib/voice/dictation';
import { speechOpts, useVoiceSettings } from '@/lib/voice/settings';

export type FillField = 'placa' | 'marca' | 'modelo' | 'color';
type Catalog = { brand: string; models: string[] }[];

const join = (a: string[]) => (a.length <= 1 ? a.join('') : `${a.slice(0, -1).join(', ')} y ${a[a.length - 1]}`);
const ART: Record<FillField, string> = { placa: 'la placa', marca: 'la marca', modelo: 'el modelo', color: 'el color' };
export const question = (missing: FillField[]) => `No pude leer ${join(missing.map((m) => ART[m]))}. ${missing.length > 1 ? 'Dímelos' : 'Dímelo'}.`;

/** Interpreta la respuesta y devuelve solo los campos que faltaban. */
export function interpretFill(text: string, missing: FillField[], catalog: Catalog): Partial<Record<'plate' | 'brand' | 'model' | 'color', string>> {
  const out: Partial<Record<'plate' | 'brand' | 'model' | 'color', string>> = {};
  const onlyPlate = missing.length === 1 && missing[0] === 'placa';
  if (onlyPlate) { const p = parsePlate(text); if (p.valid) out.plate = p.value; return out; }
  const d = parseDictation(text, { services: [], catalog }).draft;
  if (missing.includes('placa') && d.plate) out.plate = d.plate;
  if (missing.includes('marca') && d.brand) out.brand = d.brand;
  if (missing.includes('modelo') && d.model) out.model = d.model;
  if (missing.includes('color') && d.color) out.color = d.color;
  return out;
}

/**
 * Mini asistente de voz dentro de la venta: pregunta en voz alta SOLO lo que la foto no pudo leer y abre el
 * micrófono solo. Rellena los campos con la respuesta; si aún falta algo, vuelve a preguntar una vez.
 */
export function VoiceFill({ missing, catalog, onFill, onClose }: {
  missing: FillField[];
  catalog: Catalog;
  onFill: (f: Partial<Record<'plate' | 'brand' | 'model' | 'color', string>>) => void;
  onClose: () => void;
}) {
  const settings = useVoiceSettings();
  const sRef = useRef(settings); sRef.current = settings;
  const supported = useMemo(() => speechSupported(), []);
  const listener = useRef(createListener()).current;
  const [left, setLeft] = useState<FillField[]>(missing);
  const [status, setStatus] = useState<'speaking' | 'listening' | 'idle' | 'done'>('idle');
  const [heard, setHeard] = useState('');
  const [note, setNote] = useState('');
  const run = useRef(0);

  async function ask(fields: FillField[], attempt: number) {
    const my = ++run.current;
    setNote(''); setHeard('');
    if (sRef.current.speakPrompts) { setStatus('speaking'); await speak(question(fields), speechOpts(sRef.current)); }
    if (my !== run.current) return;
    if (!supported) { setStatus('idle'); setNote('Este navegador no soporta voz: escribe los datos.'); return; }
    setStatus('listening');
    const r = await listener.listen({ lang: sRef.current.lang, maxMs: sRef.current.listenSec * 1000, onInterim: (t) => my === run.current && setHeard(t) });
    if (my !== run.current) return;
    if (!r.ok) {
      setStatus('idle');
      setNote(r.reason === 'no-speech' ? 'No te escuché. Toca el micrófono para intentar de nuevo.' : r.reason === 'denied' ? 'El navegador bloqueó el micrófono.' : 'No pude usar el micrófono. Escribe los datos.');
      return;
    }
    setHeard(r.text);
    const f = interpretFill(r.text, fields, catalog);
    onFill(f);
    const got: Record<FillField, boolean> = { placa: !!f.plate, marca: !!f.brand, modelo: !!f.model, color: !!f.color };
    const still = fields.filter((x) => !got[x]);
    setLeft(still);
    if (!still.length) { setStatus('done'); return; }
    if (attempt < 1) void ask(still, attempt + 1);
    else { setStatus('idle'); setNote(`Me falta ${join(still.map((m) => ART[m]))}. Toca el micrófono o escríbelo.`); }
  }

  useEffect(() => {
    void ask(missing, 0);
    return () => { run.current++; listener.stop(); cancelSpeech(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { if (status === 'done') { const t = setTimeout(onClose, 1500); return () => clearTimeout(t); } }, [status, onClose]);

  const listening = status === 'listening';
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-2.5" role="status" aria-live="polite" data-testid="voice-fill">
      <button type="button" aria-label={listening ? 'Escuchando' : 'Hablar'} disabled={!supported || status === 'speaking' || status === 'done'} onClick={() => void ask(left, 1)}
        className={cn('relative grid h-11 w-11 shrink-0 place-items-center rounded-full text-white shadow transition active:scale-95 disabled:opacity-60', status === 'done' ? 'bg-emerald-500' : listening ? 'bg-red-500' : 'bg-primary')}>
        {listening && <span className="absolute inset-0 animate-ping rounded-full bg-red-500/40" />}
        {status === 'done' ? <Check className="relative h-5 w-5" /> : supported ? <Mic className="relative h-5 w-5" /> : <MicOff className="h-5 w-5" />}
      </button>
      <div className="min-w-0 flex-1 text-sm">
        <p className="font-medium">{status === 'done' ? '¡Listo! Datos completados por voz.' : left.length ? question(left) : 'Listo.'}</p>
        <p className="truncate text-xs text-muted-foreground">{heard ? `Escuché: “${heard}”` : note || (status === 'speaking' ? 'Preguntando…' : listening ? 'Escuchando… habla ahora' : '')}</p>
      </div>
      <button type="button" aria-label="Cerrar asistente" onClick={() => { run.current++; listener.stop(); cancelSpeech(); onClose(); }} className="shrink-0 text-muted-foreground"><X className="h-4 w-4" /></button>
    </div>
  );
}
