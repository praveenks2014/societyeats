'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Input, Modal } from '@/components/ui';
import { useToast } from '@/components/providers';
import { StrikeAppeals } from '@/app/account/strike-appeals';
import { BRAND } from '@/config/brand';

type Sess = { key: string; createdAt: string; lastSeenAt: string; userAgent: string | null; ip: string | null; current: boolean };

export function AccountClient({ name, email, role }: { name: string; email: string | null; role: string }) {
  const router = useRouter();
  const toast = useToast();
  const [sessions, setSessions] = useState<Sess[]>([]);
  const [del, setDel] = useState(false);
  const [pw, setPw] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [refused, setRefused] = useState(false);

  const load = useCallback(() => {
    fetch('/api/auth/sessions').then((r) => r.json()).then((d) => setSessions(d.sessions ?? [])).catch(() => {});
  }, []);
  useEffect(load, [load]);

  async function signOut(body: { key?: string; all?: boolean }) {
    const res = await fetch('/api/auth/sessions', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (body.all) {
      router.push('/login');
      router.refresh();
      return;
    }
    if (!res.ok) toast('Could not sign that device out', 'err');
    load();
  }

  async function remove() {
    setBusy(true);
    const res = await fetch('/api/account/delete', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: pw, confirm }) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) {
      // A refused attempt (an open order, a wrong password) keeps the dialog and the typed DELETE, but never keeps the password in memory.
      setPw('');
      setRefused(true);
      return toast(d.error || 'Could not delete the account', 'err');
    }
    router.push('/');
    router.refresh();
  }

  return (
    <div className="mx-auto max-w-lg space-y-5 pt-6">
      <div>
        <h1 className="text-2xl font-bold">Your account</h1>
        <p className="mt-1 text-sm text-ink-soft">{name} · {email ?? 'no email'} <Badge tone="neutral">{role}</Badge></p>
      </div>

      <Card className="p-4" data-testid="sessions">
        <div className="eyebrow">DEVICES SIGNED IN</div>
        <ul className="mt-2 divide-y divide-rice-line">
          {sessions.map((s) => (
            <li key={s.key} className="flex items-center justify-between gap-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-medium">{(s.userAgent ?? 'Unknown device').slice(0, 60)} {s.current && <Badge tone="green">This device</Badge>}</span>
                <span className="text-xs text-ink-faint">Last used {new Date(s.lastSeenAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}</span>
              </span>
              {!s.current && <button className="min-h-[44px] shrink-0 px-2 text-xs font-semibold text-chili underline" onClick={() => signOut({ key: s.key })}>Sign out</button>}
            </li>
          ))}
        </ul>
        <Button variant="secondary" className="mt-3 w-full" onClick={() => signOut({ all: true })} data-testid="logout-all">Log out of all devices</Button>
      </Card>

      <Card className="space-y-3 p-4">
        <div className="eyebrow">LOGIN OPTIONS</div>
        <Link href="/change-password" className="flex min-h-[44px] items-center text-sm font-semibold text-leaf underline">Change password</Link>
        <Link href="/account/notifications" className="flex min-h-[44px] items-center text-sm font-semibold text-leaf underline" data-testid="notification-prefs-link">Notifications</Link>
        <a href="/api/auth/google/start?link=1" className="flex min-h-[44px] items-center text-sm font-semibold text-leaf underline">Link my Google account</a>
      </Card>

      {role !== 'admin' && <StrikeAppeals />}
      <Card className="space-y-3 p-4">
        <div className="eyebrow">YOUR DATA</div>
        <p className="text-sm text-ink-soft">You can download everything {BRAND.name} holds about you, or delete your account. Order and tax records we must keep by law stay, with your personal details removed.</p>
        <a href="/api/account/export" className="flex min-h-[44px] items-center justify-center rounded-xl border border-rice-line text-sm font-semibold" data-testid="export-data">Download my data</a>
        {role !== 'admin' && <Button variant="danger" className="w-full" onClick={() => setDel(true)} data-testid="delete-account">Delete my account</Button>}
        <p className="text-xs text-ink-faint">Questions or complaints? <Link href="/legal/grievance" className="underline">Contact the grievance officer</Link>.</p>
      </Card>

      <Modal open={del} onClose={() => { setDel(false); setPw(''); setRefused(false); }} title="Delete your account?" sheet>
        <p className="text-sm text-ink-soft">This cannot be undone. You must have no open orders.</p>
        <div className="mt-3 space-y-3">
          <Field label="Your password" hint={refused ? 'Enter your password again. We clear it after every attempt for your security.' : undefined}><Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="delete-password" autoComplete="current-password" /></Field>
          <Field label="Type DELETE to confirm"><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="delete-confirm" /></Field>
          <Button variant="danger" className="w-full" loading={busy} disabled={confirm !== 'DELETE' || !pw} onClick={remove} data-testid="confirm-delete">Delete my account</Button>
        </div>
      </Modal>
    </div>
  );
}
