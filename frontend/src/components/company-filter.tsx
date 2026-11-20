'use client';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { Select } from './ui';

export interface TenantOption { id: string; name: string; slug: string; isActive: boolean; users: number; maxUsers: number }

export function useTenants() {
  return useQuery({ queryKey: ['platform', 'tenants'], queryFn: () => api<TenantOption[]>('/platform/tenants') });
}

/** Selector de empresa. `allLabel` = texto de la opción vacía (ej. "Todas las empresas"). */
export function CompanySelect({ value, onChange, allLabel, onlyActive, className, required }: { value: string; onChange: (id: string) => void; allLabel?: string; onlyActive?: boolean; className?: string; required?: boolean }) {
  const { data } = useTenants();
  const list = (data ?? []).filter((t) => !onlyActive || t.isActive);
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={className} required={required}>
      <option value="">{allLabel ?? 'Seleccione empresa…'}</option>
      {list.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
    </Select>
  );
}
