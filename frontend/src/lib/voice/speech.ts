// Envoltorio de la Web Speech API (SpeechRecognition + speechSynthesis) del propio navegador.
// No se usa ningun servicio propio ni de terceros: el audio lo procesa el navegador/sistema.
// OJO: en Chrome el reconocimiento normalmente se hace en servidores de Google (necesita internet).
// Si el navegador tiene el paquete de idioma instalado se usa reconocimiento local (`processLocally`).

type SRCtor = (new () => any) & { available?: (o: { langs: string[]; processLocally: boolean }) => Promise<string> };

export const getSR = (): SRCtor | null =>
  typeof window === 'undefined' ? null : ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition || null);

export const speechSupported = () => !!getSR();

export type ListenFail = 'no-speech' | 'denied' | 'network' | 'mic' | 'aborted' | 'unsupported' | 'error';
export type ListenResult = { ok: true; text: string } | { ok: false; reason: ListenFail; detail?: string };

export function createListener() {
  let rec: any = null;
  let cancel: (() => void) | null = null;

  function stop() {
    cancel?.();
    try { rec?.abort?.(); } catch { /* ya detenido */ }
    rec = null;
  }

  function listen(opts: { lang?: string; onInterim?: (t: string) => void; maxMs?: number; continuous?: boolean } = {}): Promise<ListenResult> {
    const SR = getSR();
    if (!SR) return Promise.resolve({ ok: false, reason: 'unsupported' });
    stop();

    return new Promise<ListenResult>((resolve) => {
      let done = false;
      let finalText = '';
      let interim = '';
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (r: ListenResult) => {
        if (done) return;
        done = true;
        if (timer) clearTimeout(timer);
        cancel = null;
        resolve(r);
      };
      cancel = () => finish({ ok: false, reason: 'aborted' });

      const r = new SR();
      rec = r;
      r.lang = opts.lang ?? 'es-MX';
      r.interimResults = true;
      r.continuous = opts.continuous ?? false;
      r.maxAlternatives = 1;

      const start = () => {
        r.onresult = (e: any) => {
          let f = '', i2 = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            const res = e.results[i];
            const tx = res[0]?.transcript ?? '';
            if (res.isFinal) f += tx; else i2 += tx;
          }
          if (f) finalText = `${finalText} ${f}`.trim();
          interim = i2;
          opts.onInterim?.(`${finalText} ${i2}`.trim());
        };
        r.onerror = (e: any) => {
          const c = e?.error;
          finish({
            ok: false,
            reason: c === 'no-speech' ? 'no-speech' : c === 'not-allowed' || c === 'service-not-allowed' ? 'denied' : c === 'network' ? 'network' : c === 'audio-capture' ? 'mic' : c === 'aborted' ? 'aborted' : 'error',
            detail: c,
          });
        };
        r.onend = () => {
          const t = (finalText || interim).trim();
          finish(t ? { ok: true, text: t } : { ok: false, reason: 'no-speech' });
        };
        timer = setTimeout(() => { try { r.stop(); } catch { /* ya detenido */ } }, opts.maxMs ?? 12_000);
        try { r.start(); } catch (e) { finish({ ok: false, reason: 'error', detail: String(e) }); }
      };

      // Reconocimiento en el dispositivo (sin internet) si el navegador ya tiene el paquete de idioma
      Promise.resolve()
        .then(async () => {
          if (typeof SR.available === 'function' && 'processLocally' in r) {
            const a = await SR.available({ langs: [r.lang as string], processLocally: true });
            if (a === 'available') r.processLocally = true;
          }
        })
        .catch(() => undefined)
        .then(start);
    });
  }

  /** Termina la escucha conservando lo ya entendido (stop() la descarta). */
  function end() {
    try { rec?.stop?.(); } catch { /* ya detenido */ }
  }

  return { listen, stop, end };
}

export function cancelSpeech() {
  try { window.speechSynthesis?.cancel(); } catch { /* sin sintesis */ }
}

// ---- Voces del dispositivo -------------------------------------------------------------------------------
// La API del navegador NO informa el género de una voz. Se infiere por el nombre (las voces de Windows, macOS,
// Android y Chrome tienen nombres propios conocidos); si no se reconoce, queda como «sin identificar».
const FEMALE = /\b(sabina|paulina|helena|laura|monica|mónica|marisol|elena|lucia|lucía|carmen|isabela|valentina|camila|dalia|elvira|ximena|marina|salome|salomé|paloma|esperanza|catalina|fernanda|jimena|lupe|luciana|marta|paola|francisca|florencia|angelica|angélica|mia|female|mujer|femenin[ao]|google espa[nñ]ol)\b/i;
const MALE = /\b(pablo|raul|raúl|jorge|diego|juan|carlos|enrique|miguel|alvaro|álvaro|arnau|gonzalo|tomas|tomás|andres|andrés|jaime|mateo|emilio|sergio|pedro|alberto|male|hombre|masculin[ao])\b/i;
export type VoiceGender = 'female' | 'male' | 'unknown';
export const voiceGender = (v: { name: string }): VoiceGender => (MALE.test(v.name) ? 'male' : FEMALE.test(v.name) ? 'female' : 'unknown');

export const spanishVoices = (): SpeechSynthesisVoice[] => {
  try { return (window.speechSynthesis?.getVoices() ?? []).filter((v) => v.lang.toLowerCase().startsWith('es')); } catch { return []; }
};

export interface SpeakOpts { lang?: string; rate?: number; pitch?: number; pauseMs?: number; gender?: 'any' | 'female' | 'male'; voiceName?: string }

/** Elige la voz: la indicada por nombre; si no, según el género y el idioma; si no, cualquiera en español. */
export function pickVoice(opts: SpeakOpts): SpeechSynthesisVoice | undefined {
  const lang = (opts.lang ?? 'es-MX').toLowerCase();
  const all = (() => { try { return window.speechSynthesis?.getVoices() ?? []; } catch { return []; } })();
  if (opts.voiceName) { const named = all.find((v) => v.name === opts.voiceName); if (named) return named; }
  const es = all.filter((v) => v.lang.toLowerCase().startsWith('es'));
  const pool = opts.gender && opts.gender !== 'any' ? es.filter((v) => voiceGender(v) === opts.gender) : es;
  const base = pool.length ? pool : es;
  return base.find((v) => v.lang.toLowerCase() === lang) ?? base.find((v) => v.lang.toLowerCase().replace('_', '-').startsWith(lang.slice(0, 2))) ?? base[0];
}

/** Lee un texto en voz alta (guía). Frases con pausa configurable. Siempre termina, aunque el navegador no emita el evento de fin. */
export function speak(text: string, opts: SpeakOpts = {}): Promise<void> {
  const lang = opts.lang ?? 'es-MX';
  const s = typeof window === 'undefined' ? null : window.speechSynthesis;
  if (!s || typeof SpeechSynthesisUtterance === 'undefined') return Promise.resolve();
  const rate = opts.rate ?? 1;
  const parts = opts.pauseMs && opts.pauseMs > 0 ? text.split(/(?<=[.!?…])\s+/).filter(Boolean) : [text];
  const voice = pickVoice(opts);

  const one = (chunk: string) => new Promise<void>((resolve) => {
    try {
      const u = new SpeechSynthesisUtterance(chunk);
      u.lang = voice?.lang ?? lang;
      u.rate = rate;
      u.pitch = opts.pitch ?? 1;
      if (voice) u.voice = voice;
      const t = setTimeout(resolve, 3000 + (chunk.length * 90) / rate);
      u.onend = () => { clearTimeout(t); resolve(); };
      u.onerror = () => { clearTimeout(t); resolve(); };
      s.speak(u);
    } catch { resolve(); }
  });

  return (async () => {
    try { s.cancel(); } catch { /* sin síntesis */ }
    for (let i = 0; i < parts.length; i++) {
      await one(parts[i]);
      if (opts.pauseMs && i < parts.length - 1) await new Promise((r) => setTimeout(r, opts.pauseMs));
    }
  })();
}