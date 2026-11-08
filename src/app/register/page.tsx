'use client';

import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';
import { Button, Field, Input, Select, Textarea } from '@/components/ui';
import { useToast } from '@/components/providers';
import { DisclaimerClient } from '@/components/disclaimer-client';
import { BRAND } from '@/config/brand';

function RegisterForm() {
  const router = useRouter();
  const params = useSearchParams();
  const toast = useToast();
  const [role, setRole] = useState<'buyer' | 'seller'>(params.get('as') === 'seller' ? 'seller' : 'buyer');
  const [societies, setSocieties] = useState<{ id: number; name: string }[]>([]);
  // Pilot Hardening v2 — Phase 6 (DECISIONS.md #87+): pick from the pilot's
  // live society/societies, or switch to an invite code for a not-yet-public one.
  const [societyMode, setSocietyMode] = useState<'select' | 'code'>('code');
  const referredByCode = params.get('ref') ?? '';
  const hasInviteCode = !!params.get('code');
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
    tower: '',
    flat: '',
  });
  // Explicit, never pre-ticked: 18+ and the Terms / Privacy Notice.
  const [age18, setAge18] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch('/api/societies?live=1')
      .then((r) => r.json())
      .then((d) => {
        setSocieties(d.societies);
        // Open pilot (list available): allow the dropdown when there is no invite code in the link.
        if (d.societies.length > 0 && !hasInviteCode) setSocietyMode('select');
      })
      .catch(() => {});
  }, [hasInviteCode]);

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
        age18,
        acceptTerms,
      }),
    });
    const data = await res.json();
    setBusy(false);
    if (!res.ok) {
      toast(data.error || 'Could not register', 'err');
      return;
    }
    toast(`Welcome to ${BRAND.name}! Check your email to verify your address.`);
    // Sellers land on the kitchen-profile onboarding step (photos etc.)
    // before the dashboard — see DECISIONS.md #73+.
    router.push(role === 'seller' ? '/seller/onboarding' : '/');
    router.refresh();
  }

  const set = (k: string, v: string | boolean) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="mx-auto mt-10 max-w-sm">
      <h1 className="text-2xl font-bold">Join {BRAND.name}</h1>
      <DisclaimerClient id="marketplace" className="mt-3" />
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
            👋 You were invited by a neighbour — welcome to {BRAND.name}!
          </p>
        )}

        <Field
          label="Your society"
          hint={
            societyMode === 'select'
              ? 'Choose your society.'
              : `${BRAND.name} is invite-only during the pilot. Use the invite code from your society’s WhatsApp group.`
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
          {societies.length > 0 && (
            <button
              type="button"
              onClick={() => setSocietyMode((m) => (m === 'select' ? 'code' : 'select'))}
              className="mt-1 inline-flex min-h-[44px] items-center text-xs font-semibold text-leaf underline"
            >
              {societyMode === 'select' ? 'Have an invite code instead?' : '← Choose from the list instead'}
            </button>
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tower / block"><Input value={form.tower} onChange={(e) => set('tower', e.target.value)} data-testid="reg-tower" /></Field>
          <Field label="Flat no."><Input value={form.flat} onChange={(e) => set('flat', e.target.value)} data-testid="reg-flat" /></Field>
        </div>

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

        <div className="space-y-1">
          <label className="flex min-h-[44px] items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-leaf" checked={age18} onChange={(e) => setAge18(e.target.checked)} data-testid="age18" />
            <span>I am 18 years or older.</span>
          </label>
          <label className="flex min-h-[44px] items-start gap-3 text-sm">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-leaf" checked={acceptTerms} onChange={(e) => setAcceptTerms(e.target.checked)} data-testid="accept-terms" />
            <span>I accept the <Link href="/legal/terms" className="inline-flex min-h-[44px] items-center font-semibold text-leaf underline" target="_blank">Terms</Link> and the <Link href="/legal/privacy" className="inline-flex min-h-[44px] items-center font-semibold text-leaf underline" target="_blank">Privacy Notice</Link>.</span>
          </label>
        </div>
        <Button type="submit" size="lg" className="w-full" loading={busy} disabled={!age18 || !acceptTerms}>
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
