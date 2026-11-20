'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';

const KEY = 'al_fab_pos';
export const FAB_RESET_EVENT = 'al-fab-reset';

/** Restablece la posición del botón flotante a su lugar original. */
export function resetFabPosition() {
  try { localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ }
  window.dispatchEvent(new Event(FAB_RESET_EVENT));
}

interface Props {
  onActivate: () => void;
  label: string;
  /** Posición inicial (px desde la esquina superior izquierda) según el tamaño de pantalla y del botón */
  defaultPos: (vw: number, vh: number, w: number, h: number) => { x: number; y: number };
  className?: string;
  children: React.ReactNode;
}

/**
 * Botón flotante que se puede arrastrar a cualquier parte (dedo o ratón) para que no estorbe.
 * La posición se guarda en el dispositivo (como proporción de la pantalla) y se ajusta si cambia el tamaño.
 * Un toque corto lo activa; arrastrar más de 6 px solo lo mueve.
 */
export function DraggableFab({ onActivate, label, defaultPos, className, children }: Props) {
  const ref = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const drag = useRef<{ sx: number; sy: number; ox: number; oy: number; moved: boolean } | null>(null);
  const suppressClick = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null); // ultima posicion del arrastre (sin depender del render)

  const clamp = useCallback((x: number, y: number) => {
    const r = ref.current?.getBoundingClientRect();
    const w = r?.width ?? 56, h = r?.height ?? 56;
    return { x: Math.min(Math.max(8, x), Math.max(8, window.innerWidth - w - 8)), y: Math.min(Math.max(8, y), Math.max(8, window.innerHeight - h - 8)) };
  }, []);

  const place = useCallback(() => {
    const r = ref.current?.getBoundingClientRect();
    const w = r?.width ?? 56, h = r?.height ?? 56;
    let next: { x: number; y: number } | null = null;
    try {
      const s = JSON.parse(localStorage.getItem(KEY) || 'null');
      if (s && typeof s.fx === 'number' && typeof s.fy === 'number') next = { x: s.fx * window.innerWidth, y: s.fy * window.innerHeight };
    } catch { /* posición guardada inválida */ }
    const p = next ?? defaultPos(window.innerWidth, window.innerHeight, w, h);
    setPos(clamp(p.x, p.y));
  }, [clamp, defaultPos]);

  useEffect(() => {
    place();
    const onResize = () => setPos((p) => (p ? clamp(p.x, p.y) : p));
    window.addEventListener('resize', onResize);
    window.addEventListener(FAB_RESET_EVENT, place);
    return () => { window.removeEventListener('resize', onResize); window.removeEventListener(FAB_RESET_EVENT, place); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <button
      ref={ref}
      type="button"
      aria-label={label}
      title="Toca para activar · arrastra para mover"
      onPointerDown={(e) => {
        if (!pos) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        drag.current = { sx: e.clientX, sy: e.clientY, ox: pos.x, oy: pos.y, moved: false };
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (!d) return;
        const dx = e.clientX - d.sx, dy = e.clientY - d.sy;
        if (!d.moved && Math.hypot(dx, dy) > 6) { d.moved = true; setDragging(true); }
        if (d.moved) { const p = clamp(d.ox + dx, d.oy + dy); last.current = p; setPos(p); }
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        drag.current = null;
        setDragging(false);
        if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
        if (d?.moved) {
          suppressClick.current = true; // el "click" que sigue a un arrastre no debe activar el botón
          setTimeout(() => { suppressClick.current = false; }, 0);
          const p = last.current;
          // se guarda la posicion calculada (no el rectangulo, que mientras se arrastra esta agrandado)
          if (p) { try { localStorage.setItem(KEY, JSON.stringify({ fx: p.x / window.innerWidth, fy: p.y / window.innerHeight })); } catch { /* sin almacenamiento */ } }
        }
      }}
      onPointerCancel={() => { drag.current = null; setDragging(false); }}
      onClick={() => { if (suppressClick.current) return; onActivate(); }}
      style={{ left: pos?.x ?? 0, top: pos?.y ?? 0, touchAction: 'none', visibility: pos ? 'visible' : 'hidden' }}
      className={cn('fixed z-40 select-none print:hidden', dragging ? 'cursor-grabbing scale-110 shadow-2xl' : 'cursor-grab', className)}
    >
      {children}
    </button>
  );
}
