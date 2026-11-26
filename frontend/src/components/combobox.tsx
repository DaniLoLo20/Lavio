'use client';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Input } from './ui';

interface Props {
  value: string;
  onChange: (text: string) => void;
  /** Se llama al tocar una opcion de la lista. */
  onPick?: (option: string) => void;
  onBlurValue?: (text: string) => void;
  options: string[];
  /** Filtro personalizado; por defecto "contiene" sin distinguir mayusculas. */
  match?: (option: string, query: string) => boolean;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  ariaLabel?: string;
  inputClassName?: string;
}

/** Campo de texto con lista desplegable filtrada. Permite texto libre si no hay coincidencia. */
export function Combobox({ value, onChange, onPick, onBlurValue, options, match, placeholder, disabled, className, ariaLabel, inputClassName }: Props) {
  const [open, setOpen] = useState(false);
  const q = value.trim().toLowerCase();
  const test = match ?? ((o: string, query: string) => o.toLowerCase().includes(query));
  const shown = (q ? options.filter((o) => test(o, q)) : options).slice(0, 60);

  return (
    <div className={cn('relative', className)}>
      <Input
        value={value}
        aria-label={ariaLabel}
        className={inputClassName}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        onFocus={() => setOpen(true)}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        onBlur={() => { setOpen(false); onBlurValue?.(value); }}
      />
      {open && shown.length > 0 && !(shown.length === 1 && shown[0].toLowerCase() === q) && (
        <ul className="absolute z-50 mt-1 max-h-52 w-full overflow-y-auto rounded-md border bg-card py-1 shadow-lg">
          {shown.map((o) => (
            <li key={o}>
              <button
                type="button"
                // pointerdown/mousedown evita que el input pierda foco antes de registrar el toque
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { (onPick ?? onChange)(o); setOpen(false); }}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-muted"
              >
                {o}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
