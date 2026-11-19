'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { Button, Card, CardContent, Input, Label } from '@/components/ui';
import { LogoFull } from '@/components/brand';
import { ThemeToggle } from '@/components/theme-toggle';

export default function TrackLanding() {
  const [code, setCode] = useState('');
  const router = useRouter();
  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden p-4">
      <div className="brand-gradient absolute inset-x-0 top-0 -z-10 h-72 rounded-b-[3rem] opacity-95" />
      <div className="absolute right-4 top-4"><ThemeToggle /></div>
      <div className="w-full max-w-sm animate-fade-up space-y-5">
        <div className="mx-auto w-fit rounded-3xl bg-white p-5 shadow-xl ring-1 ring-black/5"><LogoFull className="w-56" /></div>
        <Card className="shadow-lg">
          <CardContent className="p-6">
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                if (code.trim()) router.push(`/track/${code.trim().toUpperCase()}`);
              }}
            >
              <h1 className="text-lg font-semibold">Consulta tu vehículo</h1>
              <p className="text-sm text-muted-foreground">Escribe el código de 6 caracteres de tu comprobante o escanea el QR.</p>
              <div>
                <Label>Código</Label>
                <Input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} maxLength={6} placeholder="X8K9M4" className="h-12 text-center font-mono text-xl tracking-widest" autoFocus />
              </div>
              <Button size="lg" className="w-full"><Search className="h-4 w-4" />Consultar</Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
