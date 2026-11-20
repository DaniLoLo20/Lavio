'use client';
import { ArrowDownCircle, ArrowUpCircle, Paperclip, Trash2 } from 'lucide-react';
import { fetchBlobUrl } from '@/lib/api';
import { CAT_LABEL } from '@/lib/cash';
import { METHODS, cn, dateTime, money } from '@/lib/utils';
import { Button, Empty } from '@/components/ui';

async function openEvidence(id: string) {
  const url = await fetchBlobUrl(`/cash/movements/${id}/evidence`);
  window.open(url, '_blank');
}

export function MovementsTable({ rows, cur, onDelete, deleting }: { rows: any[]; cur?: string; onDelete?: (id: string) => void; deleting?: boolean }) {
  if (!rows.length) return <Empty text="Sin movimientos manuales" />;
  return (
    <div className="divide-y">
      {rows.map((m) => (
        <div key={m.id} className="flex items-center justify-between gap-3 p-3 text-sm">
          <div className="flex min-w-0 items-center gap-3">
            {m.type === 'INCOME' ? <ArrowUpCircle className="h-5 w-5 shrink-0 text-emerald-600" /> : <ArrowDownCircle className="h-5 w-5 shrink-0 text-red-600" />}
            <div className="min-w-0">
              <p className="truncate font-medium">{m.concept}</p>
              <p className="truncate text-xs text-muted-foreground">
                {CAT_LABEL[m.category] ?? m.category} · {METHODS[m.method]} · {m.responsibleName} · {dateTime(m.occurredAt)}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <span className={cn('font-semibold', m.type === 'INCOME' ? 'text-emerald-600' : 'text-red-600')}>{m.type === 'INCOME' ? '+' : '−'}{money(m.amount, cur)}</span>
            {m.hasEvidence && <Button size="icon" variant="ghost" aria-label="Ver comprobante" onClick={() => openEvidence(m.id)}><Paperclip className="h-4 w-4" /></Button>}
            {onDelete && <Button size="icon" variant="ghost" aria-label="Eliminar" disabled={deleting} onClick={() => confirm('¿Eliminar este movimiento?') && onDelete(m.id)}><Trash2 className="h-4 w-4" /></Button>}
          </div>
        </div>
      ))}
    </div>
  );
}

