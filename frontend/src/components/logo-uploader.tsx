'use client';
import { useRef, useState } from 'react';
import { ImagePlus, Trash2 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useOnline } from '@/lib/net';
import { Button, Card, CardContent, CardHeader, CardTitle, ErrorText } from './ui';
import { TenantMark } from './brand';

/** Reduce el logo a 512 px máx. conservando la transparencia (PNG). */
async function resizeLogo(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 512 / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  const blob: Blob | null = await new Promise((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('No se pudo procesar la imagen');
  return blob;
}

/** Imagen del negocio: se ve en el menú, en los tickets y en la consulta pública del cliente. */
export function LogoUploader() {
  const { user, refresh } = useAuth();
  const online = useOnline();
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>();
  const logo = user?.tenant.logoUrl;

  async function upload(file: File) {
    setBusy(true);
    setError(undefined);
    try {
      const form = new FormData();
      form.append('file', await resizeLogo(file), 'logo.png');
      await api('/tenant/logo', { form });
      await refresh();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function remove() {
    setBusy(true);
    setError(undefined);
    try { await api('/tenant/logo', { method: 'DELETE' }); await refresh(); } catch (e) { setError(e); } finally { setBusy(false); }
  }

  return (
    <Card className="max-w-2xl">
      <CardHeader><CardTitle>Imagen de tu negocio</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center gap-4">
          <TenantMark url={logo} size={88} className="rounded-2xl" />
          <div className="space-y-2">
            <p className="text-sm text-muted-foreground">Aparece en el menú, en el <b>ticket</b> que recibe tu cliente y en su consulta del avance. Usa un PNG, JPG o WEBP (se ajusta a 512 px).</p>
            <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
            <div className="flex flex-wrap gap-2">
              <Button type="button" disabled={busy || !online} onClick={() => fileRef.current?.click()}><ImagePlus className="h-4 w-4" />{logo ? 'Cambiar imagen' : 'Subir imagen'}</Button>
              {logo && <Button type="button" variant="outline" disabled={busy || !online} onClick={remove}><Trash2 className="h-4 w-4" />Quitar</Button>}
            </div>
            {!logo && <p className="text-xs text-muted-foreground">Mientras no subas una, se usa la marca de Lavio.</p>}
            {!online && <p className="text-xs text-amber-600">Se necesita conexión para cambiar la imagen.</p>}
          </div>
        </div>
        <ErrorText error={error} />
      </CardContent>
    </Card>
  );
}
