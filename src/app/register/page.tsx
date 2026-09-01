'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { useToast } from '@/components/providers';

function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [role, setRole] = useState<'buyer' | 'seller'>(params.get('as') === 'seller' ? 'seller' : 'buyer');
  const [societies, setSocieties] = useState<{ id: number; name: string }[]>([]);
  const [form, setForm] = useState({
    name: '',
    phone: '',
    password: '',
    societyId: '',
    kitchenName: '',
    bio: '',
    vegOnly: false,
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/societies')
      .then((r) => r.json())
      .then((d) => setSocieties(d.societies))
      .catch(() => {});
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const res = await fetch('/api/auth/register', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        role,
        societyId: form.societyId ? Number(form.societyId) : undefined,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      toast(data.error || 'Could not register', 'err');
      return;
    }
    toast('Welcome to GharSe!');
    // Sellers land on the kitchen-profile onboarding step (photos etc.)
    // before the dashboard — see DECISIONS.md #73+.
    router.push(role === 'seller' ? '/seller/onboarding' : '/');
    router.refresh();
  }

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="mx-auto mt-10 max-w-sm">
      <h1 className="text-2xl font-bold">Join GharSe</h1>
      <div className="mt-4 grid grid-cols-2 gap-2 rounded-2xl bg-rice-deep p-1.5">
        {(['buyer', 'seller'] as const).map((r) => (
          <button
            key={r}
            onClick={() => setRole(r)}
            className={`rounded-xl py-2 text-sm font-semibold transition-colors ${
              role === r ? 'bg-white shadow-card' : 'text-ink-soft'
            }`}
          >
            {r === 'buyer' ? '🛒 I want to eat' : '👩‍🍳 I want to cook'}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="Your name">
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} required />
        </Field>
        <Field label="Phone number">
          <Input
            inputMode="numeric"
            placeholder="10-digit mobile"
            value={form.phone}
            onChange={(e) => set('phone', e.target.value)}
            required
          />
        </Field>
        <Field label="Password" hint="At least 6 characters">
          <Input
            type="password"
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
            required
          />
        </Field>
        <Field label="Your society">
          <Select value={form.societyId} onChange={(e) => set('societyId', e.target.value)}>
            <option value="">Select society (optional)</option>
            {societies.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
        </Field>

        {role === 'seller' && (
          <>
            <Field label="Kitchen name" hint="What buyers will see, e.g. “Ammama's Biryani Ghar”">
              <Input
                value={form.kitchenName}
                onChange={(e) => set('kitchenName', e.target.value)}
                required
              />
            </Field>
            <Field label="About your kitchen">
              <Textarea rows={2} value={form.bio} onChange={(e) => set('bio', e.target.value)} />
            </Field>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.vegOnly}
                onChange={(e) => set('vegOnly', e.target.checked)}
                className="h-4 w-4 accent-leaf"
              />
              Pure vegetarian kitchen
            </label>
            <p className="rounded-xl bg-turmeric-tint px-3 py-2 text-xs text-ink-soft">
              After signup you&apos;ll complete a quick compliance step (FSSAI license or guided
              application) before your dishes go live.
            </p>
          </>
        )}

        <Button type="submit" size="lg" className="w-full" loading={busy}>
          Create account
        </Button>
      </form>
      <p className="mt-4 text-sm text-ink-soft">
        Already have an account?{' '}
        <Link href="/login" className="font-semibold text-leaf underline">
          Log in
        </Link>
      </p>
    </div>
  );
}

export default function RegisterPage() {
  return (
    <Suspense>
      <RegisterForm />
    </Suspense>
  );
}
