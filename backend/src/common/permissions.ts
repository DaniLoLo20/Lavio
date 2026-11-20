/**
 * Catálogo de permisos. Cada permiso es "recurso:acción" (p. ej. "inventory:create").
 * Un rol es un conjunto de permisos; el menú del usuario y todos los endpoints se rigen por ellos.
 */
export interface PermAction { key: string; label: string; hint?: string }
export interface PermResource { resource: string; label: string; actions: PermAction[] }

const A = (key: string, label: string, hint?: string): PermAction => ({ key, label, hint });
const CRUD = (extra: PermAction[] = []): PermAction[] => [A('view', 'Ver'), A('create', 'Crear'), A('edit', 'Editar'), A('delete', 'Eliminar'), ...extra, A('export', 'Exportar (CSV)')];

export const CATALOG: PermResource[] = [
  { resource: 'dashboard', label: 'Dashboard', actions: [A('view', 'Ver')] },
  {
    resource: 'orders', label: 'Órdenes y punto de venta',
    actions: [
      A('view', 'Ver órdenes'), A('create', 'Crear órdenes (Nueva orden)'), A('status', 'Cambiar estatus'), A('photos', 'Tomar fotografías'),
      A('notify', 'Avisar al cliente'), A('assign', 'Asignar lavador'), A('collect', 'Cobrar (registrar pagos)'), A('deliver', 'Reabrir una orden finalizada'),
      A('archive', 'Archivar y desarchivar órdenes'),
      A('edit_price', 'Modificar el precio de un servicio antes de cobrar', 'El precio del catálogo no cambia; solo el de esta orden'),
      A('prices', 'Ver precios, montos y ticket', 'Sin este permiso no ve dinero ni datos de contacto del cliente'),
      A('own_only', 'Solo ve las órdenes que le asignan', 'Restricción: es el comportamiento del lavador'),
      A('export', 'Exportar (CSV)'),
    ],
  },
  { resource: 'washer', label: 'Vista de trabajo (lavadores)', actions: [A('view', 'Ver')] },
  { resource: 'cash', label: 'Caja', actions: [A('view', 'Ver'), A('create', 'Abrir caja y registrar movimientos'), A('delete', 'Eliminar movimientos'), A('close', 'Hacer corte'), A('export', 'Exportar (CSV)')] },
  { resource: 'finance', label: 'Finanzas', actions: [A('view', 'Ver'), A('export', 'Exportar (CSV)')] },
  { resource: 'services', label: 'Servicios', actions: CRUD() },
  { resource: 'clients', label: 'Clientes', actions: CRUD() },
  { resource: 'inventory', label: 'Inventario: productos y movimientos', actions: CRUD([A('adjust', 'Ajustar existencias')]) },
  { resource: 'suppliers', label: 'Proveedores', actions: CRUD() },
  { resource: 'purchases', label: 'Compras', actions: [A('view', 'Ver'), A('create', 'Crear'), A('export', 'Exportar (CSV)')] },
  { resource: 'users', label: 'Usuarios', actions: CRUD() },
  { resource: 'settings', label: 'Configuración de la empresa', actions: [A('view', 'Ver'), A('edit', 'Editar')] },
];

export const ALL_TENANT_PERMS: string[] = CATALOG.flatMap((r) => r.actions.map((a) => `${r.resource}:${a.key}`));

/** Restricciones (limitan en vez de otorgar): el administrador nunca las tiene. */
export const RESTRICTIONS = ['orders:own_only'];

export const ADMIN_PERMS = ALL_TENANT_PERMS.filter((p) => !RESTRICTIONS.includes(p));

/** Lo que podía hacer el lavador antes de existir los roles configurables. */
export const WASHER_DEFAULT_PERMS = ['orders:view', 'orders:status', 'orders:photos', 'orders:notify', 'orders:own_only', 'washer:view'];

export const isValidPerm = (p: string) => ALL_TENANT_PERMS.includes(p);

/** Recurso al que pertenece cada reporte CSV (para exigir `<recurso>:export`). */
export const REPORT_RESOURCE: Record<string, string> = {
  orders: 'orders', payments: 'cash', services: 'services', clients: 'clients', inventory: 'inventory', movements: 'inventory',
  purchases: 'purchases', suppliers: 'suppliers', users: 'users', 'cash-sessions': 'cash', 'cash-movements': 'cash', 'cash-closing': 'cash',
};
