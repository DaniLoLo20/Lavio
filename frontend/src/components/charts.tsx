// Gráficas SVG ligeras (sin dependencias). Colores vía variables CSS para modo claro/oscuro.
export const PALETTE = ['hsl(var(--primary))', '#10b981', '#f59e0b', '#06b6d4', '#ec4899', '#8b5cf6', '#64748b'];

const compact = (n: number) => new Intl.NumberFormat('es-MX', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

export function AreaChart({ data, format = compact }: { data: { label: string; value: number }[]; format?: (n: number) => string }) {
  const W = 600, H = 200, padL = 38, padB = 22, padT = 10;
  const max = Math.max(...data.map((d) => d.value), 1);
  const x = (i: number) => padL + (data.length === 1 ? 0 : (i / (data.length - 1)) * (W - padL - 6));
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(data.length - 1).toFixed(1)},${H - padB} L${x(0).toFixed(1)},${H - padB} Z`;
  const ticks = [0, 0.5, 1];
  const step = Math.max(Math.ceil(data.length / 6), 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      <defs>
        <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.35" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0" />
        </linearGradient>
      </defs>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={padL} x2={W} y1={y(max * t)} y2={y(max * t)} stroke="hsl(var(--border))" strokeDasharray="3 3" />
          <text x={padL - 6} y={y(max * t) + 3} textAnchor="end" fontSize="10" fill="hsl(var(--muted-foreground))">{format(max * t)}</text>
        </g>
      ))}
      <path d={area} fill="url(#areaFill)" />
      <path d={line} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinejoin="round" />
      {data.map((d, i) => (
        <g key={i}>
          {i % step === 0 && <text x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="hsl(var(--muted-foreground))">{d.label}</text>}
          <circle cx={x(i)} cy={y(d.value)} r={data.length > 40 ? 6 : 8} fill="transparent" stroke="none"><title>{`${d.label}: ${format(d.value)}`}</title></circle>
          {data.length <= 31 && <circle cx={x(i)} cy={y(d.value)} r="2.5" fill="hsl(var(--primary))" pointerEvents="none" />}
        </g>
      ))}
    </svg>
  );
}

export function BarChart({ data, format = compact, height = 160 }: { data: { label: string; value: number }[]; format?: (n: number) => string; height?: number }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="flex items-end gap-1.5" style={{ height }}>
      {data.map((d, i) => (
        <div key={i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1" title={`${d.label}: ${format(d.value)}`}>
          <span className="text-[10px] text-muted-foreground">{d.value ? format(d.value) : ''}</span>
          <div className="w-full rounded-t bg-primary/80 transition-all" style={{ height: `${Math.max((d.value / max) * 75, d.value ? 3 : 0)}%` }} />
          <span className="w-full truncate text-center text-[10px] text-muted-foreground">{d.label}</span>
        </div>
      ))}
    </div>
  );
}

export function HBar({ data, format = compact }: { data: { label: string; value: number; sub?: string }[]; format?: (n: number) => string }) {
  const max = Math.max(...data.map((d) => d.value), 1);
  return (
    <div className="space-y-3">
      {data.map((d, i) => (
        <div key={i}>
          <div className="mb-1 flex justify-between gap-2 text-xs"><span className="truncate">{d.label}{d.sub && <span className="text-muted-foreground"> · {d.sub}</span>}</span><span className="font-medium">{format(d.value)}</span></div>
          <div className="h-2 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${(d.value / max) * 100}%`, background: PALETTE[i % PALETTE.length] }} /></div>
        </div>
      ))}
    </div>
  );
}

export function Donut({ data, format = compact }: { data: { label: string; value: number }[]; format?: (n: number) => string }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const R = 42, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <div className="flex items-center gap-4">
      <svg viewBox="0 0 100 100" className="h-32 w-32 shrink-0 -rotate-90">
        <circle cx="50" cy="50" r={R} fill="none" stroke="hsl(var(--muted))" strokeWidth="14" />
        {total > 0 && data.map((d, i) => {
          const len = (d.value / total) * C;
          const el = <circle key={i} cx="50" cy="50" r={R} fill="none" stroke={PALETTE[i % PALETTE.length]} strokeWidth="14" strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc}><title>{`${d.label}: ${format(d.value)}`}</title></circle>;
          acc += len;
          return el;
        })}
      </svg>
      <ul className="min-w-0 flex-1 space-y-1.5 text-xs">
        {data.map((d, i) => (
          <li key={i} className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="truncate">{d.label}</span>
            <span className="ml-auto font-medium">{total ? Math.round((d.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Barras agrupadas (ej. ingresos vs egresos por dia). */
export function GroupedBars({ data, aLabel, bLabel, format = compact }: { data: { label: string; a: number; b: number }[]; aLabel: string; bLabel: string; format?: (n: number) => string }) {
  const W = 600, H = 200, padL = 38, padB = 22, padT = 10;
  const max = Math.max(...data.flatMap((d) => [d.a, d.b]), 1);
  const slot = (W - padL - 6) / data.length;
  const bw = Math.max(Math.min(slot / 2 - 1, 12), 1.5);
  const y = (v: number) => padT + (1 - v / max) * (H - padT - padB);
  const step = Math.max(Math.ceil(data.length / 6), 1);
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
        {[0, 0.5, 1].map((tk) => (
          <g key={tk}>
            <line x1={padL} x2={W} y1={y(max * tk)} y2={y(max * tk)} stroke="hsl(var(--border))" strokeDasharray="3 3" />
            <text x={padL - 6} y={y(max * tk) + 3} textAnchor="end" fontSize="10" fill="hsl(var(--muted-foreground))">{format(max * tk)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = padL + slot * i + slot / 2;
          return (
            <g key={i}>
              <rect x={cx - bw - 0.5} y={y(d.a)} width={bw} height={Math.max(H - padB - y(d.a), 0)} rx="1.5" fill="#10b981"><title>{`${d.label} · ${aLabel}: ${format(d.a)}`}</title></rect>
              <rect x={cx + 0.5} y={y(d.b)} width={bw} height={Math.max(H - padB - y(d.b), 0)} rx="1.5" fill="#ef4444"><title>{`${d.label} · ${bLabel}: ${format(d.b)}`}</title></rect>
              {i % step === 0 && <text x={cx} y={H - 6} textAnchor="middle" fontSize="10" fill="hsl(var(--muted-foreground))">{d.label}</text>}
            </g>
          );
        })}
      </svg>
      <div className="mt-1 flex justify-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-emerald-500" />{aLabel}</span>
        <span className="flex items-center gap-1"><i className="h-2.5 w-2.5 rounded-sm bg-red-500" />{bLabel}</span>
      </div>
    </div>
  );
}

/** Linea/area que admite valores negativos (ej. flujo acumulado). */
export function SignedAreaChart({ data, format = compact }: { data: { label: string; value: number }[]; format?: (n: number) => string }) {
  const W = 600, H = 200, padL = 38, padB = 22, padT = 10;
  const lo = Math.min(0, ...data.map((d) => d.value)), hi = Math.max(0, ...data.map((d) => d.value));
  const span = hi - lo || 1;
  const x = (i: number) => padL + (data.length === 1 ? 0 : (i / (data.length - 1)) * (W - padL - 6));
  const y = (v: number) => padT + (1 - (v - lo) / span) * (H - padT - padB);
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(' ');
  const area = `${line} L${x(data.length - 1).toFixed(1)},${y(0).toFixed(1)} L${x(0).toFixed(1)},${y(0).toFixed(1)} Z`;
  const step = Math.max(Math.ceil(data.length / 6), 1);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img">
      <defs>
        <linearGradient id="signedFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity="0.3" />
          <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {[lo, (lo + hi) / 2, hi].map((tk, i) => (
        <g key={i}>
          <line x1={padL} x2={W} y1={y(tk)} y2={y(tk)} stroke="hsl(var(--border))" strokeDasharray="3 3" />
          <text x={padL - 6} y={y(tk) + 3} textAnchor="end" fontSize="10" fill="hsl(var(--muted-foreground))">{format(tk)}</text>
        </g>
      ))}
      <line x1={padL} x2={W} y1={y(0)} y2={y(0)} stroke="hsl(var(--muted-foreground))" strokeWidth="1" />
      <path d={area} fill="url(#signedFill)" />
      <path d={line} fill="none" stroke="hsl(var(--primary))" strokeWidth="2" strokeLinejoin="round" />
      {data.map((d, i) => (
        <g key={i}>
          {i % step === 0 && <text x={x(i)} y={H - 6} textAnchor="middle" fontSize="10" fill="hsl(var(--muted-foreground))">{d.label}</text>}
          <circle cx={x(i)} cy={y(d.value)} r="7" fill="transparent"><title>{`${d.label}: ${format(d.value)}`}</title></circle>
        </g>
      ))}
    </svg>
  );
}