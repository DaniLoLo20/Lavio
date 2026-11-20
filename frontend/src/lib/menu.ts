import type { LucideIcon } from 'lucide-react';
import { ArrowLeftRight, BarChart3, Boxes, Building, Building2, ClipboardList, Cog, Droplets, LineChart, Package, Settings, ShieldCheck, ShoppingCart, Sparkles, Tags, Truck, UserRound, Users, Wallet } from 'lucide-react';

export interface MenuItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Permiso necesario para verlo */
  perm?: string;
  /** Se oculta a quien tenga este permiso (p. ej. quien solo ve sus órdenes no necesita la lista general) */
  hideIf?: string;
  /** Texto alterno si el usuario tiene este permiso */
  altLabel?: { ifPerm: string; label: string };
}
export type MenuEntry =
  | { type: 'item'; item: MenuItem }
  | { type: 'group'; key: string; label: string; icon: LucideIcon; items: MenuItem[] };

interface UserLike { role: string; permissions: string[] }

const item = (i: MenuItem): MenuEntry => ({ type: 'item', item: i });
const group = (key: string, label: string, icon: LucideIcon, items: MenuItem[]): MenuEntry => ({ type: 'group', key, label, icon, items });

export const TENANT_MENU: MenuEntry[] = [
  item({ href: '/dashboard', label: 'Dashboard', icon: BarChart3, perm: 'dashboard:view' }),
  group('ops', 'Operación', ClipboardList, [
    { href: '/pos', label: 'Nueva orden', icon: ShoppingCart, perm: 'orders:create' },
    { href: '/orders', label: 'Órdenes', icon: ClipboardList, perm: 'orders:view', hideIf: 'orders:own_only' },
    { href: '/washer', label: 'Lavadores', icon: Droplets, perm: 'washer:view', altLabel: { ifPerm: 'orders:own_only', label: 'Mis órdenes' } },
  ]),
  group('money', 'Caja y finanzas', Wallet, [
    { href: '/cash', label: 'Caja', icon: Wallet, perm: 'cash:view' },
    { href: '/finance', label: 'Finanzas', icon: LineChart, perm: 'finance:view' },
  ]),
  group('catalog', 'Catálogo', Tags, [
    { href: '/services', label: 'Servicios', icon: Sparkles, perm: 'services:view' },
    { href: '/clients', label: 'Clientes', icon: UserRound, perm: 'clients:view' },
  ]),
  group('inventory', 'Inventario', Package, [
    { href: '/inventory/products', label: 'Productos', icon: Boxes, perm: 'inventory:view' },
    { href: '/inventory/movements', label: 'Movimientos', icon: ArrowLeftRight, perm: 'inventory:view' },
    { href: '/suppliers', label: 'Proveedores', icon: Building2, perm: 'suppliers:view' },
    { href: '/purchases', label: 'Compras', icon: Truck, perm: 'purchases:view' },
  ]),
  group('admin', 'Administración', Cog, [
    { href: '/users', label: 'Usuarios', icon: Users, perm: 'users:view' },
    { href: '/settings', label: 'Configuración', icon: Settings, perm: 'settings:view' },
  ]),
];

export const SUPER_MENU: MenuEntry[] = [
  group('platform', 'Plataforma', Building, [
    { href: '/platform', label: 'Empresas', icon: Building },
    { href: '/platform/users', label: 'Usuarios', icon: Users },
    { href: '/platform/clients', label: 'Clientes', icon: UserRound },
    { href: '/platform/orders', label: 'Órdenes', icon: ClipboardList },
  ]),
  group('config', 'Configuración', Settings, [
    { href: '/platform/roles', label: 'Roles y permisos', icon: ShieldCheck },
  ]),
];

/** Pantallas que no están en el menú pero heredan el permiso de su sección. */
const HIDDEN_ROUTES: { prefix: string; perm: string }[] = [
  { prefix: '/orders/detail', perm: 'orders:view' },
  { prefix: '/cash/session', perm: 'cash:view' },
  { prefix: '/inventory', perm: 'inventory:view' },
];

export const can = (u: UserLike | null | undefined, perm?: string) => !perm || !!u?.permissions?.includes(perm);

const itemVisible = (u: UserLike, i: MenuItem) => can(u, i.perm) && !(i.hideIf && can(u, i.hideIf));
const labelOf = (u: UserLike, i: MenuItem) => (i.altLabel && can(u, i.altLabel.ifPerm) ? i.altLabel.label : i.label);

/** Menú del usuario: solo lo permitido. Un grupo con un único elemento visible se muestra como elemento suelto. */
export function buildMenu(u: UserLike | null | undefined): MenuEntry[] {
  if (!u) return [];
  const source = u.role === 'SUPERADMIN' ? SUPER_MENU : TENANT_MENU;
  const out: MenuEntry[] = [];
  for (const e of source) {
    if (e.type === 'item') { if (itemVisible(u, e.item)) out.push({ type: 'item', item: { ...e.item, label: labelOf(u, e.item) } }); continue; }
    const items = e.items.filter((i) => itemVisible(u, i)).map((i) => ({ ...i, label: labelOf(u, i) }));
    if (items.length === 1 && u.role !== 'SUPERADMIN') out.push({ type: 'item', item: items[0] });
    else if (items.length) out.push({ ...e, items });
  }
  return out;
}

export const flatItems = (entries: MenuEntry[]): MenuItem[] => entries.flatMap((e) => (e.type === 'item' ? [e.item] : e.items));

export function firstAllowedPath(u: UserLike | null | undefined): string {
  if (!u) return '/login';
  if (u.role === 'SUPERADMIN') return '/platform';
  return flatItems(buildMenu(u))[0]?.href ?? '/sin-acceso';
}

/** ¿Puede entrar a esta ruta? (La API valida lo mismo: esto solo evita mostrar pantallas inútiles.) */
export function pathAllowed(u: UserLike | null | undefined, path: string): boolean {
  if (!u) return false;
  if (u.role === 'SUPERADMIN') return path.startsWith('/platform');
  if (path.startsWith('/platform')) return false;
  const hidden = HIDDEN_ROUTES.find((h) => path === h.prefix || path.startsWith(h.prefix + '/'));
  if (hidden && !flatItems(TENANT_MENU.flatMap((e) => (e.type === 'item' ? [e] : e.items.map((i) => item(i))))).some((i) => i.href === path)) return can(u, hidden.perm);
  const all = flatItems(TENANT_MENU).filter((i) => path === i.href || path.startsWith(i.href + '/')).sort((a, b) => b.href.length - a.href.length)[0];
  return all ? can(u, all.perm) : true;
}
