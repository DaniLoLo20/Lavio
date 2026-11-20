'use client';
import { Volume2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { DEFAULT_VOICE_SETTINGS, VOICE_LANGS, resetVoiceSettings, saveVoiceSettings, speechOpts, useVoiceSettings, type VoiceSettings } from '@/lib/voice/settings';
import { spanishVoices, speak, voiceGender, type VoiceGender } from '@/lib/voice/speech';

const GENDER_LABEL: Record<VoiceGender, string> = { female: 'Mujer', male: 'Hombre', unknown: 'sin identificar' };

/** Voces en español del dispositivo (la lista llega de forma asíncrona en algunos navegadores). */
function useVoices() {
  const [v, setV] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    const load = () => setV(spanishVoices());
    load();
    try { window.speechSynthesis?.addEventListener('voiceschanged', load); } catch { /* sin síntesis */ }
    return () => { try { window.speechSynthesis?.removeEventListener('voiceschanged', load); } catch { /* sin síntesis */ } };
  }, []);
  return v;
}
import { resetFabPosition } from './draggable-fab';
import { Button, Label, Select } from './ui';

function Toggle({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-start justify-between gap-4 py-2">
      <span><span className="block text-sm font-medium">{label}</span>{hint && <span className="block text-xs text-muted-foreground">{hint}</span>}</span>
      <input type="checkbox" role="switch" aria-label={label} checked={value} onChange={(e) => onChange(e.target.checked)} className="mt-1 h-5 w-9 shrink-0 cursor-pointer accent-[hsl(var(--primary))]" />
    </label>
  );
}

function Slider({ label, hint, value, min, max, step, unit, onChange, zeroLabel }: { label: string; hint?: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void; zeroLabel?: string }) {
  return (
    <div className="py-2">
      <div className="flex items-center justify-between gap-3">
        <Label className="mb-0 text-sm font-medium text-foreground">{label}</Label>
        <span className="text-sm tabular-nums text-muted-foreground">{value === 0 && zeroLabel ? zeroLabel : `${value}${unit}`}</span>
      </div>
      <input type="range" aria-label={label} min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full accent-[hsl(var(--primary))]" />
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Ajustes básicos del Modo Voz (tiempos, voz e idioma). Se guardan en este dispositivo. */
export function VoiceSettingsForm() {
  const s = useVoiceSettings();
  const set = (p: Partial<VoiceSettings>) => saveVoiceSettings(p);
  const voices = useVoices();
  const shownVoices = s.gender === 'any' ? voices : voices.filter((v) => voiceGender(v) === s.gender || (voiceGender(v) === 'unknown' && !voices.some((x) => voiceGender(x) === s.gender)));
  return (
    <div className="divide-y">
      <div className="pb-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Forma de captura</p>
        <div className="mt-2 grid gap-2" role="radiogroup" aria-label="Forma de captura">
          {([['guided', 'Guiado (pregunta por pregunta)', 'Te pregunta servicio, placa, vehículo, cliente… y avanzas con cada respuesta.'], ['dictate', 'Dictado rápido (varias órdenes)', 'Hablas una vez con palabras clave («placa… marca… modelo… color… nombre… teléfono… servicio…») y dices «siguiente orden» para empezar otra. Los datos se rellenan solos y quedan en cola para guardar.']] as const).map(([k, title, hint]) => (
            <label key={k} className={'flex cursor-pointer items-start gap-3 rounded-lg border p-3 ' + (s.mode === k ? 'border-primary bg-primary/5' : '')}>
              <input type="radio" name="voice-mode" checked={s.mode === k} onChange={() => set({ mode: k })} className="mt-1" />
              <span><span className="block text-sm font-medium">{title}</span><span className="block text-xs text-muted-foreground">{hint}</span></span>
            </label>
          ))}
        </div>
      </div>
      <div className="pb-2 pt-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tiempos</p>
        <Slider label="Tiempo entre preguntas" hint="Cuánto se muestra lo entendido antes de pasar a la siguiente pregunta. En 0 avanzas tú con el botón Siguiente." value={s.advanceSec} min={0} max={10} step={0.5} unit=" s" zeroLabel="Manual" onChange={(v) => set({ advanceSec: v })} />
        <Slider label="Pausa antes de escuchar" hint="Espera entre que termina de leer la pregunta y se abre el micrófono." value={s.pauseSec} min={0} max={3} step={0.1} unit=" s" onChange={(v) => set({ pauseSec: v })} />
        <Slider label="Tiempo máximo de escucha" hint="Si no hablas en este tiempo se detiene y puedes repetir." value={s.listenSec} min={5} max={30} step={1} unit=" s" onChange={(v) => set({ listenSec: v })} />
      </div>
      <div className="py-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Voz</p>
        <Toggle label="Leer las preguntas en voz alta" value={s.speakPrompts} onChange={(v) => set({ speakPrompts: v })} />
        <Toggle label="Leer el resumen antes de guardar" value={s.readSummary} onChange={(v) => set({ readSummary: v })} />
        <Toggle label="Guardar con la voz" hint='En el resumen puedes decir "guardar", "corregir" o "cancelar".' value={s.voiceSave} onChange={(v) => set({ voiceSave: v })} />
        <Toggle label="Escuchar automáticamente" hint="Abre el micrófono solo después de cada pregunta. Si lo apagas, tocas el micrófono para hablar." value={s.autoListen} onChange={(v) => set({ autoListen: v })} />
        <div className="py-2">
          <Label>Tipo de voz</Label>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Tipo de voz">
            {([['any', 'Automática'], ['female', 'Mujer'], ['male', 'Hombre']] as const).map(([k, l]) => (
              <label key={k} className={'cursor-pointer rounded-full border px-4 py-1.5 text-sm ' + (s.gender === k ? 'border-primary bg-primary text-primary-foreground' : 'hover:bg-muted')}>
                <input type="radio" name="voice-gender" className="sr-only" checked={s.gender === k} onChange={() => set({ gender: k, voiceName: '' })} />{l}
              </label>
            ))}
          </div>
          {s.gender !== 'any' && voices.length > 0 && !voices.some((v) => voiceGender(v) === s.gender) && (
            <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">Este dispositivo no tiene una voz {s.gender === 'female' ? 'femenina' : 'masculina'} identificable en español; se usará la que haya. Puedes instalar más voces en el sistema.</p>
          )}
        </div>
        <div className="py-2">
          <Label>Voz del dispositivo</Label>
          <Select value={s.voiceName} onChange={(e) => set({ voiceName: e.target.value })} aria-label="Voz del dispositivo">
            <option value="">Automática (la mejor en español)</option>
            {shownVoices.map((v) => <option key={v.name} value={v.name}>{v.name} · {v.lang} · {GENDER_LABEL[voiceGender(v)]}</option>)}
          </Select>
          <p className="text-xs text-muted-foreground">{voices.length ? `${voices.length} voz(es) en español disponibles. El género se deduce del nombre; el navegador no lo informa.` : 'No se detectaron voces en español en este dispositivo.'}</p>
        </div>
        <Slider label="Velocidad (fluidez)" hint="Más lento es más claro; más rápido, más ágil." value={s.rate} min={0.7} max={1.5} step={0.1} unit="×" onChange={(v) => set({ rate: Math.round(v * 10) / 10 })} />
        <Slider label="Tono" hint="Menor = más grave, mayor = más agudo." value={s.pitch} min={0.5} max={1.5} step={0.1} unit="" onChange={(v) => set({ pitch: Math.round(v * 10) / 10 })} />
        <Slider label="Pausa entre frases" hint="Silencio entre una frase y otra al leer el resumen. En 0 lee seguido." value={s.pauseMs} min={0} max={1000} step={100} unit=" ms" zeroLabel="Seguido" onChange={(v) => set({ pauseMs: v })} />
        <div className="py-2">
          <Label>Idioma</Label>
          <Select value={s.lang} onChange={(e) => set({ lang: e.target.value })} aria-label="Idioma">{VOICE_LANGS.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</Select>
        </div>
      </div>
      <div className="flex flex-wrap gap-2 pt-3">
        <Button type="button" variant="outline" size="sm" onClick={() => speak('Así suena la guía del Modo Voz. ¿Cuál es la placa del vehículo?', speechOpts(s))}><Volume2 className="h-4 w-4" />Probar voz</Button>
        <Button type="button" variant="outline" size="sm" onClick={resetFabPosition}>Restablecer posición del botón</Button>
        <Button type="button" variant="ghost" size="sm" onClick={() => { if (JSON.stringify(s) !== JSON.stringify(DEFAULT_VOICE_SETTINGS)) resetVoiceSettings(); }}>Valores originales</Button>
      </div>
      <p className="pt-2 text-xs text-muted-foreground">Estos ajustes solo aplican a este dispositivo.</p>
    </div>
  );
}
