/** Identidad de la sesion guardada en el dispositivo (necesaria para operar y sincronizar sin conexion). */
const USER_KEY = 'al_user';

export interface CachedSession { id: string; tenantId: string }

export function readSession(): CachedSession | null {
  if (typeof window === 'undefined') return null;
  try {
    const u = JSON.parse(localStorage.getItem(USER_KEY) || 'null');
    return u?.id && u?.tenant?.id ? { id: u.id, tenantId: u.tenant.id } : null;
  } catch {
    return null;
  }
}

export const readCachedUser = <T,>(): T | null => {
  if (typeof window === 'undefined') return null;
  try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; }
};
export const cacheUser = (u: unknown) => localStorage.setItem(USER_KEY, JSON.stringify(u));
export const clearCachedUser = () => localStorage.removeItem(USER_KEY);
