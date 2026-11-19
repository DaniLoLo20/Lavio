'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { BarChart3, QrCode, Smartphone } from 'lucide-react';
import { homeFor, useAuth } from '@/lib/auth';
import { Button, Card, CardContent, ErrorText, Input, Label, Select } from '@/components/ui';
import { ThemeToggle } from '@/components/theme-toggle';
import { BRAND, LogoFull } from '@/components/brand';

const FEATURES = [
  { icon: Smartphone, text: 'Órdenes y estatus en tiempo real desde cualquier celular' },
  { icon: QrCode, text: 'Tus clientes consultan su vehículo con un QR, sin registrarse' },
  { icon: BarChart3, text: 'Ventas, inventario y reportes en un solo lugar' },
];

export default function LoginPage() {
  const { login } = useAuth();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [companies, setCompanies] = useState<{ slug: string; name: string }[]>([]);
  const [slug, setSlug] = useState('');
  const [error, setError] = useState<unknown>();
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const r = await login(email, password, slug);
      if ('companies' in r) {
        // El mismo correo existe en varias empresas: se pide elegir una
        setCompanies(r.companies);
        setSlug(r.companies[0].slug);
        setBusy(false);
        return;
      }
      router.replace(homeFor(r.user));
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      {/* Panel de marca (escritorio) */}
      <aside className="brand-gradient relative hidden flex-col items-center justify-center overflow-hidden p-12 text-white lg:flex">
        <div className="pointer-events-none absolute -left-24 -top-24 h-96 w-96 rounded-full bg-sky-300/25 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-32 -right-16 h-[28rem] w-[28rem] rounded-full bg-blue-400/30 blur-3xl" />
        <div className="pointer-events-none absolute right-24 top-20 h-6 w-6 animate-float rounded-full bg-white/30" />
        <div className="pointer-events-none absolute bottom-40 left-20 h-4 w-4 animate-float rounded-full bg-white/25 [animation-delay:1.5s]" />
        <div className="pointer-events-none absolute left-1/3 top-12 h-3 w-3 animate-float rounded-full bg-white/20 [animation-delay:3s]" />

        <div className="relative animate-fade-up rounded-[2rem] bg-white p-10 shadow-2xl shadow-blue-950/40 ring-1 ring-white/40">
          <LogoFull className="w-[360px] max-w-full" />
        </div>
        <ul className="relative mt-10 max-w-md space-y-3 text-sm text-white/90">
          {FEATURES.map((f) => (
            <li key={f.text} className="flex items-center gap-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-white/15 ring-1 ring-white/25"><f.icon className="h-4 w-4" /></span>
              {f.text}
            </li>
          ))}
        </ul>
      </aside>

      {/* Formulario */}
      <section className="relative flex flex-col items-center justify-center p-6">
        <div className="absolute right-4 top-4"><ThemeToggle /></div>
        <div className="w-full max-w-sm animate-fade-up">
          <div className="mx-auto mb-6 w-fit rounded-3xl bg-white p-4 shadow-lg ring-1 ring-black/5 lg:hidden">
            <LogoFull className="w-52" />
          </div>
          <div className="mb-5 hidden text-center lg:block">
            <h1 className="brand-text text-3xl font-bold tracking-tight">Bienvenido a {BRAND.name}</h1>
            <p className="mt-1 text-sm text-muted-foreground">Inicia sesión para continuar</p>
          </div>
          <Card className="shadow-lg">
            <CardContent className="p-6">
              <form onSubmit={submit} className="space-y-4">
                <div><Label>Correo</Label><Input type="email" required autoComplete="username" value={email} onChange={(e) => { setEmail(e.target.value); setCompanies([]); setSlug(''); }} /></div>
                <div><Label>Contraseña</Label><Input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></div>
                {companies.length > 0 && (
                  <div>
                    <Label>Tu cuenta existe en varias empresas. Elige una</Label>
                    <Select value={slug} onChange={(e) => setSlug(e.target.value)}>
                      {companies.map((c) => <option key={c.slug} value={c.slug}>{c.name}</option>)}
                    </Select>
                  </div>
                )}
                <ErrorText error={error} />
                <Button size="lg" className="w-full" disabled={busy}>{busy ? 'Entrando…' : companies.length ? 'Entrar a la empresa' : 'Iniciar sesión'}</Button>
              </form>
            </CardContent>
          </Card>
          <p className="mt-5 text-center text-sm text-muted-foreground">
            ¿Eres cliente? <Link href="/track" className="font-medium text-primary underline-offset-2 hover:underline">Consulta tu vehículo</Link>
          </p>
        </div>
        <p className="absolute bottom-4 text-xs text-muted-foreground">© {new Date().getFullYear()} {BRAND.name} · {BRAND.tagline}</p>
      </section>
    </main>
  );
}
