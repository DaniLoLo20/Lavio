'use client';
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useQueryClient, type QueryClient } from '@tanstack/react-query';
import { ApiError, api, tokenStore } from './api';
import { getDb, RQ_CACHE_KEY } from './offline/db';
import { cacheUser, clearCachedUser, readCachedUser } from './session';
import { can as canUser, firstAllowedPath } from './menu';

/** Nombre del rol: ADMIN, WASHER, SUPERADMIN o uno creado por el superadmin. */
export type Role = string;

export interface SessionUser {
  id: string;
  fullName: string;
  email: string;
  role: Role;
  roleLabel: string;
  /** Permisos vigentes del rol ("recurso:accion"). Mandan sobre el menú y los botones. */
  permissions: string[];
  /** true cuando un superadmin está dentro de una empresa en modo soporte */
  support: boolean;
  tenant: { id: string; name: string; slug: string; taxRate: number; currency: string; phone?: string | null; address?: string | null; taxId?: string | null; plan: string; countryCode?: string; logoUrl?: string | null };
}

export type LoginResult = { user: SessionUser } | { companies: { slug: string; name: string }[] };

interface Ctx {
  user: SessionUser | null;
  ready: boolean;
  login: (email: string, password: string, tenantSlug?: string) => Promise<LoginResult>;
  enterSupport: (tenantId: string) => Promise<void>;
  exitSupport: () => void;
  logout: () => void;
  refresh: () => Promise<void>;
  /** ¿El usuario tiene este permiso? (p. ej. can('inventory:create')) */
  can: (perm: string) => boolean;
}

const ROOT_KEY = 'al_token_root';
const AuthContext = createContext<Ctx>(null as unknown as Ctx);
export const useAuth = () => useContext(AuthContext);
export const homeFor = (u: SessionUser) => firstAllowedPath(u);

/**
 * Al cambiar de usuario o empresa se descarta la cache de datos (privacidad entre usuarios del mismo dispositivo).
 * La cola de sincronizacion NO se toca: las operaciones pendientes siguen guardadas y solo las envia su propietario.
 */
async function resetDataCache(qc: QueryClient) {
  qc.clear();
  try { await getDb().kv.delete(RQ_CACHE_KEY); } catch { /* sin IndexedDB */ }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<SessionUser | null>(null);
  const [ready, setReady] = useState(false);

  const setSession = useCallback((u: SessionUser) => { cacheUser(u); setUser(u); }, []);

  const refresh = useCallback(async () => {
    setSession(await api<SessionUser>('/auth/me'));
  }, [setSession]);

  useEffect(() => {
    if (!tokenStore.get()) { setReady(true); return; }
    // Sin conexion se entra con la sesion guardada; /auth/me solo la confirma cuando hay red.
    const cached = readCachedUser<SessionUser>();
    if (cached) { setUser(cached); setReady(true); }
    refresh()
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) { tokenStore.clear(); clearCachedUser(); setUser(null); }
      })
      .finally(() => setReady(true));
  }, [refresh]);

  const login = useCallback(async (email: string, password: string, tenantSlug?: string): Promise<LoginResult> => {
    const r = await api<any>('/auth/login', { body: { email, password, tenantSlug: tenantSlug || undefined }, auth: false });
    if (r.needTenant) return { companies: r.companies };
    sessionStorage.removeItem(ROOT_KEY);
    await resetDataCache(qc);
    tokenStore.set(r.accessToken);
    setSession(r.user);
    return { user: r.user };
  }, [qc, setSession]);

  // Modo soporte: se guarda el token del superadmin para poder volver sin reingresar contraseña
  const enterSupport = useCallback(async (tenantId: string) => {
    const root = tokenStore.get();
    const r = await api<{ accessToken: string; user: SessionUser }>(`/auth/impersonate/${tenantId}`, { method: 'POST', body: {} });
    if (root && !sessionStorage.getItem(ROOT_KEY)) sessionStorage.setItem(ROOT_KEY, root);
    await resetDataCache(qc);
    tokenStore.set(r.accessToken);
    setSession(r.user);
  }, [qc, setSession]);

  const exitSupport = useCallback(() => {
    const root = sessionStorage.getItem(ROOT_KEY);
    sessionStorage.removeItem(ROOT_KEY);
    if (root) tokenStore.set(root);
    clearCachedUser();
    void resetDataCache(qc).finally(() => { location.href = root ? '/platform' : '/login'; });
  }, [qc]);

  const logout = useCallback(() => {
    tokenStore.clear();
    clearCachedUser();
    sessionStorage.removeItem(ROOT_KEY);
    setUser(null);
    void resetDataCache(qc).finally(() => { location.href = '/login'; });
  }, [qc]);

  const can = useCallback((perm: string) => canUser(user, perm), [user]);
  return <AuthContext.Provider value={{ user, ready, login, enterSupport, exitSupport, logout, refresh, can }}>{children}</AuthContext.Provider>;
}
