'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Input, Modal, Skeleton } from '@/components/ui';
import { useToast } from '@/components/providers';

type Society = { id: number; name: string; city: string; addressText: string; pincode: string | null; lat: number; lng: number; inviteCode: string | null; isLive: boolean; isActive: boolean; requireApproval: boolean; residents: number; kitchens: number; pending: number; targetHouseholds: number };
type Pending = { id: number; name: string; phone: string; email: string | null; role: string; society: string | null };
const blank = { name: '', city: 'Hyderabad', addressText: '', pincode: '', lat: '', lng: '' };

export default function AdminSocieties() {
  const toast = useToast();
  const [rows, setRows] = useState<Society[] | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [edit, setEdit] = useState<{ id?: number; form: typeof blank } | null>(null);
  const [share, setShare] = useState<Society | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch('/api/admin/societies').then((r) => r.json()).then((d) => setRows(d.societies));
    fetch('/api/admin/approvals').then((r) => r.json()).then((d) => setPending(d.pending ?? []));
  }, []);
  useEffect(load, [load]);

  async function patch(id: number, body: Record<string, unknown>, msg?: string) {
    const res = await fetch(`/api/admin/societies/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return toast(d.error || 'Failed', 'err');
    if (msg) toast(msg);
    load();
  }

  async function geocode() {
    if (!edit) return;
    const res = await fetch('/api/admin/societies/geocode', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ address: `${edit.form.name} ${edit.form.addressText} ${edit.form.city}`, pincode: edit.form.pincode }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return toast(d.error || 'Could not geocode', 'err');
    setEdit({ ...edit, form: { ...edit.form, lat: String(d.lat), lng: String(d.lng) } });
    toast(d.mock ? 'Filled with a mock location (set GEOCODE_API_KEY for real lookups)' : 'Location found');
  }

  async function save() {
    if (!edit) return;
    setBusy(true);
    const f = edit.form;
    const body = { name: f.name, city: f.city, addressText: f.addressText, pincode: f.pincode || '', lat: Number(f.lat), lng: Number(f.lng) };
    const res = await fetch(edit.id ? `/api/admin/societies/${edit.id}` : '/api/admin/societies', { method: edit.id ? 'PATCH' : 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(d.error || 'Could not save', 'err');
    toast('Saved ✅');
    setEdit(null);
    load();
  }

  async function decide(userId: number, decision: 'approve' | 'reject') {
    const res = await fetch('/api/admin/approvals', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ userId, decision }) });
    if (res.ok) { toast(decision === 'approve' ? 'Approved' : 'Rejected'); load(); } else toast('Failed', 'err');
  }

  if (!rows) return <Skeleton className="h-64 w-full" />;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';

  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">Societies</h1>
        <Button onClick={() => setEdit({ form: blank })} data-testid="new-society">+ New society</Button>
      </div>

      {pending.length > 0 && (
        <Card className="mt-4 border-turmeric p-4" data-testid="approvals">
          <div className="eyebrow">WAITING FOR APPROVAL ({pending.length})</div>
          <div className="mt-2 space-y-2">
            {pending.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span><strong>{p.name}</strong> · {p.email} · {p.society}</span>
                <span className="flex gap-2"><Button size="sm" onClick={() => decide(p.id, 'approve')}>Approve</Button><Button size="sm" variant="ghost" onClick={() => decide(p.id, 'reject')}>Reject</Button></span>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="mt-5 space-y-3">
        {rows.map((s) => (
          <Card key={s.id} className={`p-4 ${s.isActive ? '' : 'opacity-60'}`} data-testid={`society-${s.id}`}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <div className="font-semibold">{s.name} <span className="text-xs font-normal text-ink-faint">{s.city}{s.pincode ? ` ${s.pincode}` : ''}</span></div>
                <div className="text-xs text-ink-faint">{s.addressText} · {s.lat.toFixed(4)}, {s.lng.toFixed(4)}</div>
                <div className="mt-1 text-sm">👥 {s.residents} residents · 🍲 {s.kitchens} kitchens{s.pending ? ` · ⏳ ${s.pending} pending` : ''}</div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <Badge tone={s.isLive ? 'green' : 'neutral'}>{s.isLive ? 'Live' : 'Invite-only'}</Badge>
                {!s.isActive && <Badge tone="red">Deactivated</Badge>}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" className="h-5 w-5 accent-leaf" checked={s.isLive} onChange={(e) => patch(s.id, { isLive: e.target.checked })} />Live (listed on sign-up)</label>
              <label className="flex min-h-[44px] items-center gap-2"><input type="checkbox" className="h-5 w-5 accent-leaf" checked={s.requireApproval} onChange={(e) => patch(s.id, { requireApproval: e.target.checked })} />Approve new residents</label>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2">
              <code className="rounded-lg bg-rice px-2 py-1 text-xs" data-testid="invite-code">{s.inviteCode}</code>
              <Button size="sm" variant="ghost" onClick={() => patch(s.id, { rotateInviteCode: true }, 'Invite code rotated — old links stop working')}>Rotate code</Button>
              <Button size="sm" variant="secondary" onClick={() => setShare(s)} data-testid="share-society">Share</Button>
              <Button size="sm" variant="ghost" onClick={() => setEdit({ id: s.id, form: { name: s.name, city: s.city, addressText: s.addressText, pincode: s.pincode ?? '', lat: String(s.lat), lng: String(s.lng) } })}>Edit</Button>
              <Button size="sm" variant="ghost" onClick={() => patch(s.id, { isActive: !s.isActive }, s.isActive ? 'Deactivated' : 'Reactivated')}>{s.isActive ? 'Deactivate' : 'Reactivate'}</Button>
            </div>
          </Card>
        ))}
      </div>

      <Modal open={!!edit} onClose={() => setEdit(null)} sheet>
        {edit && (
          <div className="space-y-3">
            <h2 className="font-display text-lg font-bold">{edit.id ? 'Edit society' : 'New society'}</h2>
            <Field label="Name"><Input value={edit.form.name} onChange={(e) => setEdit({ ...edit, form: { ...edit.form, name: e.target.value } })} data-testid="soc-name" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="City"><Input value={edit.form.city} onChange={(e) => setEdit({ ...edit, form: { ...edit.form, city: e.target.value } })} /></Field>
              <Field label="Pincode"><Input inputMode="numeric" value={edit.form.pincode} onChange={(e) => setEdit({ ...edit, form: { ...edit.form, pincode: e.target.value } })} /></Field>
            </div>
            <Field label="Address"><Input value={edit.form.addressText} onChange={(e) => setEdit({ ...edit, form: { ...edit.form, addressText: e.target.value } })} data-testid="soc-address" /></Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Latitude"><Input inputMode="decimal" value={edit.form.lat} onChange={(e) => setEdit({ ...edit, form: { ...edit.form, lat: e.target.value } })} data-testid="soc-lat" /></Field>
              <Field label="Longitude"><Input inputMode="decimal" value={edit.form.lng} onChange={(e) => setEdit({ ...edit, form: { ...edit.form, lng: e.target.value } })} /></Field>
            </div>
            <Button variant="secondary" onClick={geocode} data-testid="geocode">📍 Geocode from address</Button>
            <div className="flex justify-end gap-2"><Button variant="ghost" onClick={() => setEdit(null)}>Cancel</Button><Button loading={busy} onClick={save} disabled={!edit.form.name || !edit.form.addressText || !edit.form.lat || !edit.form.lng} data-testid="save-society">Save</Button></div>
          </div>
        )}
      </Modal>

      <Modal open={!!share} onClose={() => setShare(null)} sheet>
        {share && share.inviteCode && (
          <ShareBody society={share} origin={origin} />
        )}
      </Modal>
    </div>
  );
}

function ShareBody({ society, origin }: { society: Society; origin: string }) {
  const toast = useToast();
  const link = `${origin}/join/${society.inviteCode}`;
  const text = [`🍛 *PadosiPlate* is now live in *${society.name}*!`, '', 'Home food from your neighbours — order fresh home-cooked meals from people in your society, or list your own kitchen.', '', `👉 Join here: ${link}`, `Invite code: *${society.inviteCode}*`, '', 'You pay the kitchen directly (UPI or at pickup). Only a small platform fee goes to us.'].join('\n');
  return (
    <div className="space-y-3">
      <h2 className="font-display text-lg font-bold">Share {society.name}</h2>
      <Field label="WhatsApp message"><textarea readOnly rows={8} value={text} className="w-full rounded-xl border border-rice-line bg-white p-3 text-sm" data-testid="whatsapp-text" /></Field>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => navigator.clipboard?.writeText(text).then(() => toast('Message copied'))} data-testid="copy-whatsapp">Copy message</Button>
        <a href={`https://wa.me/?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer"><Button variant="secondary">Open WhatsApp</Button></a>
        <a href={`/api/admin/societies/${society.id}/poster`}><Button variant="secondary" data-testid="poster">⬇ QR poster (PDF)</Button></a>
      </div>
      <p className="break-all text-xs text-ink-faint">{link}</p>
    </div>
  );
}
