// Escaneo de la FOTO TRASERA del vehículo, en el propio dispositivo (sin servicios externos ni de pago):
//  · placa y emblemas (marca/modelo) con OCR (tesseract.js; la 1.ª vez descarga el idioma, luego queda en caché)
//  · color de carrocería con estadística de píxeles (sin IA).
// Son sugerencias: se rellenan los campos vacíos y el empleado confirma.

export interface ScanResult {
  plate: string;
  brand: string;
  model: string;
  color: string;
  /** palabras leídas (para depurar/mostrar) */
  words: string[];
}

type Catalog = { brand: string; models: string[] }[];
const ALIASES: Record<string, string> = { VW: 'Volkswagen', VOLKS: 'Volkswagen', CHEVY: 'Chevrolet', BENZ: 'Mercedes-Benz', MERCEDES: 'Mercedes-Benz', GM: 'Chevrolet', LANDROVER: 'Land Rover' };
const key = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase().replace(/[^A-Z0-9]/g, '');

/** Distancia de edición (para emblemas mal leídos: «VERSA» ≈ «VER5A»). */
function lev(a: string, b: string) {
  if (Math.abs(a.length - b.length) > 2) return 9;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}
/** Errores típicos del OCR en letras de emblema. */
const fixOcr = (s: string) => s.replace(/0/g, 'O').replace(/1/g, 'I').replace(/5/g, 'S').replace(/8/g, 'B');

/** Placa: 5–8 caracteres con letras y números (ABC1234, ABC123, 123ABC, AB12345…). */
export function pickPlate(words: string[]): string {
  const toks = words.map(key).filter(Boolean);
  const strong = (t: string) => /^[A-Z]{3}\d{3,4}$/.test(t) || /^\d{3}[A-Z]{3}$/.test(t) || /^[A-Z]{3}\d{2}\d{2}$/.test(t) || /^[A-Z]{3}\d{3}[A-Z]$/.test(t);
  // una palabra que ya tiene forma de placa gana: así el borde del marco («1» suelto) no se le pega
  const single = toks.filter(strong).sort((a, b) => b.length - a.length)[0];
  if (single) return single;
  const joined: string[] = [];
  // se unen pedazos («ABC» + «1234»), pero nunca caracteres sueltos, que suelen ser bordes o tornillos
  for (let i = 0; i < toks.length; i++) {
    joined.push(toks[i]);
    if (toks[i + 1] && toks[i].length >= 2 && toks[i + 1].length >= 2) joined.push(toks[i] + toks[i + 1]);
    if (toks[i + 2] && toks[i].length >= 2 && toks[i + 1].length >= 2 && toks[i + 2].length >= 2) joined.push(toks[i] + toks[i + 1] + toks[i + 2]);
  }
  const ok = joined.filter((t) => t.length >= 5 && t.length <= 8 && /[A-Z]/.test(t) && /\d/.test(t) && (t.match(/\d/g)!.length >= 2));
  const score = (t: string) => (strong(t) ? 10 : 0) + t.length;
  return ok.sort((a, b) => score(b) - score(a))[0] ?? '';
}

/** Marca y modelo a partir de las palabras leídas en los emblemas, usando el catálogo. */
export function pickBrandModel(words: string[], catalog: Catalog, plate = ''): { brand: string; model: string } {
  const toks = words.map(key).filter((t) => t.length >= 2 && t !== plate);
  const cand = [...new Set([...toks, ...toks.map(fixOcr), ...toks.slice(0, -1).map((t, i) => t + toks[i + 1])])];
  const close = (a: string, b: string) => a === b || (b.length >= 5 && lev(a, b) <= 1);

  let brand = '';
  for (const c of cand) {
    const alias = ALIASES[c];
    const hit = alias ? catalog.find((b) => b.brand === alias) : catalog.find((b) => close(c, key(b.brand)));
    if (hit) { brand = hit.brand; break; }
  }
  // modelo: primero dentro de la marca detectada; si no hay marca, el modelo identifica la marca si es único
  const models = (b: string) => catalog.find((x) => x.brand === b)?.models ?? [];
  const findModel = (list: string[]) => {
    let best: { m: string; len: number } | null = null;
    for (const m of list) {
      const k = key(m);
      if (k.length < 2) continue;
      // modelos de 1–3 caracteres (A3, CX5, 320) solo si coinciden exacto
      if (cand.some((c) => (k.length <= 3 ? c === k : close(c, k))) && (!best || k.length > best.len)) best = { m, len: k.length };
    }
    return best?.m ?? '';
  };
  let model = brand ? findModel(models(brand)) : '';
  if (!model) {
    const hits = catalog.map((b) => ({ b: b.brand, m: findModel(b.models) })).filter((x) => x.m && key(x.m).length >= 4);
    if (brand) { const same = hits.find((h) => h.b === brand); if (same) model = same.m; }
    else if (hits.length === 1) { brand = hits[0].b; model = hits[0].m; }
  }
  return { brand, model };
}

/** Nombre de color a partir de un píxel RGB. */
export function colorName(r: number, g: number, b: number): string {
  const max = Math.max(r, g, b) / 255, min = Math.min(r, g, b) / 255, l = (max + min) / 2, d = max - min;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d) { const R = r / 255, G = g / 255, B = b / 255; h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4; h = (h * 60 + 360) % 360; }
  if (l < 0.16) return 'Negro';
  if (s < 0.15 || (l > 0.88 && s < 0.35)) return l > 0.8 ? 'Blanco' : l > 0.55 ? 'Plata' : 'Gris';
  if (h < 15 || h >= 345) return l < 0.32 ? 'Vino' : 'Rojo';
  if (h < 40) return l < 0.38 ? 'Café' : 'Naranja';
  if (h < 65) return s < 0.45 ? (l > 0.6 ? 'Beige' : 'Dorado') : 'Amarillo';
  if (h < 170) return 'Verde';
  if (h < 260) return 'Azul';
  return 'Morado';
}

/**
 * Color dominante de la carrocería: se analiza la franja central-inferior de la foto (cajuela y defensa), sin la
 * zona de la placa, y se toma el color con más píxeles. Los vidrios oscuros quedan arriba y casi no influyen.
 */
export function dominantColor(img: ImageData, avoid?: { x0: number; y0: number; x1: number; y1: number }): string {
  const { width: w, height: h, data } = img;
  const votes: Record<string, number> = {};
  const step = Math.max(1, Math.round(Math.sqrt((w * h) / 40000)));
  for (let y = Math.round(h * 0.3); y < h * 0.85; y += step) {
    for (let x = Math.round(w * 0.12); x < w * 0.88; x += step) {
      if (avoid && x >= avoid.x0 && x <= avoid.x1 && y >= avoid.y0 && y <= avoid.y1) continue;
      const i = (y * w + x) * 4;
      const c = colorName(data[i], data[i + 1], data[i + 2]);
      votes[c] = (votes[c] ?? 0) + 1;
    }
  }
  const sorted = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  if (!sorted.length) return '';
  // el negro gana a menudo por sombras y llantas: solo se acepta si domina claramente
  if (sorted[0][0] === 'Negro' && sorted[1] && sorted[0][1] < sorted[1][1] * 1.8) return sorted[1][0];
  return sorted[0][0];
}

/** Copia en gris con contraste estirado (y opcionalmente en negativo) para que el OCR lea letras claras sobre pintura. */
function variant(src: HTMLCanvasElement, invert: boolean): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = src.width; c.height = src.height;
  const ctx = c.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(src, 0, 0);
  const img = ctx.getImageData(0, 0, c.width, c.height); const d = img.data;
  const hist = new Uint32Array(256); const lum = new Uint8Array(d.length / 4);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) { const y = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]); lum[j] = y; hist[y]++; }
  const total = lum.length; let acc = 0, lo = 0, hi = 255;
  for (let v = 0; v < 256; v++) { acc += hist[v]; if (acc > total * 0.02) { lo = v; break; } }
  acc = 0; for (let v = 255; v >= 0; v--) { acc += hist[v]; if (acc > total * 0.02) { hi = v; break; } }
  const span = Math.max(1, hi - lo);
  for (let i = 0, j = 0; i < d.length; i += 4, j++) { let y = Math.min(255, Math.max(0, ((lum[j] - lo) * 255) / span)); if (invert) y = 255 - y; d[i] = d[i + 1] = d[i + 2] = y; }
  ctx.putImageData(img, 0, 0);
  return c;
}

async function toImageData(file: Blob, maxSide = 1400): Promise<{ data: ImageData; canvas: HTMLCanvasElement }> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale); canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close?.();
  return { data: ctx.getImageData(0, 0, canvas.width, canvas.height), canvas };
}

/** Analiza la foto trasera. Nunca lanza: devuelve lo que pudo detectar (campos vacíos = no detectado). */
export async function scanRear(file: Blob, catalog: Catalog): Promise<ScanResult & { ocrError?: string }> {
  const { data, canvas } = await toImageData(file);
  let words: string[] = []; let ocrError: string | undefined; let avoid: { x0: number; y0: number; x1: number; y1: number } | undefined; let plate = '';
  try {
    const { createWorker } = await import('tesseract.js');
    const w = await createWorker('eng');
    const all: { text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }[] = [];
    const run = async (src: HTMLCanvasElement, psm?: string) => {
      await w.setParameters({ tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-', ...(psm ? { tessedit_pageseg_mode: psm as any } : {}) });
      const { data: r } = await w.recognize(src);
      all.push(...(((r as any).words ?? []) as typeof all).filter((x) => x.confidence > 30 && key(x.text)));
    };
    // 1) foto tal cual (placa: texto oscuro sobre blanco)  2) gris con contraste y 3) en negativo, en modo «texto
    // disperso»: los emblemas cromados son claros sobre la pintura y salen mejor así.
    await run(canvas);
    await run(variant(canvas, false), '11');
    await run(variant(canvas, true), '11');
    await w.terminate();
    words = [...new Set(all.map((x) => x.text))];
    plate = pickPlate(words);
    const pw = all.find((x) => plate && plate.includes(key(x.text)) && key(x.text).length >= 3);
    if (pw) { const pad = 20; avoid = { x0: pw.bbox.x0 - pad * 3, y0: pw.bbox.y0 - pad, x1: pw.bbox.x1 + pad * 3, y1: pw.bbox.y1 + pad }; }  } catch (e) {
    ocrError = 'No se pudo leer el texto de la foto (el lector necesita internet la primera vez).';
  }
  const bm = pickBrandModel(words, catalog, plate);
  return { plate, brand: bm.brand, model: bm.model, color: dominantColor(data, avoid), words, ocrError };
}
