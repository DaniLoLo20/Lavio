// Dictado libre con palabras clave: "placa A B C 1 2 3 marca Nissan modelo Versa color gris nombre Juan teléfono 55...
// servicio lavado básico y aspirado". Varias órdenes en una misma grabación separadas por "siguiente orden".
// Reglas deterministas sobre texto (sin IA ni servicios externos). Funciones puras.
import { COLORS, matchBrand, matchCatalogValue, norm, parseName, parseNotes, parsePhone, parsePlate, parseServices, parseVehicle } from './parsers';
import { findByExactName, findByPhone, findByPlate, type ClientLite } from '@/lib/clients';

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

type Field = 'plate' | 'brand' | 'model' | 'color' | 'vehicle' | 'name' | 'phone' | 'notes' | 'service' | 'method';
const KEYWORDS: Record<string, Field> = {
  placa: 'plate', placas: 'plate',
  marca: 'brand', modelo: 'model', color: 'color',
  vehiculo: 'vehicle', carro: 'vehicle', coche: 'vehicle',
  nombre: 'name', cliente: 'name',
  telefono: 'phone', celular: 'phone', tel: 'phone', whatsapp: 'phone',
  observaciones: 'notes', observacion: 'notes', nota: 'notes', notas: 'notes', comentarios: 'notes', comentario: 'notes',
  servicio: 'service', servicios: 'service',
  pago: 'method', pagar: 'method', pagara: 'method', cobro: 'method', cobrar: 'method',
};
const cap = (s: string) => s.trim().replace(/[.,;:!?]+$/g, '').split(/\s+/).filter(Boolean).map((w) => w[0].toLocaleUpperCase('es') + w.slice(1).toLowerCase()).join(' ');

/** Método de pago dicho en cualquier parte: efectivo, tarjeta, transferencia o "cobrar después / pendiente". */
export function detectMethod(text: string): string | null {
  const n = norm(text);
  if (/\b(?:cobrar|pago|pagar|paga|pagara)\s+(?:despues|luego|mas tarde)\b|\bpendiente\b|\bdespues\b/.test(n)) return 'LATER';
  if (/\btarjeta\b/.test(n)) return 'CARD';
  if (/\btransferencia\b/.test(n)) return 'TRANSFER';
  if (/\befectivo\b/.test(n)) return 'CASH';
  return null;
}

export interface ParsedOrder { draft: DictDraft; missing: string[]; warnings: string[]; known?: ClientLite }

export function parseDictation(
  text: string,
  ctx: { services: Svc[]; catalog?: Catalog; clients?: ClientLite[]; method?: string; allowLater?: boolean },
): ParsedOrder {
  const catalog = ctx.catalog ?? [];
  const draft = emptyDictDraft(ctx.method ?? 'CASH');
  const warnings: string[] = [];
  const words = text.trim().split(/\s+/).filter(Boolean);
  const nw = words.map((w) => norm(w));

  // 1) segmentos por palabra clave
  const segs: { field: Field | 'pre'; words: string[] }[] = [{ field: 'pre', words: [] }];
  for (let i = 0; i < words.length; i++) {
    const f = KEYWORDS[nw[i]];
    // "color" también aparece dentro de otras frases; solo cuenta como clave si no es lo último
    if (f && !(i === words.length - 1)) segs.push({ field: f, words: [] });
    else segs[segs.length - 1].words.push(words[i]);
  }
  const by = (f: Field) => segs.filter((s) => s.field === f).map((s) => s.words.join(' ').trim()).filter(Boolean);
  const first = (f: Field) => by(f)[0] ?? '';

  if (first('plate')) draft.plate = parsePlate(first('plate')).value;

  // 2) vehículo: por campos o en una sola frase
  const brands = catalog.map((b) => b.brand);
  const brandRaw = first('brand');
  if (brandRaw) draft.brand = matchBrand(brandRaw, brands) || cap(brandRaw);
  const modelRaw = first('model');
  if (modelRaw) {
    const pool = catalog.find((b) => b.brand === draft.brand)?.models ?? catalog.flatMap((b) => b.models);
    draft.model = matchCatalogValue(modelRaw, pool) || cap(modelRaw);
  }
  const colorRaw = first('color');
  if (colorRaw) draft.color = matchCatalogValue(colorRaw, COLORS) || cap(colorRaw);
  const vehicleText = [first('vehicle'), !draft.brand && !draft.model && !draft.color ? segs[0].words.join(' ') : ''].filter(Boolean).join(' ');
  if (vehicleText) {
    const v = parseVehicle(vehicleText, catalog);
    draft.brand = draft.brand || v.brand;
    draft.model = draft.model || v.model;
    draft.color = draft.color || v.color;
  }

  // 3) cliente
  if (first('name')) draft.name = parseName(first('name'));
  if (first('phone')) draft.phone = parsePhone(first('phone')).value;
  if (first('notes')) draft.notes = parseNotes(by('notes').join(' '));

  // 4) servicios: en su segmento; si no se dijo la palabra "servicio", se buscan en lo dicho antes de la primera clave
  const svcText = [...by('service'), segs[0].words.join(' ')].filter(Boolean);
  for (const t of svcText) {
    const r = parseServices(t, ctx.services);
    for (const it of r.items) draft.items[it.id] = Math.min((draft.items[it.id] ?? 0) + it.qty, 99);
    if (!r.items.length && r.ambiguous.length && t === svcText[0]) warnings.push(`Servicio ambiguo: ${r.ambiguous.map((a) => a.name).join(' / ')}`);
    if (Object.keys(draft.items).length) break;
  }

  // 5) método de pago
  const m = detectMethod(by('method').join(' ') || text);
  if (m) draft.method = m;
  if (draft.method === 'LATER' && ctx.allowLater === false) draft.method = 'CASH';

  // 6) cliente registrado (placa -> nombre exacto -> teléfono): no se vuelve a pedir ni se crea otro
  let known: ClientLite | undefined;
  const clients = ctx.clients ?? [];
  if (clients.length) {
    const byPlate = draft.plate.length >= 3 ? findByPlate(clients, draft.plate) : undefined;
    known = byPlate?.client ?? (draft.phone.length === 10 ? findByPhone(clients, draft.phone) : undefined) ?? (draft.name ? findByExactName(clients, draft.name) : undefined);
    if (known) {
      draft.clientId = known.id;
      draft.name = known.name ?? draft.name;
      draft.phone = known.phone ?? draft.phone;
      const v = byPlate?.vehicle ?? known.vehicles.find((x) => x.plate.replace(/[^A-Z0-9]/gi, '').toUpperCase() === draft.plate.replace(/[^A-Z0-9]/gi, '').toUpperCase());
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
