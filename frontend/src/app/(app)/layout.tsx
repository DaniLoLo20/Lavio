'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { ChevronDown, LifeBuoy, LogOut, Menu as MenuIcon, ShieldAlert, X } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { buildMenu, firstAllowedPath, flatItems, pathAllowed, type MenuEntry, type MenuItem, type MenuLayout } from '@/lib/menu';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { cn } from '@/lib/utils';
import { ThemeToggle } from '@/components/theme-toggle';
import { Button } from '@/components/ui';
import { BRAND, Splash, TenantMark } from '@/components/brand';
import { OfflineBanner, SyncBadge } from '@/components/sync-provider';
import { VoiceFab } from '@/components/voice-mode';
import { useSyncState } from '@/lib/offline/sync';

const OPEN_KEY = 'al_menu_open';
const isActive = (path: string, href: string) => (href === '/platform' ? path === href : path === href || path.startsWith(href + '/'));

/** Menú agrupado: cada módulo se despliega y se recuerda cómo lo dejaste. */
function NavTree({ entries, path, onNavigate, forceOpen }: { entries: MenuEntry[]; path: string; onNavigate?: () => void; forceOpen?: boolean }) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  useEffect(() => { try { setOpen(JSON.parse(localStorage.getItem(OPEN_KEY) || '{}')); } catch { /* sin almacenamiento */ } }, []);
  const toggle = (k: string) => setOpen((o) => { const n = { ...o, [k]: !(o[k] ?? false) }; try { localStorage.setItem(OPEN_KEY, JSON.stringify(n)); } catch { /* sin almacenamiento */ } return n; });

  const link = (i: MenuItem, nested = false) => (
    <Link key={i.href} href={i.href} onClick={onNavigate}
      className={cn('flex items-center gap-3 rounded-md px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground', nested && 'py-1.5 pl-2',
        isActive(path, i.href) && 'bg-primary/10 font-medium text-primary hover:bg-primary/10 hover:text-primary')}>
      <i.icon className="h-4 w-4 shrink-0" />{i.label}
    </Link>
  );

  return (
    <nav className="space-y-0.5">
      {entries.map((e) => {
        if (e.type === 'item') return link(e.item);
        const hasActive = e.items.some((i) => isActive(path, i.href));
        const expanded = forceOpen || hasActive || !!open[e.key];
        return (
          <div key={e.key}>
            <button type="button" onClick={() => toggle(e.key)} aria-expanded={expanded} aria-label={e.label}
              className={cn('flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-foreground hover:bg-muted', hasActive && 'text-primary')}>
              <e.icon className="h-4 w-4 shrink-0" />
              <span className="flex-1 text-left">{e.label}</span>
              <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', expanded && 'rotate-180')} />
            </button>
            {expanded && <div className="ml-5 mt-0.5 space-y-0.5 border-l pl-2">{e.items.map((i) => link(i, true))}</div>}
          </div>
        );
      })}
    </nav>
  );
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, ready, logout, exitSupport, can } = useAuth();
  const router = useRouter();
  const path = usePathname();
  const sync = useSyncState();
  const [sheet, setSheet] = useState(false);
  const safeLogout = () => {
    if (sync.pending + sync.problems > 0 && !confirm(`Hay ${sync.pending + sync.problems} cambio(s) sin sincronizar. Quedarán guardados en este dispositivo y se enviarán cuando vuelvas a iniciar sesión con tu usuario. ¿Cerrar sesión?`)) return;
    logout();
  };

  // Orden del menú definido por el superadmin (se guarda en caché: también sirve sin conexión)
  const layoutQ = useQuery({ queryKey: ['menu', 'layout'], queryFn: () => api<{ layout: MenuLayout | null }>('/menu/layout'), enabled: !!user, staleTime: 5 * 60_000 });
  const layout = layoutQ.data?.layout ?? null;
  const entries = useMemo(() => buildMenu(user, layout), [user, layout]);
  const flat = useMemo(() => flatItems(entries), [entries]);
  const allowed = !!user && pathAllowed(user, path);

  useEffect(() => {
    if (ready && !user) router.replace('/login');
    if (ready && user?.role === 'SUPERADMIN' && !path.startsWith('/platform')) router.replace('/platform');
  }, [ready, user, path, router]);
  useEffect(() => { setSheet(false); }, [path]);

  if (!user) return <Splash />;
  const subtitle = user.role === 'SUPERADMIN' ? 'Plataforma' : user.tenant.name;
  // Barra inferior (celular): hasta 4 accesos directos + "Menú" con todo lo demás
  const QUICK = ['/dashboard', '/pos', '/orders', '/washer', '/cash'];
  // con un orden definido, la barra inferior respeta ese orden (las 4 primeras secciones permitidas)
  const quick = flat.length <= 5 ? flat : layout?.length ? flat.slice(0, 4) : [...QUICK.map((h) => flat.find((i) => i.href === h)).filter(Boolean) as MenuItem[], ...flat].filter((v, i, a) => a.indexOf(v) === i).slice(0, 4);

  return (
    <div className="min-h-screen md:flex">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r bg-card md:flex print:hidden">
        <div className="flex items-center gap-3 border-b px-4 py-4">
          <TenantMark url={user.tenant.logoUrl} size={44} className="rounded-xl" />
          <div className="min-w-0">
            <p className="brand-text text-xl font-bold leading-tight tracking-tight">{BRAND.name}</p>
            <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-2"><NavTree entries={entries} path={path} /></div>
        <div className="flex items-center justify-between border-t p-3">
          <div className="min-w-0 text-xs"><p className="truncate font-medium">{user.fullName}</p><p className="truncate text-muted-foreground">{user.roleLabel}</p></div>
          <div className="flex items-center"><SyncBadge compact /><ThemeToggle /><Button variant="ghost" size="icon" onClick={safeLogout} aria-label="Salir"><LogOut className="h-4 w-4" /></Button></div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {user.support && (
          <div className="flex items-center justify-between gap-2 bg-amber-500 px-4 py-2 text-sm font-medium text-black">
            <span className="flex items-center gap-2"><LifeBuoy className="h-4 w-4" />Modo soporte en {user.tenant.name}</span>
            <button onClick={exitSupport} className="rounded bg-black/15 px-3 py-1 hover:bg-black/25">Salir del modo soporte</button>
          </div>
        )}
        <div className="print:hidden"><OfflineBanner /></div>
        <header className="sticky top-0 z-20 flex h-14 items-center justify-between border-b bg-background/90 px-4 backdrop-blur md:hidden print:hidden">
          <span className="flex min-w-0 items-center gap-2.5">
            <TenantMark url={user.tenant.logoUrl} size={34} />
            <span className="min-w-0 leading-tight"><span className="brand-text block text-base font-bold">{BRAND.name}</span><span className="block truncate text-[11px] text-muted-foreground">{subtitle}</span></span>
          </span>
          <div className="flex items-center"><SyncBadge /><ThemeToggle /><Button variant="ghost" size="icon" onClick={safeLogout} aria-label="Salir"><LogOut className="h-4 w-4" /></Button></div>
        </header>

        <main className="mx-auto w-full max-w-6xl flex-1 p-4 pb-24 md:p-8 md:pb-8 print:max-w-none print:p-0">
          {allowed ? children : (
            <div className="mx-auto mt-16 max-w-sm text-center">
              <ShieldAlert className="mx-auto h-10 w-10 text-amber-500" />
              <h1 className="mt-3 text-lg font-semibold">Sin acceso</h1>
              <p className="mt-1 text-sm text-muted-foreground">Tu rol ({user.roleLabel}) no tiene permiso para esta sección. Si la necesitas, pídele al administrador que ajuste tu rol.</p>
              <Button className="mt-4" onClick={() => router.replace(firstAllowedPath(user))}>Ir a mi inicio</Button>
            </div>
          )}
        </main>

        {can('orders:create') && user.role !== 'SUPERADMIN' && !path.startsWith('/pos') && !path.startsWith('/cash') && <VoiceFab onClick={() => router.push('/pos?voice=1')} />}

        <nav className="fixed inset-x-0 bottom-0 z-20 flex border-t bg-card pb-[env(safe-area-inset-bottom)] md:hidden print:hidden">
          {quick.map((n) => (
            <Link key={n.href} href={n.href} className={cn('flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-2 text-[11px] text-muted-foreground', isActive(path, n.href) && 'text-primary')}>
              <n.icon className="h-5 w-5" /><span className="max-w-full truncate">{n.label}</span>
            </Link>
          ))}
          {flat.length > 5 && (
            <button onClick={() => setSheet(true)} className="flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 py-2 text-[11px] text-muted-foreground" aria-label="Menú">
              <MenuIcon className="h-5 w-5" />Menú
            </button>
          )}
        </nav>
      </div>

      {sheet && (
        <div className="fixed inset-0 z-[60] flex items-end bg-black/50 md:hidden print:hidden" onClick={() => setSheet(false)}>
          <div className="max-h-[85vh] w-full overflow-y-auto rounded-t-2xl border bg-card p-3 pb-[calc(env(safe-area-inset-bottom)+12px)]" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between px-1"><p className="font-semibold">Menú</p><Button variant="ghost" size="icon" onClick={() => setSheet(false)} aria-label="Cerrar menú"><X className="h-4 w-4" /></Button></div>
            <NavTree entries={entries} path={path} forceOpen onNavigate={() => setSheet(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
