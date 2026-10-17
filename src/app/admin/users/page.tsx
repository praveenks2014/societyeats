'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, Input, Skeleton } from '@/components/ui';
import { useToast } from '@/components/providers';

type U = { id: number; name: string; phone: string; email: string | null; role: string; blockedAt: string | null; emailVerifiedAt: string | null; approvalStatus: string; createdAt: string; lastLoginAt: string | null; society: string | null };

export default function AdminUsers() {
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<U[] | null>(null);
  const [sel, setSel] = useState<U | null>(null);
  const toast = useToast();

  const load = useCallback((query: string) => {
    fetch(`/api/admin/users?q=${encodeURIComponent(query)}`).then((r) => r.json()).then((d) => setRows(d.users)).catch(() => {});
  }, []);
  useEffect(() => {
    const t = setTimeout(() => load(q), 250);
    return () => clearTimeout(t);
  }, [q, load]);

  async function act(u: U, action: 'block' | 'unblock' | 'reset_password') {
    if (action === 'block' && !confirm(`Block ${u.name}? This signs them out everywhere.`)) return;
    const res = await fetch(`/api/admin/users/${u.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return toast(d.error || 'Failed', 'err');
    toast(action === 'reset_password' ? 'Reset email sent' : action === 'block' ? 'Blocked — sessions ended' : 'Unblocked');
    load(q);
    setSel(null);
  }

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold">Users</h1>
      <Input className="mt-3" placeholder="Search name, phone or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" data-testid="user-search" />
      {!rows ? <Skeleton className="mt-4 h-40 w-full" /> : rows.length === 0 ? <div className="mt-6"><EmptyState emoji="🔍" title="No users found" /></div> : (
        <div className="mt-4 space-y-2">
          {rows.map((u) => (
            <Card key={u.id} className="p-3.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <button className="min-h-[44px] text-left" onClick={() => setSel(sel?.id === u.id ? null : u)}>
                  <div className="font-semibold">{u.name} <span className="text-xs font-normal text-ink-faint">#{u.id}</span></div>
                  <div className="text-xs text-ink-faint">{u.email ?? 'no email'} {u.emailVerifiedAt ? '✓' : ''} · {u.phone.startsWith('a') ? '—' : u.phone} · {u.society ?? 'no society'}</div>
                </button>
                <div className="flex items-center gap-1.5">
                  <Badge tone={u.role === 'admin' ? 'green' : 'neutral'}>{u.role}</Badge>
                  {u.approvalStatus !== 'approved' && <Badge tone="amber">{u.approvalStatus}</Badge>}
                  {u.blockedAt && <Badge tone="red">blocked</Badge>}
                </div>
              </div>
              {sel?.id === u.id && (
                <div className="mt-3 space-y-2 border-t border-rice-line pt-3 text-sm">
                  <div className="text-xs text-ink-faint">Joined {new Date(u.createdAt).toLocaleDateString('en-IN')} · last login {u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString('en-IN') : 'never'}</div>
                  <div className="flex flex-wrap gap-2">
                    {u.blockedAt ? <Button size="sm" onClick={() => act(u, 'unblock')}>Unblock</Button> : <Button size="sm" variant="danger" onClick={() => act(u, 'block')} data-testid="block-user">Block</Button>}
                    <Button size="sm" variant="secondary" disabled={!u.email} onClick={() => act(u, 'reset_password')}>Send password reset</Button>
                  </div>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
