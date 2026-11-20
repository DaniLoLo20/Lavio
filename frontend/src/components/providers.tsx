'use client';
import { useEffect, useState } from 'react';
import { QueryClient } from '@tanstack/react-query';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import { createAsyncStoragePersister } from '@tanstack/query-async-storage-persister';
import { AuthProvider } from '@/lib/auth';
import { getDb, RQ_CACHE_KEY } from '@/lib/offline/db';
import { SyncProvider } from './sync-provider';

const WEEK = 7 * 24 * 60 * 60 * 1000;

/** Almacenamiento de la cache de React Query en IndexedDB (Dexie), no en localStorage (5 MB). */
const dexieStorage = {
  getItem: async (key: string) => (await getDb().kv.get(key))?.value ?? null,
  setItem: async (key: string, value: string) => { await getDb().kv.put({ key, value }); },
  removeItem: async (key: string) => { await getDb().kv.delete(key); },
};

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            // La cache persistida debe vivir al menos tanto como maxAge, o se descarta antes de restaurarse
            gcTime: WEEK,
            retry: 1,
            refetchOnWindowFocus: true,
            // Al volver la red primero se vacia la cola de sincronizacion y despues se refrescan los datos
            // (lo hace el motor de sync), para que un refetch no pise cambios locales pendientes.
            refetchOnReconnect: false,
          },
        },
      }),
  );
  const [persister] = useState(() => createAsyncStoragePersister({ storage: dexieStorage, key: RQ_CACHE_KEY, throttleTime: 1000 }));

  useEffect(() => {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => undefined);
  }, []);

  return (
    <PersistQueryClientProvider
      client={client}
      persistOptions={{
        persister,
        maxAge: WEEK,
        buster: 'lavio-1',
        dehydrateOptions: {
          // La consulta publica del cliente no se guarda en el dispositivo del personal
          shouldDehydrateQuery: (q) => q.state.status === 'success' && q.queryKey[0] !== 'track',
        },
      }}
    >
      <AuthProvider>
        <SyncProvider>{children}</SyncProvider>
      </AuthProvider>
    </PersistQueryClientProvider>
  );
}
