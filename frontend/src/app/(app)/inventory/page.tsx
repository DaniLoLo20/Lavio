'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Inventario se dividió en /inventory/products y /inventory/movements. */
export default function InventoryIndex() {
  const router = useRouter();
  useEffect(() => { router.replace('/inventory/products'); }, [router]);
  return <p className="text-sm text-muted-foreground">Cargando…</p>;
}
