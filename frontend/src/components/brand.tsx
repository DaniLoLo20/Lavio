import { cn } from '@/lib/utils';

export const BRAND = { name: 'Lavio', tagline: 'Control inteligente para tu autolavado' };

/** Gota + auto sobre una ficha blanca (se ve bien en modo claro y oscuro). */
export function LogoMark({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cn('inline-grid shrink-0 place-items-center overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/5', className)}
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/lavio-mark.png" alt="Lavio" className="h-full w-full object-contain" draggable={false} />
    </span>
  );
}

/** Imagen del negocio (logo que sube cada empresa); si no tiene, la marca Lavio. */
export function TenantMark({ url, size = 36, className }: { url?: string | null; size?: number; className?: string }) {
  if (!url) return <LogoMark size={size} className={className} />;
  return (
    <span className={cn('inline-grid shrink-0 place-items-center overflow-hidden rounded-xl bg-white shadow-sm ring-1 ring-black/5', className)} style={{ width: size, height: size }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="Logo del negocio" className="h-full w-full object-contain p-0.5" draggable={false} />
    </span>
  );
}

/** Logo completo: marca + nombre + eslogan. */
export function LogoFull({ className }: { className?: string }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src="/brand/lavio-full.png" alt={`${BRAND.name} - ${BRAND.tagline}`} className={cn('h-auto select-none', className)} draggable={false} />
  );
}

/** Pantalla de carga con la marca. */
export function Splash({ text = 'Cargando…' }: { text?: string }) {
  return (
    <div className="grid min-h-screen place-items-center">
      <div className="flex flex-col items-center gap-4">
        <LogoMark size={92} className="animate-float rounded-3xl shadow-xl" />
        <p className="brand-text text-lg font-semibold tracking-tight">{BRAND.name}</p>
        <p className="text-xs text-muted-foreground">{text}</p>
      </div>
    </div>
  );
}
