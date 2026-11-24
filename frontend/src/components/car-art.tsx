/** Ilustración de un auto (SVG propio, sin imágenes externas) con un color distinto por servicio y gotas de agua. */
const hue = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7);

export function CarArt({ name, className = 'h-16 w-24' }: { name: string; className?: string }) {
  const h = hue(name);
  const body = `hsl(${h} 70% 48%)`;
  const dark = `hsl(${h} 70% 34%)`;
  const id = `bg${h}`;
  return (
    <svg viewBox="0 0 120 80" className={className} role="img" aria-label={`Auto: ${name}`}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={`hsl(${h} 80% 94%)`} />
          <stop offset="1" stopColor={`hsl(${h} 60% 84%)`} />
        </linearGradient>
      </defs>
      <rect width="120" height="80" rx="10" fill={`url(#${id})`} />
      {/* burbujas */}
      <circle cx="18" cy="18" r="4" fill="#fff" opacity=".8" />
      <circle cx="30" cy="30" r="2.5" fill="#fff" opacity=".7" />
      <circle cx="104" cy="16" r="3.5" fill="#fff" opacity=".8" />
      <circle cx="94" cy="28" r="2" fill="#fff" opacity=".7" />
      <path d="M60 8l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" fill="#fff" opacity=".9" />
      {/* sombra */}
      <ellipse cx="60" cy="62" rx="40" ry="4" fill="#000" opacity=".12" />
      {/* carrocería */}
      <path d="M16 56c0-7 3-11 9-12l10-14c2-3 5-4 9-4h28c4 0 7 1 10 4l11 13c7 1 12 4 12 11v4c0 2-1 3-3 3H19c-2 0-3-1-3-3z" fill={body} />
      <path d="M16 56c0-7 3-11 9-12l10-14c2-3 5-4 9-4h28c4 0 7 1 10 4l11 13c7 1 12 4 12 11v4H16z" fill={dark} opacity=".18" />
      {/* ventanas */}
      <path d="M39 33l6-8c1-1 2-2 4-2h12v11z" fill="#eaf6ff" />
      <path d="M65 23h8c2 0 3 1 4 2l7 8H65z" fill="#eaf6ff" />
      {/* faros */}
      <rect x="104" y="47" width="7" height="4" rx="2" fill="#fff4b3" />
      <rect x="9" y="47" width="6" height="4" rx="2" fill="#ff8a8a" />
      {/* ruedas */}
      <circle cx="38" cy="60" r="9" fill="#1f2937" /><circle cx="38" cy="60" r="4" fill="#cbd5e1" />
      <circle cx="86" cy="60" r="9" fill="#1f2937" /><circle cx="86" cy="60" r="4" fill="#cbd5e1" />
    </svg>
  );
}

/** Ilustración para servicios/productos que no piden vehículo (una bolsa de compra), con el mismo estilo que CarArt. */
export function ProductArt({ name, className = 'h-16 w-24' }: { name: string; className?: string }) {
  const h = hue(name);
  const body = `hsl(${h} 70% 48%)`;
  const id = `pb${h}`;
  return (
    <svg viewBox="0 0 120 80" className={className} role="img" aria-label={`Producto: ${name}`}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={`hsl(${h} 80% 94%)`} />
          <stop offset="1" stopColor={`hsl(${h} 60% 84%)`} />
        </linearGradient>
      </defs>
      <rect width="120" height="80" rx="10" fill={`url(#${id})`} />
      <circle cx="20" cy="18" r="4" fill="#fff" opacity=".8" />
      <circle cx="100" cy="20" r="3" fill="#fff" opacity=".8" />
      <path d="M60 8l2 4 4 2-4 2-2 4-2-4-4-2 4-2z" fill="#fff" opacity=".9" />
      <ellipse cx="60" cy="68" rx="26" ry="3.5" fill="#000" opacity=".12" />
      <path d="M50 30v-4a10 10 0 0 1 20 0v4" fill="none" stroke={body} strokeWidth="4" strokeLinecap="round" />
      <path d="M38 30h44l-4 34H42z" fill={body} />
      <path d="M38 30h44l-1 8H39z" fill="#000" opacity=".12" />
      <circle cx="51" cy="40" r="2.5" fill="#fff" opacity=".9" /><circle cx="69" cy="40" r="2.5" fill="#fff" opacity=".9" />
    </svg>
  );
}
