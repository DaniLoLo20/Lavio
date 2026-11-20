'use client';
import { useEffect, useRef, useState } from 'react';
import { liveQuery } from 'dexie';
import { getDb } from './db';

/** Suscripcion reactiva a IndexedDB: se actualiza sola cuando cambian las tablas consultadas. */
export function useLive<T>(querier: () => Promise<T> | T, deps: unknown[], initial?: T): T | undefined {
  const [value, setValue] = useState<T | undefined>(initial);
  useEffect(() => {
    const sub = liveQuery(querier).subscribe({ next: setValue, error: () => undefined });
    return () => sub.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return value;
}

export const useLocalOrders = (tenantId?: string) =>
  useLive(() => (tenantId ? getDb().orders.where('tenantId').equals(tenantId).toArray() : []), [tenantId]);

export const usePendingOps = (tenantId?: string) =>
  useLive(() => (tenantId ? getDb().outbox.where('tenantId').equals(tenantId).toArray() : []), [tenantId]);

/** URL de objeto estable para una foto local (se crea una vez por id y se libera al desmontar). */
export function useObjectUrl(id: string, blob: Blob): string {
  const [url, setUrl] = useState('');
  const ref = useRef(blob);
  ref.current = blob;
  useEffect(() => {
    const u = URL.createObjectURL(ref.current);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [id]);
  return url;
}
