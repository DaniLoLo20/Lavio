'use client';
import { cn } from '@/lib/utils';

/** Fondo con luces suaves (estilo iOS) para que el vidrio de las tarjetas se note. Las luces quedan recortadas dentro de la página. */
export function GlassPage({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn('relative isolate -mx-4 -mt-4 min-h-[calc(100dvh-3.5rem)] overflow-hidden px-4 pb-24 pt-6 md:-mx-8 md:-mt-8 md:min-h-screen md:px-8 md:pb-10 md:pt-8', className)}>
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 bg-gradient-to-b from-sky-50 via-background to-background dark:from-slate-900/60">
        <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-sky-300/40 blur-3xl dark:bg-sky-500/20" />
        <div className="absolute -right-20 top-40 h-72 w-72 rounded-full bg-violet-300/30 blur-3xl dark:bg-violet-500/15" />
        <div className="absolute -bottom-20 left-1/4 h-72 w-72 rounded-full bg-emerald-200/40 blur-3xl dark:bg-emerald-500/10" />
      </div>
      {children}
    </div>
  );
}

/** Solo las luces de fondo (para pantallas completas como el Modo Voz). */
export function GlassBlobs() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden bg-gradient-to-b from-sky-50 via-background to-background dark:from-slate-900/60">
      <div className="absolute -left-24 -top-24 h-72 w-72 rounded-full bg-sky-300/40 blur-3xl dark:bg-sky-500/20" />
      <div className="absolute -right-20 top-40 h-72 w-72 rounded-full bg-violet-300/30 blur-3xl dark:bg-violet-500/15" />
      <div className="absolute -bottom-20 left-1/4 h-72 w-72 rounded-full bg-emerald-200/40 blur-3xl dark:bg-emerald-500/10" />
    </div>
  );
}

/** Tarjeta de vidrio esmerilado. */
export function Glass({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-3xl border border-white/60 bg-white/60 shadow-[0_8px_30px_rgba(30,41,90,0.08)] backdrop-blur-xl dark:border-white/10 dark:bg-white/[0.06] dark:shadow-none', className)} {...p} />;
}

/** Sección tipo «lista agrupada» de iOS: título pequeño y filas separadas por una línea fina. */
export function Section({ title, right, children, className }: { title?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={className}>
      {(title || right) && (
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-2">
          {title && <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h2>}
          {right}
        </div>
      )}
      <Glass className="divide-y divide-black/5 overflow-hidden dark:divide-white/10">{children}</Glass>
    </section>
  );
}

/** Control segmentado (pestañas) como el de iOS. */
export function Segmented<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: { k: T; label: string; icon?: React.ComponentType<{ className?: string }>; badge?: number }[]; label: string }) {
  return (
    <div role="tablist" aria-label={label} className="flex gap-1 overflow-x-auto rounded-2xl border border-white/60 bg-black/5 p-1 backdrop-blur-xl [scrollbar-width:none] dark:border-white/10 dark:bg-white/10">
      {items.map((it) => {
        const on = it.k === value;
        return (
          <button
            key={it.k}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(it.k)}
            className={cn('flex min-w-fit flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-2.5 py-2 text-[13px] font-medium transition sm:px-3 sm:text-sm', on ? 'bg-white text-foreground shadow-sm dark:bg-white/20' : 'text-muted-foreground active:bg-white/40')}
          >
            {it.icon && <it.icon className="hidden h-4 w-4 min-[430px]:block" />}{it.label}
            {!!it.badge && <span className="rounded-full bg-amber-500 px-1.5 text-[10px] font-bold text-white">{it.badge}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** Dato pequeño dentro de una tarjeta: etiqueta arriba, valor abajo. */
export function Mini({ label, value, sub, tone }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: 'green' | 'red' }) {
  return (
    <div className="rounded-2xl bg-white/60 px-3 py-2 dark:bg-white/5">
      <p className="text-[11px] text-muted-foreground">{label}</p>
      <p className={cn('truncate text-sm font-semibold tabular-nums', tone === 'green' && 'text-emerald-600', tone === 'red' && 'text-red-600')}>{value}</p>
      {sub && <p className="truncate text-[10px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** Botón de acción grande con icono en círculo de color (como los accesos de iOS). */
export function Action({ icon: Icon, label, tone, onClick, disabled }: { icon: React.ComponentType<{ className?: string }>; label: string; tone: 'green' | 'red' | 'slate'; onClick: () => void; disabled?: boolean }) {
  const c = { green: 'bg-emerald-500', red: 'bg-red-500', slate: 'bg-slate-700 dark:bg-slate-500' }[tone];
  return (
    <button type="button" onClick={onClick} disabled={disabled} className="flex flex-col items-center gap-1.5 rounded-2xl border border-white/60 bg-white/70 py-3 text-xs font-medium shadow-sm backdrop-blur transition active:scale-95 disabled:opacity-40 dark:border-white/10 dark:bg-white/10">
      <span className={cn('grid h-9 w-9 place-items-center rounded-full text-white shadow', c)}><Icon className="h-5 w-5" /></span>
      {label}
    </button>
  );
}
