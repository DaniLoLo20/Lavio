'use client';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronDown, RotateCcw, Smartphone } from 'lucide-react';
import { api } from '@/lib/api';
import { TENANT_MENU, applyLayout, defaultLayout, flatItems, type LayoutEntry, type MenuLayout } from '@/lib/menu';
import { cn } from '@/lib/utils';
import { Button, ErrorText, Input } from '@/components/ui';
import { Glass, GlassPage, Section } from '@/components/glass';

const ITEMS = new Map(flatItems(TENANT_MENU).map((i) => [i.href, i] as const));
const GROUPS = new Map(TENANT_MENU.filter((e) => e.type === 'group').map((g) => [(g as any).key as string, g as any]));
const TOP = '__top';

const move = <T,>(a: T[], i: number, d: number) => { const j = i + d; if (j < 0 || j >= a.length) return a; const b = [...a]; [b[i], b[j]] = [b[j], b[i]]; return b; };

/** Completa un orden guardado con lo que falte (secciones nuevas) para editarlo sin perder nada. */
function normalize(layout: MenuLayout | null): MenuLayout {
  const base = applyLayout(TENANT_MENU, layout);
  return base.map((e) => (e.type === 'item' ? { type: 'item', href: e.item.href } : { type: 'group', key: e.key, label: layout?.find((x) => x.type === 'group' && x.key === e.key && (x as any).label) ? (layout.find((x) => x.type === 'group' && x.key === e.key) as any).label : undefined, items: e.items.map((i) => i.href) }));
}

function Arrows({ onUp, onDown, upOff, downOff, label }: { onUp: () => void; onDown: () => void; upOff: boolean; downOff: boolean; label: string }) {
  return (
    <span className="flex shrink-0 gap-1">
      <button type="button" aria-label={`Subir ${label}`} disabled={upOff} onClick={onUp} className="grid h-8 w-8 place-items-center rounded-full bg-black/5 transition active:scale-90 disabled:opacity-30 dark:bg-white/10"><ArrowUp className="h-4 w-4" /></button>
      <button type="button" aria-label={`Bajar ${label}`} disabled={downOff} onClick={onDown} className="grid h-8 w-8 place-items-center rounded-full bg-black/5 transition active:scale-90 disabled:opacity-30 dark:bg-white/10"><ArrowDown className="h-4 w-4" /></button>
    </span>
  );
}

export default function MenuOrderPage() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['menu', 'layout'], queryFn: () => api<{ layout: MenuLayout | null; updatedAt: string | null }>('/menu/layout') });
  const [L, setL] = useState<MenuLayout | null>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => { if (q.data && !L) setL(normalize(q.data.layout)); }, [q.data, L]);

  const done = (r: { layout: MenuLayout | null }) => { qc.setQueryData(['menu', 'layout'], r); setL(normalize(r.layout)); setSaved(true); };
  const save = useMutation({ mutationFn: () => api<{ layout: MenuLayout | null }>('/platform/menu', { method: 'PUT', body: { layout: L } }), onSuccess: done });
  const reset = useMutation({ mutationFn: () => api<{ layout: MenuLayout | null }>('/platform/menu', { method: 'DELETE' }), onSuccess: done });
  const edit = (f: (l: MenuLayout) => MenuLayout) => { setSaved(false); setL((l) => (l ? f(l) : l)); };

  /** Mueve una sección a otro grupo (o al menú principal, como acceso suelto). */
  function relocate(href: string, target: string) {
    edit((l) => {
      const out: MenuLayout = l
        .map((e) => (e.type === 'group' ? { ...e, items: e.items.filter((h) => h !== href) } : e))
        .filter((e) => !(e.type === 'item' && e.href === href));
      if (target === TOP) {
        // queda justo donde estaba su grupo, para que el cambio sea fácil de ver
        const gi = l.findIndex((e) => e.type === 'group' && e.items.includes(href));
        out.splice(gi >= 0 ? gi : out.length, 0, { type: 'item', href });
        return out;
      }
      return out.map((e) => (e.type === 'group' && e.key === target ? { ...e, items: [...e.items, href] } : e));
    });
  }

  const groupKeys = (L ?? []).filter((e): e is Extract<LayoutEntry, { type: 'group' }> => e.type === 'group').map((g) => g.key);
  const groupLabel = (key: string) => (L?.find((e) => e.type === 'group' && e.key === key) as any)?.label || GROUPS.get(key)?.label || key;
  const where = (href: string) => (L ?? []).find((e) => e.type === 'group' && e.items.includes(href)) as any;
  const preview = useMemo(() => applyLayout(TENANT_MENU, L), [L]);
  const bottom = flatItems(preview).slice(0, 4);

  if (!L) return <GlassPage><p className="text-sm text-muted-foreground">Cargando…</p></GlassPage>;

  const Relocate = ({ href }: { href: string }) => {
    const cur = where(href)?.key ?? TOP;
    return (
      <select aria-label={`Mover ${ITEMS.get(href)?.label}`} value={cur} onChange={(e) => relocate(href, e.target.value)} className="h-8 max-w-[9.5rem] shrink-0 rounded-full border-0 bg-black/5 px-2 text-xs dark:bg-white/10">
        <option value={TOP}>Suelto (menú principal)</option>
        {groupKeys.map((k) => <option key={k} value={k}>En «{groupLabel(k)}»</option>)}
      </select>
    );
  };

  return (
    <GlassPage>
      <div className="mx-auto max-w-5xl space-y-4">
        <header className="px-1">
          <h1 className="text-3xl font-bold tracking-tight">Orden del menú</h1>
          <p className="text-sm text-muted-foreground">Acomoda las secciones del menú de las empresas. Cada usuario sigue viendo solo lo que su rol le permite.</p>
        </header>

        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-3">
            {L.map((e, i) => {
              const ups = { upOff: i === 0, downOff: i === L.length - 1, onUp: () => edit((l) => move(l, i, -1)), onDown: () => edit((l) => move(l, i, 1)) };
              if (e.type === 'item') {
                const it = ITEMS.get(e.href); if (!it) return null;
                return (
                  <Glass key={e.href} className="flex items-center gap-3 p-3" data-testid={`entry-${e.href}`}>
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><it.icon className="h-5 w-5" /></span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{it.label}</span><span className="block text-[11px] text-muted-foreground">Acceso directo</span></span>
                    <Relocate href={e.href} />
                    <Arrows {...ups} label={it.label} />
                  </Glass>
                );
              }
              const g = GROUPS.get(e.key); if (!g) return null;
              const Icon = g.icon;
              return (
                <Section key={e.key}
                  title={<span className="flex items-center gap-1.5"><Icon className="h-3.5 w-3.5" />Grupo</span>}
                  right={<Arrows {...ups} label={`grupo ${groupLabel(e.key)}`} />}>
                  <div className="flex items-center gap-2 px-3 py-2">
                    <Input aria-label={`Nombre del grupo ${g.label}`} value={e.label ?? ''} placeholder={g.label} maxLength={40} onChange={(ev) => { const v = ev.target.value; edit((l) => l.map((x) => (x.type === 'group' && x.key === e.key ? { ...x, label: v || undefined } : x))); }} className="h-9 rounded-xl font-semibold" />
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </div>
                  {e.items.length === 0 && <p className="px-4 py-3 text-xs text-muted-foreground">Sin secciones (no se mostrará).</p>}
                  {e.items.map((h, j) => {
                    const it = ITEMS.get(h); if (!it) return null;
                    return (
                      <div key={h} className="flex items-center gap-3 px-3 py-2.5" data-testid={`entry-${h}`}>
                        <it.icon className="ml-1 h-4 w-4 shrink-0 text-muted-foreground" />
                        <span className="min-w-0 flex-1 truncate text-sm">{it.label}</span>
                        <Relocate href={h} />
                        <Arrows label={it.label} upOff={j === 0} downOff={j === e.items.length - 1}
                          onUp={() => edit((l) => l.map((x) => (x.type === 'group' && x.key === e.key ? { ...x, items: move(x.items, j, -1) } : x)))}
                          onDown={() => edit((l) => l.map((x) => (x.type === 'group' && x.key === e.key ? { ...x, items: move(x.items, j, 1) } : x)))} />
                      </div>
                    );
                  })}
                </Section>
              );
            })}
          </div>

          {/* Vista previa */}
          <div className="space-y-3 lg:sticky lg:top-6 lg:h-fit">
            <Section title="Vista previa (administrador)">
              <nav className="space-y-0.5 p-2 text-sm" aria-label="Vista previa del menú">
                {preview.map((e) => e.type === 'item' ? (
                  <p key={e.item.href} className="flex items-center gap-2 rounded-lg px-2 py-1.5 font-medium"><e.item.icon className="h-4 w-4" />{e.item.label}</p>
                ) : e.items.length ? (
                  <div key={e.key}>
                    <p className="flex items-center gap-2 rounded-lg px-2 py-1.5 font-medium"><e.icon className="h-4 w-4" />{e.label}</p>
                    {e.items.map((i) => <p key={i.href} className="ml-6 border-l py-1 pl-3 text-muted-foreground">{i.label}</p>)}
                  </div>
                ) : null)}
              </nav>
            </Section>
            <Section title={<span className="flex items-center gap-1.5"><Smartphone className="h-3.5 w-3.5" />Barra de abajo en celular</span>}>
              <div className="grid grid-cols-5 gap-1 p-2 text-center text-[10px]" data-testid="bottom-preview">
                {bottom.map((i) => <span key={i.href} className="flex flex-col items-center gap-1 rounded-lg py-1.5"><i.icon className="h-4 w-4" />{i.label}</span>)}
                <span className="flex flex-col items-center gap-1 rounded-lg py-1.5 text-muted-foreground">≡<br />Menú</span>
              </div>
              <p className="px-3 pb-3 text-[11px] text-muted-foreground">Las primeras 4 secciones que el usuario pueda ver.</p>
            </Section>
            <ErrorText error={save.error ?? reset.error} />
            <div className="flex gap-2">
              <Button className="h-11 flex-1 rounded-2xl" disabled={save.isPending} onClick={() => save.mutate()}>{save.isPending ? 'Guardando…' : 'Guardar orden'}</Button>
              <Button variant="outline" className="h-11 rounded-2xl" disabled={reset.isPending || !q.data?.layout} onClick={() => confirm('¿Volver al orden original del menú?') && reset.mutate()}><RotateCcw className="h-4 w-4" />Original</Button>
            </div>
            {saved && <p className={cn('text-center text-sm text-emerald-600')}>Guardado. Los usuarios lo verán al recargar o en unos minutos.</p>}
          </div>
        </div>
      </div>
    </GlassPage>
  );
}
