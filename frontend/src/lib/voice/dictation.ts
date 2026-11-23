// Dictado libre: una frase natural como «Un Versa gris, placas ABC-123, lavado básico para Juan Pérez».
// Reglas deterministas sobre el texto reconocido (sin IA ni servicios externos): se localizan placa, teléfono,
// servicios, nombre y método de pago, y lo que sobra se interpreta como vehículo (marca, modelo y color).
// Varias órdenes en una misma grabación se separan con «siguiente orden». Funciones puras.
import { COLORS, LETTERS, norm, parseName, parseServices, parseVehicle, spokenDigits } from './parsers';
import { findByExactName, findByPhone, findByPlate, type ClientLite } from '../client-match';

export interface DictDraft {
  plate: string; brand: string; model: string; color: string;
  name: string; phone: string; notes: string;
  items: Record<string, number>;
  method: string;
  clientId?: string;
}
export type Catalog = { brand: string; models: string[] }[];
type Svc = { id: string; name: string };

export const emptyDictDraft = (method = 'CASH'): DictDraft => ({ plate: '', brand: '', model: '', color: '', name: '', phone: '', notes: '', items: {}, method });

/** "siguiente orden", "otra orden", "nueva orden", "siguiente carro/auto/coche/vehículo" o solo "siguiente". */
export const NEXT_MARKER = /\b(?:(?:siguiente|otra|otro|nueva|nuevo)\s+(?:orden|carro|auto|coche|veh[ií]culo)|siguiente)\b[.,;:!?]*/gi;
export const END_MARKER = /\b(?:terminar dictado|fin del dictado|terminar|eso es todo)\b[.,;:!?]*/i;

/** Parte un dictado en órdenes. Los segmentos vacíos se descartan. */
export function splitOrders(text: string): string[] {
  return text.split(NEXT_MARKER).map((s) => s.trim()).filter(Boolean);
}

/** Método de pago dicho en cualquier parte: efectivo, tarjeta, transferencia o "cobrar después / pendiente". */
export function detectMethod(text: string): string | null {
  const n = norm(text);
  if (/\b(?:cobrar|pago|pagar|paga|pagara)\s+(?:despues|luego|mas tarde)\b|\bpendiente\b|\bdespues\b/.test(n)) return 'LATER';
  if (/\btarjeta\b/.test(n)) return 'CARD';
  if (/\btransferencia\b/.test(n)) return 'TRANSFER';
  if (/\befectivo\b/.test(n)) return 'CASH';
  return null;
}

interface Tok { o: string; n: string; used: boolean }

const TRIGGER_PLATE = new Set(['placa', 'placas']);
const TRIGGER_PHONE = new Set(['telefono', 'celular', 'whatsapp', 'tel', 'numero']);
const TRIGGER_NAME = new Set(['cliente', 'nombre', 'llama', 'señor', 'senor', 'señora', 'senora', 'sr', 'sra']);
const TRIGGER_NOTES = new Set(['observaciones', 'observacion', 'nota', 'notas', 'comentarios', 'comentario']);
const PAY_WORDS = new Set(['efectivo', 'tarjeta', 'transferencia', 'pago', 'pagar', 'paga', 'pagara', 'cobrar', 'cobro', 'despues', 'luego', 'pendiente', 'credito', 'debito']);
/** Palabras sueltas que no aportan datos (se descartan antes de interpretar el vehículo). */
const NOISE = new Set(['quiero', 'quisiera', 'necesito', 'dame', 'pon', 'ponle', 'registra', 'registrar', 'agrega', 'agregar', 'crea', 'crear', 'orden', 'favor', 'por', 'porfa', 'hola', 'buenas', 'tengo', 'llego', 'llegó', 'llegaron', 'viene', 'trae', 'con', 'para', 'de', 'del', 'el', 'la', 'los', 'las', 'un', 'una', 'unos', 'unas', 'es', 'son', 'su', 'mi', 'y', 'e', 'a', 'al', 'en', 'que', 'tipo', 'servicio', 'servicios', 'lavado', 'placa', 'placas', 'marca', 'modelo', 'color', 'carro', 'coche', 'auto', 'vehiculo', 'camioneta', 'camion', 'sedan', 'pickup', 'este', 'esta', 'seria']);
/** Palabras de 2 o 3 letras que NO son parte de una placa. */
const NOT_PLATE = new Set(['un', 'una', 'el', 'la', 'los', 'las', 'del', 'es', 'mi', 'su', 'en', 'con', 'por', 'sin', 'que', 'mas', 'al', 'se', 'lo', 'le', 'me', 'si', 'no', 'ya', 'para', 'dos', 'uno', 'tres', 'sus', 'mis', 'gris', 'azul', 'rojo', 'roja', 'negro', 'negra']);
const COLOR_N = new Set(['blanco', 'blanca', 'negro', 'negra', 'gris', 'plata', 'plateado', 'plateada', 'rojo', 'roja', 'azul', 'verde', 'amarillo', 'amarilla', 'naranja', 'cafe', 'marron', 'beige', 'dorado', 'dorada', 'vino', 'guinda', 'morado', 'morada', 'rosa']);

const digitish = (tok: Tok, next?: Tok) => {
  if (/^\d+$/.test(tok.n)) return true;
  if (tok.n === 'un' || tok.n === 'una' || tok.n === 'y') return false;
  return spokenDigits(next && (tok.n === 'doble' || tok.n === 'triple') ? `${tok.n} ${next.n}` : tok.n) !== '';
};

/** Placa: tras «placa(s)» (deletreada o escrita) o, sin la palabra, un patrón tipo ABC-123 / 123-ABC. */
function takePlate(toks: Tok[], brandWords: Set<string>): string {
  const finish = (idx: number[]) => { idx.forEach((i) => (toks[i].used = true)); };
  const anchor = toks.findIndex((t) => TRIGGER_PLATE.has(t.n));
  if (anchor >= 0) {
    let letters = 0, digits = 0; const idx: number[] = [anchor]; const parts: string[] = [];
    for (let i = anchor + 1; i < toks.length && parsePlateLoose(parts.join(' ')).length < 8; i++) {
      const t = toks[i];
      if (['es', 'son', 'de', 'numero', 'letra', 'letras', 'guion', 'menos'].includes(t.n) && idx.length === 1) { idx.push(i); continue; }
      const mixed = /^(?=.*[a-z])(?=.*\d)[a-z0-9]{5,8}$/.test(t.n);
      const dig = digitish(t, toks[i + 1]);
      const letter = !dig && ((t.n.length === 1 && /[a-z]/.test(t.n)) || (t.n in LETTERS && t.n.length > 1 && !NOT_PLATE.has(t.n)) || (/^[a-z]{2,3}$/.test(t.n) && !NOT_PLATE.has(t.n) && !brandWords.has(t.n) && !COLOR_N.has(t.n)));
      if (!mixed && !dig && !letter) break;
      if (dig && (t.n === 'doble' || t.n === 'triple')) { parts.push(t.o, toks[i + 1].o); idx.push(i, i + 1); i++; digits += 2; continue; }
      parts.push(t.o); idx.push(i);
      if (mixed) break;
      if (dig) digits += spokenDigits(t.n).length || t.n.length; else letters += t.n.length === 1 || t.n in LETTERS ? 1 : t.n.length;
      if (letters >= 2 && digits >= 3) break;
    }
    const value = parsePlateLoose(parts.join(' '));
    if (value.length >= 3) { finish(idx); return value; }
  }
  // sin la palabra «placa»: ABC-123, ABC 123, 123-ABC, abc123
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]; if (t.used) continue;
    if (/^(?=.*[a-z])(?=.*\d)[a-z0-9]{6,7}$/.test(t.n)) { finish([i]); return t.o.toUpperCase(); }
    const nx = toks[i + 1];
    if (nx && !nx.used) {
      if (/^[a-z]{2,3}$/.test(t.n) && /^\d{3,4}$/.test(nx.n) && !brandWords.has(t.n) && !NOT_PLATE.has(t.n)) { finish([i, i + 1]); return (t.o + nx.o).toUpperCase(); }
      if (/^\d{3}$/.test(t.n) && /^[a-z]{2,3}$/.test(nx.n) && !brandWords.has(nx.n) && !NOT_PLATE.has(nx.n)) { finish([i, i + 1]); return (t.o + nx.o).toUpperCase(); }
    }
  }
  return '';
};

/** Convierte lo deletreado/dictado de una placa en letras y dígitos. */
function parsePlateLoose(text: string): string {
  const tokens = norm(text).split(' ').filter(Boolean);
  let out = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t === 'doble' && tokens[i + 1]) { const nx = tokens[i + 1]; const d = spokenDigits(nx); out += d ? d.repeat(2) : (LETTERS[nx] ?? nx[0] ?? '').repeat(2); i++; continue; }
    const d = /^\d+$/.test(t) ? t : spokenDigits(t);
    if (d) { out += d; continue; }
    if (t in LETTERS) { out += LETTERS[t]; continue; }
    if (/^[a-z0-9]{2,8}$/.test(t)) out += t.toUpperCase();
  }
  return out.replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

/** Teléfono: tras «teléfono/celular/whatsapp» o una racha de 10 dígitos seguidos. */
function takePhone(toks: Tok[]): string {
  const collect = (from: number) => {
    let acc = ''; const idx: number[] = [];
    for (let i = from; i < toks.length && acc.length < 10; i++) {
      const t = toks[i]; if (t.used) break;
      const d = /^\d+$/.test(t.n) ? t.n : digitish(t, toks[i + 1]) ? spokenDigits(t.n === 'doble' || t.n === 'triple' ? `${t.n} ${toks[i + 1]?.n}` : t.n) : '';
      if (d) { acc += d; idx.push(i); if (t.n === 'doble' || t.n === 'triple') { idx.push(i + 1); i++; } continue; }
      if (t.n === 'y' && acc && toks[i + 1] && digitish(toks[i + 1])) { idx.push(i); continue; }
      if (acc) break;
      if (['es', 'son', 'de', 'numero'].includes(t.n)) { idx.push(i); continue; }
      break;
    }
    return { acc, idx };
  };
  const anchor = toks.findIndex((t) => TRIGGER_PHONE.has(t.n) && !t.used);
  if (anchor >= 0) {
    const r = collect(anchor + 1);
    if (r.acc.length >= 7) { toks[anchor].used = true; r.idx.forEach((i) => (toks[i].used = true)); return r.acc.length >= 10 ? r.acc.slice(-10) : r.acc; }
  }
  for (let i = 0; i < toks.length; i++) {
    if (toks[i].used || !/^\d{2,}$/.test(toks[i].n)) continue;
    const r = collect(i);
    if (r.acc.length >= 10) { r.idx.forEach((k) => (toks[k].used = true)); return r.acc.slice(-10); }
  }
  return '';
}

export interface ParsedOrder { draft: DictDraft; missing: string[]; warnings: string[]; known?: ClientLite }

export function parseDictation(
  text: string,
  ctx: { services: Svc[]; catalog?: Catalog; clients?: ClientLite[]; method?: string; allowLater?: boolean },
): ParsedOrder {
  const catalog = ctx.catalog ?? [];
  const draft = emptyDictDraft(ctx.method ?? 'CASH');
  const warnings: string[] = [];
  const toks: Tok[] = text.split(/[^\p{L}\p{N}]+/u).filter(Boolean).map((o) => ({ o, n: norm(o), used: false })).filter((t) => t.n);
  const brandWords = new Set(catalog.flatMap((b) => norm(b.brand).split(' ')).concat(['vw', 'bmw', 'kia', 'mg', 'gmc', 'ram', 'byd', 'seat', 'audi']));

  // 1) observaciones: lo que siga a «observaciones/nota…» hasta el final
  const nIdx = toks.findIndex((t) => TRIGGER_NOTES.has(t.n));
  if (nIdx >= 0) {
    const rest = toks.slice(nIdx + 1).map((t) => t.o).join(' ');
    const n = norm(rest);
    draft.notes = ['ninguna', 'ninguno', 'nada', 'no'].includes(n) ? '' : rest ? rest[0].toLocaleUpperCase('es') + rest.slice(1) : '';
    toks.slice(nIdx).forEach((t) => (t.used = true));
  }

  // 2) placa y teléfono
  draft.plate = takePlate(toks, brandWords);
  draft.phone = takePhone(toks);

  // 3) servicios (con la cantidad dicha antes: «dos aspirados»)
  const live = () => toks.filter((t) => !t.used);
  const sv = parseServices(live().map((t) => t.o).join(' '), ctx.services);
  for (const it of sv.items) draft.items[it.id] = Math.min((draft.items[it.id] ?? 0) + it.qty, 99);
  if (!sv.items.length && sv.ambiguous.length) warnings.push(`Servicio ambiguo: ${sv.ambiguous.map((a) => a.name).join(' / ')}`);
  const svcWords = new Set(ctx.services.flatMap((s) => norm(s.name).split(' ')).filter((w) => w.length >= 4));
  const isSvcWord = (n: string) => svcWords.has(n) || [...svcWords].some((w) => n.length >= 5 && n.slice(0, 5) === w.slice(0, 5));
  toks.forEach((t, i) => {
    if (t.used || !isSvcWord(t.n) || !Object.keys(draft.items).length) return;
    t.used = true;
    const prev = toks[i - 1];
    if (prev && !prev.used && (/^\d+$/.test(prev.n) || (spokenDigits(prev.n) !== '' && prev.n !== 'un' && prev.n !== 'una'))) prev.used = true;
  });

  // 4) método de pago
  const pay = detectMethod(live().map((t) => t.o).join(' '));
  if (pay) draft.method = pay;
  if (draft.method === 'LATER' && ctx.allowLater === false) draft.method = 'CASH';
  toks.forEach((t, i) => { if (!t.used && PAY_WORDS.has(t.n)) { t.used = true; if (t.n === 'pago' || t.n === 'cobrar') { const nx = toks[i + 1]; if (nx && ['con', 'en', 'de', 'a'].includes(nx.n)) nx.used = true; } } });

  // 5) nombre: «para Juan Pérez», «cliente Juan», «a nombre de Juan», «se llama Juan»
  const stopName = (n: string) => NOISE.has(n) || PAY_WORDS.has(n) || COLOR_N.has(n) || brandWords.has(n) || isSvcWord(n) || TRIGGER_PHONE.has(n) || TRIGGER_PLATE.has(n) || /^\d/.test(n) || ['telefono', 'placas', 'color', 'modelo', 'marca', 'observaciones', 'pago'].includes(n);
  for (let i = 0; i < toks.length; i++) {
    const t = toks[i]; if (t.used) continue;
    let start = -1;
    if (t.n === 'para' && toks[i + 1] && !['el', 'la', 'los', 'las', 'un', 'una', 'hoy', 'manana', 'ahora', 'que'].includes(toks[i + 1].n)) start = i + 1;
    else if (TRIGGER_NAME.has(t.n) || (t.n === 'a' && toks[i + 1]?.n === 'nombre')) start = i + (t.n === 'a' ? 3 : 1);
    if (start < 0) continue;
    while (toks[start] && ['de', 'es', 'se', 'llama', 'del'].includes(toks[start].n)) start++;
    const name: Tok[] = [];
    for (let j = start; j < toks.length && name.length < 3; j++) { if (toks[j].used || stopName(toks[j].n)) break; name.push(toks[j]); }
    if (!name.length) continue;
    draft.name = parseName(name.map((x) => x.o).join(' '));
    toks.slice(i, start).forEach((x) => (x.used = true)); name.forEach((x) => (x.used = true));
    break;
  }

  // 6) lo que queda es el vehículo
  const rest = live().filter((t) => !NOISE.has(t.n)).map((t) => t.o).join(' ');
  if (rest) {
    const v = parseVehicle(rest, catalog);
    draft.brand = v.brand; draft.model = v.model; draft.color = v.color;
    // nada de basura: si «modelo» quedó con palabras sueltas muy largas se deja tal cual para que se corrija
  }
  if (!draft.color) { const c = toks.find((t) => COLOR_N.has(t.n) && !t.used); if (c) draft.color = COLORS.find((x) => norm(x) === c.n) ?? c.o[0].toUpperCase() + c.o.slice(1); }

  // 7) cliente registrado (placa -> teléfono -> nombre exacto): no se vuelve a pedir ni se crea otro
  let known: ClientLite | undefined;
  const clients = ctx.clients ?? [];
  if (clients.length) {
    const byPlate = draft.plate.length >= 3 ? findByPlate(clients, draft.plate) : undefined;
    known = byPlate?.client ?? (draft.phone.length === 10 ? findByPhone(clients, draft.phone) : undefined) ?? (draft.name ? findByExactName(clients, draft.name) : undefined);
    if (known) {
      draft.clientId = known.id;
      draft.name = known.name ?? draft.name;
      draft.phone = known.phone ?? draft.phone;
      const plateKey = draft.plate.replace(/[^A-Z0-9]/gi, '').toUpperCase();
      const v = byPlate?.vehicle ?? known.vehicles.find((x) => x.plate.replace(/[^A-Z0-9]/gi, '').toUpperCase() === plateKey);
      if (v) { draft.brand = draft.brand || v.brand; draft.model = draft.model || v.model; draft.color = draft.color || v.color; }
    }
  }

  return { draft, missing: missingOf(draft), warnings, known };
}

export function missingOf(d: DictDraft): string[] {
  const out: string[] = [];
  if (d.plate.length < 3) out.push('placa');
  if (!d.brand) out.push('marca');
  if (!d.model) out.push('modelo');
  if (!d.color) out.push('color');
  if (!Object.values(d.items).some((q) => q > 0)) out.push('servicio');
  return out;
}

/** «Consultar caja», «¿cuánto hay en caja?», «ver la caja»: comando que no crea orden. */
export const CASH_CMD = /\b(?:consultar|consulta|ver|revisar|como va|cuanto hay en|cu[aá]nto hay en)\s+(?:la\s+)?caja\b[.,;:!?]*/i;

export type Mark = 'plate' | 'veh' | 'svc' | 'client';
/** Parte el texto en trozos y marca las palabras que se reconocieron (para resaltarlas en la transcripción en vivo). */
export function highlight(text: string, d: DictDraft, services: Svc[]): { t: string; k?: Mark }[] {
  const words = (s: string) => new Set(norm(s).split(' ').filter((w) => w.length >= 2));
  const veh = new Set([...words(d.brand), ...words(d.model), ...words(d.color)]);
  const svc = new Set(services.filter((s) => d.items[s.id]).flatMap((s) => norm(s.name).split(' ').filter((w) => w.length >= 4)));
  const svcHit = (n: string) => svc.has(n) || [...svc].some((w) => n.length >= 5 && n.slice(0, 5) === w.slice(0, 5));
  const client = words(d.name);
  const plate = d.plate.toUpperCase();
  return text.split(/(\s+)/).map((t) => {
    const n = norm(t);
    if (!n) return { t };
    const compact = n.replace(/[^a-z0-9]/g, '').toUpperCase();
    if (TRIGGER_PLATE.has(n) || (plate && compact.length >= 2 && plate.includes(compact) && /\d|[A-Z]{2,}/.test(compact) && !veh.has(n))) return { t, k: 'plate' };
    if (veh.has(n)) return { t, k: 'veh' };
    if (svcHit(n)) return { t, k: 'svc' };
    if (client.has(n) || (d.phone && /^\d{2,}$/.test(n) && d.phone.includes(n))) return { t, k: 'client' };
    return { t };
  });
}