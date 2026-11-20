'use client';
import { useState } from 'react';
import { Download } from 'lucide-react';
import { download } from '@/lib/api';
import { useAuth } from '@/lib/auth';

/** Reporte -> recurso (igual que REPORT_RESOURCE del backend). */
const RES: Record<string, string> = { orders: 'orders', payments: 'cash', services: 'services', clients: 'clients', inventory: 'inventory', movements: 'inventory', purchases: 'purchases', suppliers: 'suppliers', users: 'users', 'cash-sessions': 'cash', 'cash-movements': 'cash', 'cash-closing': 'cash' };
import { Button } from './ui';

/** Descarga /reports/:type como CSV (abre en Excel). `params` agrega from/to u otros filtros. */
export function DownloadButton({ type, params, label = 'Descargar CSV' }: { type: string; params?: Record<string, string | undefined>; label?: string }) {
  const { can } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function go() {
    setBusy(true);
    setErr('');
    try {
      const qs = new URLSearchParams(Object.entries(params ?? {}).filter(([, v]) => v) as [string, string][]).toString();
      await download(`/reports/${type}${qs ? `?${qs}` : ''}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (RES[type] && !can(RES[type] + ':export')) return null;
  return (
    <span className="inline-flex flex-col items-end">
      <Button variant="outline" size="sm" onClick={go} disabled={busy}>
        <Download className="h-4 w-4" />{busy ? 'Generando…' : label}
      </Button>
      {err && <span className="text-xs text-destructive">{err}</span>}
    </span>
  );
}
