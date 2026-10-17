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
  // Pilot Hardening v2 — Phase 6 (DECISIONS.md #87+): pick from the pilot's
  // live society/societies, or switch to an invite code for a not-yet-public one.
  const [societyMode, setSocietyMode] = useState<'select' | 'code'>(params.get('code') ? 'code' : 'select');
  const referredByCode = params.get('ref') ?? '';
  const [form, setForm] = useState({
    name: '',
    phone: '',
    email: '',
    password: '',
    societyId: '',
    inviteCode: params.get('code') ?? '',
    kitchenName: '',
    bio: '',
    vegOnly: false,
  });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/societies?live=1')
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
        inviteCode: societyMode === 'code' ? form.inviteCode.trim() : undefined,
        referredByCode: referredByCode || undefined,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      toast(data.error || 'Could not register', 'err');
      return;
    }
    toast('Welcome to PadosiPlate! Check your email to verify your address.');
    // Sellers land on the kitchen-profile onboarding step (photos etc.)
    // before the dashboard — see DECISIONS.md #73+.
    router.push(role === 'seller' ? '/seller/onboarding' : '/');
    router.refresh();
  }

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="mx-auto mt-10 max-w-sm">
      <h1 className="text-2xl font-bold">Join PadosiPlate</h1>
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
        <Field label="Email" hint="We'll send a verification link — also used to reset your password.">
          <Input
            type="email"
            autoComplete="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            required
          />
        </Field>
        <Field label="Password" hint="At least 8 characters">
          <Input
            type="password"
            value={form.password}
            onChange={(e) => set('password', e.target.value)}
            required
          />
        </Field>
        {referredByCode && (
          <p className="rounded-xl bg-leaf-tint px-3 py-2 text-xs font-medium text-leaf">
            👋 You were invited by a neighbour — welcome to PadosiPlate!
          </p>
        )}

        <Field
          label="Your society"
          hint={
            societyMode === 'select'
              ? 'PadosiPlate is live in one society right now — more coming soon.'
              : 'Got a code from your society WhatsApp group? Enter it here.'
          }
        >
          {societyMode === 'select' ? (
            <Select value={form.societyId} onChange={(e) => set('societyId', e.target.value)} required>
              <option value="">Select your society</option>
              {societies.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          ) : (
            <Input
              value={form.inviteCode}
              onChange={(e) => set('inviteCode', e.target.value.toUpperCase())}
              placeholder="e.g. CYBERZON"
              required
            />
          )}
          <button
            type="button"
            onClick={() => setSocietyMode((m) => (m === 'select' ? 'code' : 'select'))}
            className="mt-1 inline-flex min-h-[44px] items-center text-xs font-semibold text-leaf underline"
          >
            {societyMode === 'select' ? 'Have an invite code instead?' : '← Choose from the list instead'}
          </button>
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
        <Link href="/login" className="inline-flex min-h-[44px] items-center font-semibold text-leaf underline">
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
