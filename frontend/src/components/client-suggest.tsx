'use client';
import { UserCheck } from 'lucide-react';
import { searchClients, clientLabel, type ClientLite } from '@/lib/clients';

/** Lista de clientes existentes que coinciden con lo escrito/dictado. Al elegir uno se rellenan sus datos. */
export function ClientSuggest({ clients, query, selectedId, onPick, className = '' }: {
  clients: ClientLite[];
  query: string;
  selectedId?: string;
  onPick: (c: ClientLite) => void;
  className?: string;
}) {
  const matches = searchClients(clients, query).filter((c) => c.id !== selectedId);
  if (!matches.length) return null;
  return (
    <ul className={`mt-1 overflow-hidden rounded-md border bg-card text-sm shadow-sm ${className}`} role="listbox" aria-label="Clientes existentes">
      {matches.map((c) => (
        <li key={c.id}>
          <button type="button" role="option" aria-selected={false} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(c)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted">
            <UserCheck className="h-4 w-4 shrink-0 text-primary" />
            <span className="min-w-0 flex-1 truncate">{clientLabel(c)}</span>
            {c.vehicles[0] && <span className="shrink-0 text-xs text-muted-foreground">{c.vehicles[0].plate}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** Aviso cuando ya hay un cliente elegido. */
export function SelectedClientNote({ client, onClear }: { client?: ClientLite; onClear: () => void }) {
  if (!client) return null;
  return (
    <p className="flex items-center gap-2 rounded-md bg-emerald-500/10 px-3 py-1.5 text-xs text-emerald-700 dark:text-emerald-300">
      <UserCheck className="h-4 w-4" />Cliente existente: {clientLabel(client)}. No se creará de nuevo.
      <button type="button" className="ml-auto underline" onClick={onClear}>Quitar</button>
    </p>
  );
}
