'use client';
import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Cloud, CloudOff, RefreshCw, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useOnline } from '@/lib/net';
import { getDb, type OutboxOp } from '@/lib/offline/db';
import { useLive } from '@/lib/offline/hooks';
import { bindQueryClient, discardOp, flush, retryOp, syncStore, useSyncState } from '@/lib/offline/sync';
import { PHOTO_TYPES, STATUS, cn, dateTime, type Status } from '@/lib/utils';
import { Button } from './ui';

const Ctx = createContext<{ openPanel: () => void }>({ openPanel: () => undefined });
export const useSyncUI = () => useContext(Ctx);

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [panel, setPanel] = useState(false);
  const pendingRef = useRef(0);

  useEffect(() => { bindQueryClient(qc); }, [qc]);

  // Contadores de la cola del usuario actual
  const ops = useLive(() => getDb().outbox.toArray(), []);
  useEffect(() => {
    const mine = (ops ?? []).filter((o) => o.tenantId === user?.tenant.id && o.userId === user?.id);
    const pending = mine.filter((o) => o.status === 'pending').length;
    pendingRef.current = pending;
    syncStore.setCounts(pending, mine.length - pending);
  }, [ops, user]);

  useEffect(() => {
    if (!user) return;
    const run = () => { void flush(); };
    const onVisible = () => { if (document.visibilityState === 'visible') run(); };
    const onMsg = (e: MessageEvent) => { if (e.data?.type === 'SYNC') run(); };
    run();
    window.addEventListener('online', run);
    document.addEventListener('visibilitychange', onVisible);
    navigator.serviceWorker?.addEventListener('message', onMsg);
    const timer = setInterval(() => { if (pendingRef.current > 0) run(); }, 15_000);
    // Pide almacenamiento persistente para que el navegador no borre los datos locales al faltar espacio
    void navigator.storage?.persist?.();
    // Pide al service worker (re)guardar la app para uso sin conexion
    navigator.serviceWorker?.ready.then((r) => r.active?.postMessage({ type: 'WARM' })).catch(() => undefined);
    return () => {
      window.removeEventListener('online', run);
      document.removeEventListener('visibilitychange', onVisible);
      navigator.serviceWorker?.removeEventListener('message', onMsg);
      clearInterval(timer);
    };
  }, [user]);

  const value = useMemo(() => ({ openPanel: () => setPanel(true) }), []);
  return (
    <Ctx.Provider value={value}>
      {children}
      {panel && <SyncPanel onClose={() => setPanel(false)} />}
    </Ctx.Provider>
  );
}

/** Franja superior con el estado de conexion y de la cola. */
export function OfflineBanner() {
  const online = useOnline();
  const s = useSyncState();
  const { openPanel } = useSyncUI();
  const { logout } = useAuth();

  let tone = '', text: React.ReactNode = null;
  if (s.authExpired && s.pending > 0) {
    tone = 'bg-red-600 text-white';
    text = <>Tu sesión venció. <b>Tus {s.pending} cambios están guardados</b> en este dispositivo. <button className="underline" onClick={logout}>Inicia sesión</button> para sincronizarlos.</>;
  } else if (!online) {
    tone = 'bg-amber-500 text-black';
    text = <><b>Sin conexión.</b> Puedes seguir creando órdenes, cambiando estatus y tomando fotos; se enviarán solas al reconectar.{s.pending > 0 && <> Pendientes: <b>{s.pending}</b>.</>}</>;
  } else if (s.problems > 0) {
    tone = 'bg-red-600 text-white';
    text = <><b>{s.problems}</b> cambio(s) no se pudieron sincronizar. <button className="underline" onClick={openPanel}>Revisar</button></>;
  } else if (s.pending > 0) {
    tone = 'bg-sky-600 text-white';
    text = <>{s.syncing ? 'Sincronizando' : 'Pendientes de sincronizar'}: <b>{s.pending}</b></>;
  }
  if (!text) return null;
  return <div className={cn('px-4 py-2 text-center text-xs font-medium sm:text-sm', tone)}>{text}</div>;
}

/** Botoncito de estado (nube) que abre el panel de sincronizacion. */
export function SyncBadge({ className, compact }: { className?: string; compact?: boolean }) {
  const online = useOnline();
  const s = useSyncState();
  const { openPanel } = useSyncUI();
  const bad = s.problems > 0;
  const Icon = !online ? CloudOff : s.syncing ? RefreshCw : bad ? AlertTriangle : Cloud;
  const label = !online ? 'Sin conexión' : s.syncing ? 'Sincronizando' : bad ? 'Revisar' : s.pending > 0 ? 'Pendiente' : 'Al día';
  return (
    <button
      onClick={openPanel}
      title="Estado de sincronización"
      className={cn('inline-flex h-9 items-center gap-1.5 rounded-md px-2 text-xs text-muted-foreground hover:bg-muted', !online && 'text-amber-600', bad && 'text-red-600', className)}
    >
      <Icon className={cn('h-4 w-4', s.syncing && 'animate-spin')} />
      <span className={cn('hidden whitespace-nowrap', !compact && 'sm:inline')}>{label}</span>
      {s.pending + s.problems > 0 && <span className="rounded-full bg-primary px-1.5 text-[10px] font-semibold text-primary-foreground">{s.pending + s.problems}</span>}
    </button>
  );
}

function describe(op: OutboxOp, plate?: string) {
  if (op.type === 'order.create') return `Nueva orden${plate ? ` · ${plate}` : ''}`;
  if (op.type === 'order.status') return `Estatus → ${STATUS[op.payload.status as Status]?.label ?? op.payload.status}`;
  return 'Fotografía';
}

function SyncPanel({ onClose }: { onClose: () => void }) {
  const { user } = useAuth();
  const online = useOnline();
  const s = useSyncState();
  const ops = useLive(() => getDb().outbox.orderBy('seq').toArray(), []);
  const locals = useLive(() => getDb().orders.toArray(), []);
  const photos = useLive(() => getDb().photos.toArray(), []);
  const mine = (ops ?? []).filter((o) => o.tenantId === user?.tenant.id && o.userId === user?.id);
  const others = (ops ?? []).length - mine.length;
  const plateOf = (id: string) => (locals ?? []).find((l) => l.id === id)?.data.vehicle?.plate;
  const photoType = (op: OutboxOp) => PHOTO_TYPES.find((t) => t.value === (photos ?? []).find((p) => p.id === op.payload.photoId)?.type)?.label;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center sm:p-4" onClick={onClose}>
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-t-xl border bg-card shadow-xl sm:rounded-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold">Sincronización</h2>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Cerrar"><X className="h-4 w-4" /></Button>
        </div>
        <div className="space-y-3 overflow-y-auto p-4 text-sm">
          <p className="text-muted-foreground">
            {online ? 'Con conexión.' : 'Sin conexión.'} Todo lo que haces se guarda primero en este dispositivo y se envía solo al servidor; nada se pierde aunque pasen horas.
          </p>
          <Button size="sm" disabled={!online || s.syncing} onClick={() => void flush()}><RefreshCw className={cn('h-4 w-4', s.syncing && 'animate-spin')} />Sincronizar ahora</Button>
          {mine.length === 0 && <p className="py-4 text-center text-muted-foreground">Todo está sincronizado.</p>}
          <ul className="divide-y rounded-md border">
            {mine.map((op) => (
              <li key={op.seq} className="space-y-1 p-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{describe(op, plateOf(op.entityId))}{op.type === 'order.photo' && photoType(op) ? ` (${photoType(op)})` : ''}</span>
                  <span className={cn('rounded-full px-2 py-0.5 text-xs', op.status === 'pending' ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300' : op.status === 'conflict' ? 'bg-amber-500/20 text-amber-700 dark:text-amber-300' : 'bg-red-500/15 text-red-700 dark:text-red-300')}>
                    {op.status === 'pending' ? 'Pendiente' : op.status === 'conflict' ? 'Conflicto' : 'Rechazada'}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground">Hecha el {dateTime(op.at)}{op.attempts > 0 && ` · ${op.attempts} intento(s)`}</p>
                {op.error && <p className="text-xs text-red-600 dark:text-red-400">{op.error}</p>}
                {op.status === 'conflict' && <p className="text-xs text-muted-foreground">Prevaleció el cambio más reciente del servidor.</p>}
                {op.status !== 'pending' && (
                  <div className="flex gap-2 pt-1">
                    {op.status === 'failed' && <Button size="sm" variant="outline" onClick={() => void retryOp(op.seq!)}>Reintentar</Button>}
                    <Button size="sm" variant="ghost" onClick={() => confirm(op.type === 'order.create' ? 'Esto elimina la orden local y sus fotos pendientes. ¿Descartar?' : '¿Descartar este cambio?') && void discardOp(op.seq!)}>Descartar</Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {others > 0 && <p className="text-xs text-muted-foreground">Hay {others} cambio(s) guardados de otro usuario en este dispositivo; se enviarán cuando esa persona inicie sesión.</p>}
        </div>
      </div>
    </div>
  );
}
