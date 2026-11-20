import { useSyncExternalStore } from 'react';

/** Ajustes básicos del Modo Voz. Se guardan en este dispositivo (localStorage). */
export interface VoiceSettings {
  /** guided = pregunta por pregunta (actual). dictate = dictado libre con palabras clave, varias órdenes en cola */
  mode: 'guided' | 'dictate';
  lang: string;
  /** Leer las preguntas en voz alta */
  speakPrompts: boolean;
  /** Leer el resumen en voz alta antes de guardar */
  readSummary: boolean;
  /** Permitir decir "guardar", "corregir" o "cancelar" en el resumen */
  voiceSave: boolean;
  /** Abrir el micrófono solo después de cada pregunta */
  autoListen: boolean;
  /** Segundos que se muestra lo entendido antes de pasar a la siguiente pregunta (0 = avanzar manualmente) */
  advanceSec: number;
  /** Segundos de pausa entre que termina la pregunta y se abre el micrófono */
  pauseSec: number;
  /** Segundos máximos que escucha cada respuesta */
  listenSec: number;
  /** Velocidad de la voz que lee (1 = normal) */
  rate: number;
  /** Tono de la voz (1 = normal; menor = más grave) */
  pitch: number;
  /** Pausa entre frases al leer, en milisegundos (0 = seguido) */
  pauseMs: number;
  /** Preferencia de voz: cualquiera, femenina o masculina (según lo que el dispositivo ofrezca) */
  gender: 'any' | 'female' | 'male';
  /** Nombre exacto de una voz instalada ('' = automática) */
  voiceName: string;
}

export const DEFAULT_VOICE_SETTINGS: VoiceSettings = {
  mode: 'guided',
  lang: 'es-MX',
  speakPrompts: true,
  readSummary: true,
  voiceSave: true,
  autoListen: true,
  advanceSec: 2.5,
  pauseSec: 0.3,
  listenSec: 12,
  rate: 1,
  pitch: 1,
  pauseMs: 0,
  gender: 'any',
  voiceName: '',
};

export const VOICE_LANGS: [string, string][] = [
  ['es-MX', 'Español (México)'], ['es-US', 'Español (Estados Unidos)'], ['es-ES', 'Español (España)'],
  ['es-AR', 'Español (Argentina)'], ['es-CO', 'Español (Colombia)'],
];

const KEY = 'al_voice_settings';
const num = (v: unknown, min: number, max: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(Math.max(n, min), max) : d;
};
const bool = (v: unknown, d: boolean) => (typeof v === 'boolean' ? v : d);

function sanitize(p: Partial<VoiceSettings>): VoiceSettings {
  const d = DEFAULT_VOICE_SETTINGS;
  return {
    mode: p.mode === 'dictate' ? 'dictate' : 'guided',
    lang: VOICE_LANGS.some(([c]) => c === p.lang) ? (p.lang as string) : d.lang,
    speakPrompts: bool(p.speakPrompts, d.speakPrompts),
    readSummary: bool(p.readSummary, d.readSummary),
    voiceSave: bool(p.voiceSave, d.voiceSave),
    autoListen: bool(p.autoListen, d.autoListen),
    advanceSec: num(p.advanceSec, 0, 10, d.advanceSec),
    pauseSec: num(p.pauseSec, 0, 3, d.pauseSec),
    listenSec: num(p.listenSec, 5, 30, d.listenSec),
    rate: num(p.rate, 0.7, 1.5, d.rate),
    pitch: num(p.pitch, 0.5, 1.5, d.pitch),
    pauseMs: num(p.pauseMs, 0, 1000, d.pauseMs),
    gender: p.gender === 'female' || p.gender === 'male' ? p.gender : 'any',
    voiceName: typeof p.voiceName === 'string' ? p.voiceName.slice(0, 200) : '',
  };
}

let cache: VoiceSettings = DEFAULT_VOICE_SETTINGS;
let loaded = false;
const subs = new Set<() => void>();

function load() {
  loaded = true;
  try {
    const raw = localStorage.getItem(KEY);
    const stored = raw ? JSON.parse(raw) : {};
    // compatibilidad: el interruptor de guía de voz de la versión anterior
    if (!raw && localStorage.getItem('al_voice_tts') === '0') stored.speakPrompts = false;
    cache = sanitize(stored);
  } catch {
    cache = DEFAULT_VOICE_SETTINGS;
  }
}

export function getVoiceSettings(): VoiceSettings {
  if (!loaded && typeof window !== 'undefined') load();
  return cache;
}

export function saveVoiceSettings(patch: Partial<VoiceSettings>) {
  cache = sanitize({ ...getVoiceSettings(), ...patch });
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* sin almacenamiento */ }
  subs.forEach((l) => l());
}

export function resetVoiceSettings() {
  try { localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ }
  cache = DEFAULT_VOICE_SETTINGS;
  subs.forEach((l) => l());
}

export const useVoiceSettings = (): VoiceSettings =>
  useSyncExternalStore((l) => { subs.add(l); return () => { subs.delete(l); }; }, getVoiceSettings, () => DEFAULT_VOICE_SETTINGS);

/** Opciones de lectura en voz alta a partir de los ajustes. */
export const speechOpts = (s: VoiceSettings) => ({ lang: s.lang, rate: s.rate, pitch: s.pitch, pauseMs: s.pauseMs, gender: s.gender, voiceName: s.voiceName });
