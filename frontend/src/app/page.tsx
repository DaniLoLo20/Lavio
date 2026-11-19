'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { homeFor, useAuth } from '@/lib/auth';
import { Splash } from '@/components/brand';

export default function Home() {
  const { user, ready } = useAuth();
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    router.replace(!user ? '/login' : homeFor(user));
  }, [ready, user, router]);
  return <Splash />;
}
