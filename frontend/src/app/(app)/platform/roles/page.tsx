'use client';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Copy, Lock, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Empty, ErrorText, Input, Label, PageHeader } from '@/components/ui';

interface Role { id: string; name: string; label: string; description?: string; isSystem: boolean; permissions: string[]; users: number }
interface Catalog { resources: { resource: string; label: string; actions: { key: string; label: string; hint?: string }[] }[]; all: string[] }

/** ADMIN y SUPERADMIN no se editan: el primero siempre tiene todo y el segundo es de plataforma. */
const locked = (r?: Role) => !!r && (r.name === 'ADMIN' || r.name === 'SUPERADMIN');

export default function RolesPage() {
  const qc = useQueryClient();
  const roles = useQuery({ queryKey: ['platform', 'roles'], queryFn: () => api<Role[]>('/platform/roles') });
  const catalog = useQuery({ queryKey: ['platform', 'roles', 'catalog'], queryFn: () => api<Catalog>('/platform/roles/catalog') });
  const [sel, setSel] = useState<string | 'new' | null>(null);
  const [label, setLabel] = useState('');
  const [desc, setDesc] = useState('');
  const [perms, setPerms] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState(false);

  const list = (roles.data ?? []).filter((r) => r.name !== 'SUPERADMIN');
  const current = list.find((r) => r.id === sel);
  const readOnly = locked(current);

  useEffect(() => {
    if (sel === 'new') { setLabel(''); setDesc(''); setPerms(new Set(['orders:view'])); }
    else if (current) { setLabel(current.label); setDesc(current.description ?? ''); setPerms(new Set(current.permissions)); }
  }, [sel, current?.id, current?.permissions.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps

  const refresh = () => qc.invalidateQueries({ queryKey: ['platform', 'roles'] });
  const save = useMutation({
    mutationFn: () => {
      const body = { description: desc || undefined, permissions: [...perms] };
      return sel === 'new'
        ? api<Role>('/platform/roles', { body: { name: label, ...body } })
        : api<Role>(`/platform/roles/${sel}`, { method: 'PATCH', body: { label, ...body } });
    },
    onSuccess: (r) => { refresh(); setSaved(true); if (sel === 'new') setSel(r.id); },
  });
  const del = useMutation({
    mutationFn: (id: string) => api(`/platform/roles/${id}`, { method: 'DELETE' }),
    onSuccess: () => { setSel(null); refresh(); },
  });

  function toggle(resource: string, action: string, on: boolean) {
    const next = new Set(perms);
    const key = `${resource}:${action}`;
    if (on) {
      next.add(key);
      // Para usar cualquier acción hay que poder ver la sección (las demás son restricciones/extra).
      if (action !== 'view' && action !== 'own_only' && catalog.data?.all.includes(`${resource}:view`)) next.add(`${resource}:view`);
    } else {
      next.delete(key);
      if (action === 'view') [...next].filter((p) => p.startsWith(resource + ':') && p !== `${resource}:own_only`).forEach((p) => next.delete(p));
    }
    setPerms(next);
    setSaved(false);
  }
  function toggleAll(resource: string, actions: { key: string }[], on: boolean) {
    const next = new Set(perms);
    actions.filter((a) => a.key !== 'own_only').forEach((a) => (on ? next.add(`${resource}:${a.key}`) : next.delete(`${resource}:${a.key}`)));
    setPerms(next);
    setSaved(false);
  }
  function clone(r: Role) {
    setSel('new');
    setTimeout(() => { setLabel(`${r.label} (copia)`); setDesc(r.description ?? ''); setPerms(new Set(r.permissions)); }, 0);
  }

  const summary = useMemo(() => `${perms.size} permisos`, [perms]);

  return (
    <>
      <PageHeader title="Roles y permisos">
        <Button size="sm" onClick={() => { setSaved(false); setSel('new'); }}><Plus className="h-4 w-4" />Nuevo rol</Button>
      </PageHeader>
      <p className="mb-4 text-sm text-muted-foreground">
        Los roles son de toda la plataforma: los administradores de cada empresa solo pueden asignarlos. Los cambios se aplican en segundos a quien ya tiene sesión abierta.
      </p>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="h-fit divide-y">
          {list.length === 0 && <Empty text="Sin roles" />}
          {list.map((r) => (
            <button key={r.id} onClick={() => { setSaved(false); setSel(r.id); }} className={`flex w-full items-center justify-between gap-2 p-4 text-left text-sm hover:bg-muted/50 ${sel === r.id ? 'bg-muted' : ''}`}>
              <span className="min-w-0">
                <span className="flex items-center gap-1.5 font-medium">{r.label}{locked(r) && <Lock className="h-3 w-3 text-muted-foreground" />}</span>
                <span className="block truncate text-xs text-muted-foreground">{r.description || r.name}</span>
              </span>
              <span className="flex shrink-0 flex-col items-end gap-1">
                {r.isSystem && <Badge className="bg-muted text-muted-foreground">Sistema</Badge>}
                <span className="text-xs text-muted-foreground">{r.users} usuarios · {r.permissions.length} permisos</span>
              </span>
            </button>
          ))}
        </Card>

        <div className="lg:col-span-2">
          {!sel && <Card><CardContent className="p-8 text-center text-sm text-muted-foreground">Elige un rol para ver o editar sus permisos, o crea uno nuevo.</CardContent></Card>}
          {sel && (sel === 'new' || current) && (
            <Card>
              <CardHeader>
                <CardTitle className="flex flex-wrap items-center justify-between gap-2">
                  <span>{sel === 'new' ? 'Nuevo rol' : current!.label} <span className="text-xs font-normal text-muted-foreground">{summary}</span></span>
                  {current && (
                    <span className="flex gap-1">
                      <Button size="sm" variant="outline" onClick={() => clone(current)}><Copy className="h-4 w-4" />Duplicar</Button>
                      {!current.isSystem && (
                        <Button size="sm" variant="ghost" disabled={del.isPending} onClick={() => confirm(`¿Eliminar el rol "${current.label}"?`) && del.mutate(current.id)}><Trash2 className="h-4 w-4" />Eliminar</Button>
                      )}
                    </span>
                  )}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {readOnly && <p className="rounded-md bg-muted p-3 text-sm">Este rol del sistema no se puede modificar: {current!.name === 'ADMIN' ? 'el administrador siempre tiene todos los permisos.' : 'es el rol de la plataforma.'}</p>}
                <div className="grid gap-3 sm:grid-cols-2">
                  <div><Label>Nombre del rol</Label><Input disabled={readOnly || current?.name === 'WASHER'} value={label} onChange={(e) => { setLabel(e.target.value); setSaved(false); }} placeholder="Ej. Supervisor" /></div>
                  <div><Label>Descripción</Label><Input disabled={readOnly} value={desc} onChange={(e) => { setDesc(e.target.value); setSaved(false); }} placeholder="Opcional" /></div>
                </div>

                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <tbody className="divide-y">
                      {catalog.data?.resources.map((r) => {
                        const all = r.actions.filter((a) => a.key !== 'own_only');
                        const count = all.filter((a) => perms.has(`${r.resource}:${a.key}`)).length;
                        return (
                          <tr key={r.resource} className="align-top">
                            <td className="w-48 p-3">
                              <p className="font-medium">{r.label}</p>
                              <label className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                                <input type="checkbox" disabled={readOnly} checked={count === all.length} ref={(el) => { if (el) el.indeterminate = count > 0 && count < all.length; }} onChange={(e) => toggleAll(r.resource, r.actions, e.target.checked)} />
                                Todo
                              </label>
                            </td>
                            <td className="p-3">
                              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                                {r.actions.map((a) => (
                                  <label key={a.key} title={a.hint} className={`flex items-center gap-1.5 ${a.key === 'own_only' ? 'text-amber-700 dark:text-amber-400' : ''}`}>
                                    <input type="checkbox" disabled={readOnly} checked={readOnly ? a.key !== 'own_only' && current!.name === 'ADMIN' : perms.has(`${r.resource}:${a.key}`)} onChange={(e) => toggle(r.resource, a.key, e.target.checked)} />
                                    {a.label}
                                  </label>
                                ))}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                <ErrorText error={save.error ?? del.error} />
                {!readOnly && (
                  <div className="flex items-center gap-3">
                    <Button disabled={save.isPending || label.trim().length < 2} onClick={() => save.mutate()}>{sel === 'new' ? 'Crear rol' : 'Guardar cambios'}</Button>
                    {saved && <span className="text-sm text-emerald-600">Guardado</span>}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
