'use client';
import { X } from 'lucide-react';
import { Button } from './ui';

/** Ventana modal (hoja inferior en celular). Solo se cierra con la X para no perder datos capturados. */
export function Modal({ title, onClose, children, wide }: { title: string; onClose?: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/50 sm:items-center sm:p-4 print:hidden">
      <div className={`flex max-h-[95vh] w-full flex-col overflow-hidden rounded-t-xl border bg-card shadow-xl sm:rounded-xl ${wide ? 'max-w-3xl' : 'max-w-xl'}`}>
        <div className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold">{title}</h2>
          {onClose && <Button variant="ghost" size="icon" onClick={onClose} aria-label="Cerrar"><X className="h-4 w-4" /></Button>}
        </div>
        <div className="overflow-y-auto">{children}</div>
      </div>
    </div>
  );
}
