import { useSyncExternalStore } from 'react';

/**
 * Estado de conectividad. `navigator.onLine` solo indica si hay una interfaz de red (puede mentir con wifi
 * sin internet), por eso tambien se actualiza con el resultado real de cada peticion a la API.
 */
let up = typeof navigator === 'undefined' ? true : navigator.onLine;
const listeners = new Set<() => void>();

export const net = {
  get up() { return up; },
  set(v: boolean) {
    if (v !== up) { up = v; listeners.forEach((l) => l()); }
  },
  subscribe(l: () => void) { listeners.add(l); return () => { listeners.delete(l); }; },
};

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => net.set(true));
  window.addEventListener('offline', () => net.set(false));
}

export const useOnline = () => useSyncExternalStore(net.subscribe, () => up, () => true);

/** Diferencia (ms) entre el reloj del servidor y el del dispositivo, leida del encabezado Date. */
export const clock = { skew: 0 };
