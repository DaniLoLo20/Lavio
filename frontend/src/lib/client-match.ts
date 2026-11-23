// Coincidencia de clientes (funciones puras: sin React, se pueden probar solas).
export interface ClientLite {
  id: string;
  name: string | null;
  phone: string | null;
  email: string | null;
  contactPreference: string;
  vehicles: { plate: string; brand: string; model: string; color: string }[];
}

export const normName = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9ñ ]/g, ' ').replace(/\s+/g, ' ').trim();
export const digits = (s: string) => s.replace(/\D/g, '');
export const plateKey = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]/g, '');
const last10 = (s: string) => digits(s).slice(-10);

/** Coincidencias por nombre (todas las palabras escritas) o por teléfono (dígitos contenidos). */
export function searchClients(list: ClientLite[], query: string, limit = 5): ClientLite[] {
  const q = normName(query);
  const d = digits(query);
  const out: ClientLite[] = [];
  for (const c of list) {
    const byName = q.length >= 2 && !!c.name && q.split(' ').every((t) => normName(c.name!).split(' ').some((w) => w.startsWith(t)) || normName(c.name!).includes(t));
    const byPhone = d.length >= 3 && !!c.phone && digits(c.phone).includes(d);
    if (byName || byPhone) out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

export const findByPhone = (list: ClientLite[], phone: string) => {
  const p = last10(phone);
  return p.length === 10 ? list.find((c) => c.phone && last10(c.phone) === p) : undefined;
};

/** Cliente solo si el nombre coincide exactamente con uno (sin acentos ni mayúsculas). */
export const findByExactName = (list: ClientLite[], name: string) => {
  const n = normName(name);
  if (!n) return undefined;
  const m = list.filter((c) => c.name && normName(c.name) === n);
  return m.length === 1 ? m[0] : undefined;
};

export function findByPlate(list: ClientLite[], plate: string) {
  const k = plateKey(plate);
  if (k.length < 3) return undefined;
  for (const c of list) {
    const vehicle = c.vehicles.find((v) => plateKey(v.plate) === k);
    if (vehicle) return { client: c, vehicle };
  }
  return undefined;
}

export const clientLabel = (c: ClientLite) => [c.name || 'Sin nombre', c.phone].filter(Boolean).join(' · ');
