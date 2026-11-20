// Interpretacion de lo dicho por voz. Reglas deterministas (diccionarios y expresiones regulares):
// sin IA, sin LLM y sin servicios externos. Funciones puras, faciles de probar.

export const norm = (s: string) =>
  s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();

const UNITS: Record<string, number> = { cero: 0, uno: 1, un: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9 };
const TEENS: Record<string, number> = {
  diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19,
  veinte: 20, veintiuno: 21, veintiun: 21, veintidos: 22, veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26,
  veintisiete: 27, veintiocho: 28, veintinueve: 29,
};
const TENS: Record<string, number> = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };

/** Convierte tokens numericos en digitos ("treinta y cuatro" -> "34", "doble cinco" -> "55"). Devuelve [digitos, tokens consumidos]. */
function digitsAt(tokens: string[], i: number): [string, number] | null {
  const t = tokens[i];
  if (/^\d+$/.test(t)) return [t, 1];
  if ((t === 'doble' || t === 'triple') && tokens[i + 1] in UNITS) {
    return [String(UNITS[tokens[i + 1]]).repeat(t === 'doble' ? 2 : 3), 2];
  }
  if (t in TENS) {
    const u = tokens[i + 2] in UNITS && UNITS[tokens[i + 2]] > 0 ? UNITS[tokens[i + 2]] : 0;
    if (tokens[i + 1] === 'y' && u) return [String(TENS[t] + u), 3];
    return [String(TENS[t]), 1];
  }
  if (t in TEENS) return [String(TEENS[t]), 1];
  if (t in UNITS) return [String(UNITS[t]), 1];
  return null;
}

export function spokenDigits(text: string): string {
  const tokens = norm(text).split(' ').filter(Boolean);
  let out = '';
  for (let i = 0; i < tokens.length; ) {
    const d = digitsAt(tokens, i);
    if (d) { out += d[0]; i += d[1]; } else i++;
  }
  return out;
}

/* ───────────────────────── placa ───────────────────────── */

const LETTERS: Record<string, string> = {
  a: 'A', be: 'B', b: 'B', ce: 'C', c: 'C', de: 'D', d: 'D', e: 'E', efe: 'F', f: 'F', ge: 'G', g: 'G', hache: 'H', h: 'H', i: 'I',
  jota: 'J', j: 'J', ka: 'K', k: 'K', ele: 'L', l: 'L', eme: 'M', m: 'M', ene: 'N', n: 'N', o: 'O', pe: 'P', p: 'P', cu: 'Q', q: 'Q',
  erre: 'R', ere: 'R', r: 'R', ese: 'S', s: 'S', te: 'T', t: 'T', u: 'U', uve: 'V', ve: 'V', v: 'V', equis: 'X', x: 'X', ye: 'Y', zeta: 'Z', z: 'Z', w: 'W',
  alfa: 'A', bravo: 'B', charlie: 'C', delta: 'D', eco: 'E', echo: 'E', foxtrot: 'F', golf: 'G', hotel: 'H', india: 'I', juliet: 'J', kilo: 'K',
  lima: 'L', mike: 'M', november: 'N', oscar: 'O', papa: 'P', quebec: 'Q', romeo: 'R', sierra: 'S', tango: 'T', uniforme: 'U', victor: 'V',
  whisky: 'W', xray: 'X', yankee: 'Y', zulu: 'Z',
};
const PLATE_STOP = new Set(['placa', 'placas', 'es', 'la', 'el', 'mi', 'son', 'numero', 'letra', 'letras', 'con', 'y', 'las', 'los', 'del', 'guion', 'guiones', 'menos', 'son']);

export function parsePlate(text: string): { value: string; valid: boolean } {
  const tokens = norm(text).split(' ').filter(Boolean);
  let out = '';
  for (let i = 0; i < tokens.length; ) {
    const t = tokens[i];
    if (t === 'doble' && (tokens[i + 1] === 've' || tokens[i + 1] === 'u')) { out += 'W'; i += 2; continue; }
    if (t === 'doble' && tokens[i + 1] in LETTERS) { out += LETTERS[tokens[i + 1]].repeat(2); i += 2; continue; }
    if (t === 'griega') { if (out.endsWith('I')) out = out.slice(0, -1) + 'Y'; i++; continue; }
    const d = digitsAt(tokens, i);
    if (d) { out += d[0]; i += d[1]; continue; }
    if (t in LETTERS) { out += LETTERS[t]; i++; continue; }
    if (PLATE_STOP.has(t)) { i++; continue; }
    if (/^[a-z0-9]{2,8}$/.test(t)) out += t.toUpperCase(); // ya viene deletreada como "abc123"
    i++;
  }
  out = out.replace(/[^A-Z0-9]/g, '').slice(0, 8);
  return { value: out, valid: out.length >= 3 && out.length <= 8 };
}

/* ───────────────────────── nombre, telefono, observaciones ───────────────────────── */

export function parseName(text: string): string {
  const s = text.trim().replace(/^(?:hola\s+)?(?:me llamo|mi nombre es|el nombre es|se llama|el cliente es|cliente|nombre|soy)\s+/i, '').replace(/[.,;:!?]+$/g, '');
  return s.toLowerCase().split(/\s+/).filter(Boolean).map((w) => w[0].toLocaleUpperCase('es') + w.slice(1)).join(' ');
}

export function parsePhone(text: string): { value: string; valid: boolean } {
  let d = spokenDigits(text);
  if (d.length === 12 && d.startsWith('52')) d = d.slice(2);
  if (d.length > 10) d = d.slice(-10);
  return { value: d, valid: d.length === 10 };
}

const NO_NOTES = new Set(['ninguna', 'ninguno', 'nada', 'no', 'sin', 'sin observaciones', 'sin observacion', 'no hay', 'no tiene', 'ninguna observacion', 'ninguna observaciones']);
export function parseNotes(text: string): string {
  const n = norm(text);
  if (NO_NOTES.has(n)) return '';
  const s = text.trim().replace(/[.]+$/g, '');
  return s ? s[0].toLocaleUpperCase('es') + s.slice(1) : '';
}

/* ───────────────────────── comandos de voz ───────────────────────── */

export type VoiceCommand = 'cancel' | 'repeat' | 'back' | 'skip' | null;
const CMD: Record<string, VoiceCommand> = {
  cancelar: 'cancel', salir: 'cancel', terminar: 'cancel', 'cancelar todo': 'cancel',
  repetir: 'repeat', repite: 'repeat', 'otra vez': 'repeat', 'repetir pregunta': 'repeat',
  atras: 'back', anterior: 'back', regresar: 'back', volver: 'back',
  saltar: 'skip', omitir: 'skip', pasar: 'skip', siguiente: 'skip', 'sin dato': 'skip', 'no se': 'skip', 'no tiene': 'skip',
};
/** Solo cuenta como comando si toda la frase lo es (asi "no tiene antena" en observaciones no se confunde). */
export function detectCommand(text: string): VoiceCommand {
  return CMD[norm(text)] ?? null;
}

/* ───────────────────────── servicios ───────────────────────── */

const SVC_STOP = new Set(['de', 'del', 'la', 'el', 'y', 'con', 'para', 'por', 'un', 'una', 'los', 'las']);
const stem = (w: string) => (w.length > 4 ? w.replace(/(es|s)$/, '') : w);

export interface ServiceMatch { id: string; name: string; qty: number }

export function parseServices(text: string, services: { id: string; name: string }[]): { items: ServiceMatch[]; ambiguous: { id: string; name: string }[] } {
  const words = norm(text).split(' ').filter(Boolean);
  const heard = words.map(stem);
  const sigOf = (name: string) => [...new Set(norm(name).split(' ').filter((w) => w && !SVC_STOP.has(w)).map(stem))];

  const scored = services.map((s) => {
    const sig = sigOf(s.name);
    const found = sig.filter((t) => heard.includes(t));
    return { s, sig, found, score: sig.length ? found.length / sig.length : 0 };
  });

  let chosen = scored.filter((x) => x.sig.length > 0 && x.found.length === x.sig.length);
  // Si "Lavado" completo esta contenido en "Lavado Premium" completo, se queda el mas especifico
  chosen = chosen.filter((x) => !chosen.some((y) => y !== x && y.sig.length > x.sig.length && x.sig.every((t) => y.sig.includes(t))));

  let ambiguous: { id: string; name: string }[] = [];
  if (!chosen.length) {
    const partial = scored.filter((x) => x.found.length > 0 && x.score >= 0.5);
    const best = Math.max(0, ...partial.map((x) => x.score));
    const top = partial.filter((x) => x.score === best);
    if (top.length === 1) chosen = top;
    else if (top.length > 1) ambiguous = top.map((x) => ({ id: x.s.id, name: x.s.name }));
  }

  const items = chosen.map((x) => {
    // cantidad = numero dicho justo antes del primer termino del servicio ("dos aspirados")
    const idx = Math.min(...x.found.map((t) => heard.indexOf(t)));
    const prev = words[idx - 1];
    let qty = 1;
    if (prev && /^\d+$/.test(prev)) qty = Math.min(Math.max(Number(prev), 1), 99);
    else if (prev && prev in UNITS && UNITS[prev] > 0) qty = UNITS[prev];
    return { id: x.s.id, name: x.s.name, qty };
  });
  return { items, ambiguous };
}

/* ───────────────────────── marca / modelo / color (resumen) ───────────────────────── */

const BRAND_ALIASES: Record<string, string> = { vw: 'Volkswagen', volks: 'Volkswagen', chevy: 'Chevrolet', mercedes: 'Mercedes-Benz', benz: 'Mercedes-Benz', mb: 'Mercedes-Benz', landrover: 'Land Rover', gm: 'Chevrolet' };

const title = (s: string) => s.trim().split(/\s+/).map((w) => w[0].toLocaleUpperCase('es') + w.slice(1).toLowerCase()).join(' ');

export function matchCatalogValue(text: string, options: string[], aliases: Record<string, string> = {}): string {
  const n = norm(text).replace(/^(?:es|de|la|el|marca|modelo|color)\s+/, '');
  if (!n) return '';
  const compact = n.replace(/\s/g, '');
  const alias = aliases[compact];
  if (alias && options.includes(alias)) return alias;
  const exact = options.find((o) => norm(o) === n || norm(o).replace(/\s/g, '') === compact);
  if (exact) return exact;
  const starts = options.filter((o) => norm(o).startsWith(n));
  if (starts.length === 1) return starts[0];
  return title(text.replace(/^(?:es|de|la|el|marca|modelo|color)\s+/i, ''));
}
export const matchBrand = (text: string, brands: string[]) => matchCatalogValue(text, brands, BRAND_ALIASES);

export const COLORS = ['Blanco', 'Negro', 'Gris', 'Plata', 'Rojo', 'Azul', 'Verde', 'Amarillo', 'Naranja', 'Café', 'Beige', 'Dorado', 'Vino', 'Morado'];

/* ───────────────────────── vehículo en una sola frase ───────────────────────── */

const VEH_FILLER = new Set(['es', 'un', 'una', 'el', 'la', 'los', 'las', 'de', 'del', 'color', 'colores', 'marca', 'modelo', 'mi', 'carro', 'coche', 'auto', 'vehiculo', 'camioneta', 'y', 'con', 'tipo', 'version', 'pues', 'este', 'seria', 'su', 'lo', 'que', 'en', 'pickup', 'sedan']);
const COLOR_WORDS: Record<string, string> = {
  blanco: 'Blanco', blanca: 'Blanco', negro: 'Negro', negra: 'Negro', gris: 'Gris', plata: 'Plata', plateado: 'Plata', plateada: 'Plata',
  rojo: 'Rojo', roja: 'Rojo', azul: 'Azul', verde: 'Verde', amarillo: 'Amarillo', amarilla: 'Amarillo', naranja: 'Naranja', anaranjado: 'Naranja',
  cafe: 'Café', marron: 'Café', beige: 'Beige', dorado: 'Dorado', dorada: 'Dorado', vino: 'Vino', guinda: 'Vino', morado: 'Morado', morada: 'Morado',
  violeta: 'Morado', rosa: 'Rosa', turquesa: 'Turquesa', champagne: 'Champagne',
};
const COLOR_MOD = new Set(['oscuro', 'oscura', 'claro', 'clara', 'marino', 'marina', 'metalico', 'metalica', 'perla', 'mate', 'brillante', 'cielo', 'electrico']);

interface Tok { n: string; o: string }
const cap = (s: string) => (s ? s[0].toLocaleUpperCase('es') + s.slice(1) : s);

/**
 * Separa marca, modelo y color de UNA frase ("nissan versa gris", "es un mazda tres rojo", "vw vento blanco").
 * Usa el catálogo de marcas/modelos, alias (vw, chevy), números en palabras ("mazda tres") y deduce la marca por el
 * modelo cuando es único ("aveo azul"). Lo que no logre clasificar queda vacío para pedirlo de nuevo.
 */
export function parseVehicle(text: string, catalog: { brand: string; models: string[] }[]): { brand: string; model: string; color: string } {
  const nTok = norm(text).split(' ').filter(Boolean);
  const oRaw = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const oTok = oRaw.length === nTok.length ? oRaw : nTok;
  let toks: Tok[] = nTok.map((n, i) => ({ n: n in UNITS && n !== 'un' && n !== 'una' ? String(UNITS[n]) : n, o: oTok[i] }));

  // color (se busca desde el final, que es donde se dice normalmente) + modificadores ("azul marino")
  let color = '';
  for (let i = toks.length - 1; i >= 0; i--) {
    const c = COLOR_WORDS[toks[i].n];
    if (!c) continue;
    const mods: string[] = [];
    let j = i + 1;
    while (j < toks.length && COLOR_MOD.has(toks[j].n) && mods.length < 2) { mods.push(toks[j].o); j++; }
    color = mods.length ? `${c} ${mods.join(' ')}` : c;
    toks.splice(i, 1 + mods.length);
    break;
  }
  if (!color) {
    const k = toks.findIndex((t) => t.n === 'color');
    if (k >= 0 && toks[k + 1]) { color = cap(toks[k + 1].o); toks.splice(k, 2); }
  }
  toks = toks.filter((t) => !VEH_FILLER.has(t.n));

  // marca: secuencia completa más larga ("land rover"), si no, alias ("vw")
  const names = catalog.map((b) => b.brand);
  let best: { brand: string; at: number; len: number } | null = null;
  const seqAt = (seq: string[], at: number) => seq.every((s, k) => toks[at + k]?.n === s);
  for (const b of catalog) {
    const t = norm(b.brand).split(' ');
    for (let p = 0; p <= toks.length - t.length; p++) {
      if (seqAt(t, p) && (!best || t.length > best.len || (t.length === best.len && p < best.at))) best = { brand: b.brand, at: p, len: t.length };
    }
  }
  if (!best) {
    for (let p = 0; p < toks.length; p++) {
      const target = BRAND_ALIASES[toks[p].n];
      if (target && names.includes(target)) { best = { brand: target, at: p, len: toks[p + 1]?.n === 'benz' ? 2 : 1 }; break; }
    }
  }
  if (best) toks.splice(best.at, best.len);

  // modelo: coincidencia (ignorando espacios: "x trail" = "xtrail") con los modelos de la marca
  const findModel = (models: string[]) => {
    let found: { model: string; at: number; len: number; score: number } | null = null;
    for (const m of models) {
      const joined = norm(m).replace(/\s/g, '');
      if (!joined) continue;
      for (let p = 0; p < toks.length; p++) {
        let acc = '';
        for (let L = 1; L <= 4 && p + L <= toks.length; L++) {
          acc += toks[p + L - 1].n;
          if (acc === joined && (!found || joined.length > found.score)) found = { model: m, at: p, len: L, score: joined.length };
          if (acc.length > joined.length) break;
        }
      }
    }
    return found;
  };

  let brand = best?.brand ?? '';
  let model = '';
  if (brand) {
    const f = findModel(catalog.find((b) => b.brand === brand)?.models ?? []);
    if (f) model = f.model;
    else model = toks.map((t) => cap(t.o)).join(' ');
  } else {
    const hits = catalog.map((b) => ({ b, f: findModel(b.models) })).filter((x) => x.f && x.f.score >= 3);
    if (hits.length === 1) { brand = hits[0].b.brand; model = hits[0].f!.model; }
    else if (hits.length === 0 && toks.length) { brand = cap(toks[0].o); model = toks.slice(1).map((t) => cap(t.o)).join(' '); }
  }
  return { brand, model, color };
}

/* ───────────────────────── comandos del resumen ───────────────────────── */

export type SummaryCommand = 'save' | 'edit' | 'cancel' | 'repeat' | null;
const SAVE = new Set(['guardar', 'guarda', 'guardala', 'si', 'si guardar', 'si guarda', 'confirmar', 'confirmo', 'confirma', 'aceptar', 'acepto', 'listo', 'correcto', 'esta bien', 'todo bien', 'dale', 'ok', 'okay', 'de acuerdo', 'guardar orden', 'guarda la orden', 'si correcto', 'si es correcto', 'si confirmo']);
const EDIT = new Set(['corregir', 'corrige', 'editar', 'modificar', 'cambiar', 'no', 'no guardar', 'corregir datos', 'editar datos']);
const CANCEL = new Set(['cancelar', 'cancela', 'salir', 'cancelar orden', 'terminar']);
const REPEAT = new Set(['repetir', 'repite', 'leer', 'lee', 'leer de nuevo', 'otra vez', 'leer resumen', 'repetir resumen']);

/** Frases cortas que significan guardar / corregir / cancelar / repetir la lectura. */
export function detectSummaryCommand(text: string): SummaryCommand {
  const n = norm(text);
  if (SAVE.has(n)) return 'save';
  if (EDIT.has(n)) return 'edit';
  if (CANCEL.has(n)) return 'cancel';
  if (REPEAT.has(n)) return 'repeat';
  const words = n.split(' ');
  if (words.length <= 3) {
    if (words.includes('guardar') || words.includes('guarda')) return 'save';
    if (words.includes('corregir') || words.includes('editar')) return 'edit';
    if (words.includes('cancelar')) return 'cancel';
  }
  return null;
}