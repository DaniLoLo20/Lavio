import { clock, net } from './net';

const TOKEN_KEY = 'al_token';

export const tokenStore = {
  get: () => (typeof window === 'undefined' ? null : localStorage.getItem(TOKEN_KEY)),
  set: (t: string) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

/** status 0 = sin conexion con el servidor (error de red), no una respuesta HTTP. */
export class ApiError extends Error {
  constructor(message: string, public status: number, public code?: string) {
    super(message);
  }
  get isNetwork() { return this.status === 0; }
}

export async function api<T = any>(
  path: string,
  opts: { method?: string; body?: unknown; form?: FormData; auth?: boolean; redirectOn401?: boolean } = {},
): Promise<T> {
  const headers: Record<string, string> = {};
  const token = tokenStore.get();
  if (token && opts.auth !== false) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? (opts.body || opts.form ? 'POST' : 'GET'),
      headers,
      body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
    });
  } catch {
    net.set(false);
    throw new ApiError('Sin conexión con el servidor', 0);
  }
  net.set(true);

  const serverDate = res.headers.get('date');
  if (serverDate) {
    const skew = Date.parse(serverDate) - Date.now();
    if (!isNaN(skew)) clock.skew = Math.abs(skew) < 15_000 ? 0 : skew; // el encabezado Date tiene precision de 1 s
  }

  if (res.status === 401 && opts.auth !== false && opts.redirectOn401 !== false && typeof window !== 'undefined' && !location.pathname.startsWith('/login')) {
    tokenStore.clear();
    location.href = '/login';
  }
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* respuesta no JSON (p. ej. 502 del proxy) */ }
  if (!res.ok) {
    const msg = Array.isArray(data?.message) ? data.message.join(', ') : data?.message;
    throw new ApiError(msg || `Error ${res.status}`, res.status, data?.code);
  }
  return data as T;
}

/** Descarga un reporte (requiere el token, por eso no es un simple enlace). */
export async function download(path: string) {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${tokenStore.get()}` } });
  } catch {
    throw new ApiError('Sin conexión con el servidor', 0);
  }
  if (!res.ok) {
    let msg = `Error ${res.status}`;
    try { msg = (await res.json()).message || msg; } catch { /* sin cuerpo JSON */ }
    throw new ApiError(msg, res.status);
  }
  const name = /filename="?([^";]+)"?/.exec(res.headers.get('Content-Disposition') ?? '')?.[1] ?? 'reporte.csv';
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Archivo privado (p. ej. comprobantes de caja): se pide con sesión y se muestra como URL temporal. */
export async function fetchBlobUrl(path: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { headers: { Authorization: `Bearer ${tokenStore.get()}` } });
  } catch {
    throw new ApiError('Sin conexión con el servidor', 0);
  }
  if (!res.ok) throw new ApiError(`Error ${res.status}`, res.status);
  return URL.createObjectURL(await res.blob());
}

/** Reduce fotos de celular (varios MB) a JPEG ~1600px antes de guardarlas/subirlas. */
export async function compressImage(file: File, maxSide = 1600, quality = 0.8): Promise<Blob> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    return blob ?? file;
  } catch {
    return file;
  }
}
