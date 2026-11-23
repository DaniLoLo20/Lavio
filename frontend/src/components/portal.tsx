'use client';
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';

/** Dibuja su contenido directamente en <body>: así las ventanas quedan por encima de la barra y del menú aunque el contenedor de la pantalla cree su propio nivel de capas. */
export function Portal({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready ? createPortal(children, document.body) : null;
}
