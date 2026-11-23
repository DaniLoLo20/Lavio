'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import { useAuth } from './auth';
import type { ClientLite } from './client-match';

export * from './client-match';

/** Índice de clientes para autocompletar (se guarda en caché: también sirve sin conexión). */
export function useClientIndex(): ClientLite[] {
  const { can } = useAuth();
  const q = useQuery({
    queryKey: ['clients', 'lookup'],
    queryFn: () => api<ClientLite[]>('/clients/lookup'),
    enabled: can('clients:view') || can('orders:create'),
    staleTime: 60_000,
  });
  return q.data ?? [];
}
