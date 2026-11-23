'use client';
import { X } from 'lucide-react';
import { Button } from './ui';
import { Portal } from './portal';

/** Ventana modal (hoja inferior en celular). Solo se cierra con la X para no perder datos capturados. */
export function Modal({ title, onClose, children, wide }: { title: string; onClose?: () => void; children: React.ReactNode; wide?: boolean }) {
  return (
    <Portal>
    <div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/30 backdrop-blur-sm sm:items-center sm:p-4 print:hidden">
      <div className={`flex max-h-[94dvh] w-full flex-col overflow-hidden rounded-t-3xl border border-white/60 bg-card/90 shadow-2xl backdrop-blur-2xl sm:rounded-3xl dark:border-white/10 ${wide ? 'max-w-3xl' : 'max-w-xl'}`}>
        <div aria-hidden className="mx-auto mt-2 h-1 w-10 shrink-0 rounded-full bg-black/15 sm:hidden dark:bg-white/20" />
        <div className="flex items-center justify-between border-b border-black/5 px-4 py-3">
          <h2 className="font-semibold">{title}</h2>
          {onClose && <Button variant="ghost" size="icon" onClick={onClose} aria-label="Cerrar"><X className="h-4 w-4" /></Button>}
        </div>
        <div className="overflow-y-auto">{children}</div>
      </div>
    </div>
    </Portal>
  );
}
