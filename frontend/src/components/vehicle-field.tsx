'use client';
import { Combobox } from './combobox';
import { COLORS, parseVehicle } from '@/lib/voice/parsers';
import { cn } from '@/lib/utils';

type Catalog = { brand: string; models: string[] }[];

const ALIAS: Record<string, string> = { vw: 'volkswagen', volks: 'volkswagen', chevy: 'chevrolet', mercedes: 'mercedes-benz', benz: 'mercedes-benz', gm: 'chevrolet' };
const norm = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

/** «Nissan», «Nissan Versa», «Nissan Sentra»… para el buscador del campo único de vehículo. */
export const vehicleOptions = (c: Catalog) => c.flatMap((b) => [b.brand, ...b.models.map((m) => `${b.brand} ${m}`)]);
/** Coincide si todas las palabras escritas aparecen (en cualquier orden): «versa», «vw jetta», «nissan ver». */
export const vehicleMatch = (opt: string, q: string) => { const o = norm(opt); return norm(q).split(/\s+/).filter(Boolean).every((t) => o.includes(ALIAS[t] ?? t)); };
/** Texto libre → marca y modelo (con el catálogo). Si se escribió un color («versa gris») también lo devuelve. */
export const splitVehicle = (text: string, c: Catalog) => (text.trim() ? parseVehicle(text.trim(), c) : { brand: '', model: '', color: '' });
export const joinVehicle = (brand?: string, model?: string) => [brand, model].filter(Boolean).join(' ');

/** Un solo campo para marca y modelo (opcional): «Versa» basta, la marca se deduce. */
export function VehicleField({ value, onChange, onCommit, catalog, className }: {
  value: string;
  onChange: (text: string) => void;
  /** Se llama al elegir una opción o al salir del campo, con marca/modelo (y color si se escribió) ya separados. */
  onCommit: (v: { brand: string; model: string; color: string }) => void;
  catalog: Catalog;
  className?: string;
}) {
  return (
    <Combobox
      value={value}
      ariaLabel="Vehículo"
      placeholder="Ej. Versa, Nissan Sentra, VW Jetta"
      options={vehicleOptions(catalog)}
      match={vehicleMatch}
      onChange={onChange}
      onPick={(o) => { onChange(o); onCommit(splitVehicle(o, catalog)); }}
      onBlurValue={(t) => onCommit(splitVehicle(t, catalog))}
      className={className}
    />
  );
}

export const SWATCH: Record<string, string> = { Blanco: '#ffffff', Negro: '#111827', Gris: '#8b9099', Plata: '#c7ccd4', Rojo: '#dc2626', Azul: '#2563eb', Verde: '#16a34a', Vino: '#7f1d1d' };

/** Color opcional: colores rápidos con un toque + campo para otro color. Tocar el color elegido lo quita. */
export function ColorField({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-2" role="radiogroup" aria-label="Color rápido">
        {Object.entries(SWATCH).map(([name, hex]) => (
          <button key={name} type="button" role="radio" aria-checked={value === name} aria-label={name} title={name} onClick={() => onChange(value === name ? '' : name)}
            className={cn('h-8 w-8 rounded-full border border-black/15 shadow-sm transition active:scale-90', value === name && 'ring-2 ring-primary ring-offset-2 ring-offset-white dark:ring-offset-slate-900')} style={{ background: hex }} />
        ))}
      </div>
      <Combobox value={value} ariaLabel="Color" placeholder="Otro color" options={COLORS} onChange={onChange} />
    </div>
  );
}
