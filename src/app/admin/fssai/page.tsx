'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, Input, Skeleton } from '@/components/ui';
import { useToast } from '@/components/providers';
import { FssaiFunnel } from '@/components/fssai-funnel';
import { formatINR } from '@/lib/money';

type AppRow = {
  id: number;
  applicantName: string;
  kitchenName: string;
  sellerPhone: string;
  kitchenAddress: string;
  licenseType: string;
  status: string;
  foscosRefNumber: string | null;
  documentsJson: { label: string; url: string }[] | null;
  createdAt: string;
  filingMode: 'facilitator' | 'self';
  facilitationCostInPaise: number;
  sponsoredByPlatform: boolean;
};

const STATUS_BADGE: Record<string, { label: string; tone: 'amber' | 'green' | 'red' | 'neutral' }> = {
  submitted_to_backoffice: { label: 'To file on FoSCoS', tone: 'amber' },
  filed_on_foscos: { label: 'Filed — awaiting grant', tone: 'neutral' },
  granted: { label: 'Granted', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
  // FSSAI hardening v3 (DECISIONS.md #119+).
  inspection_ordered: { label: 'Inspection ordered', tone: 'red' },
  inadequacy_notice: { label: 'Inadequacy notice', tone: 'red' },
};

export default function AdminFssai() {
  const [tab, setTab] = useState<'queue' | 'verify'>('queue');

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold">FSSAI</h1>
        <Link href="/admin/fssai/content" className="text-sm font-semibold text-leaf underline">Edit walkthrough content →</Link>
      </div>
      <FssaiFunnel />
      <div className="mt-3 flex gap-1.5 rounded-2xl bg-rice-deep p-1">
        <TabButton active={tab === 'queue'} onClick={() => setTab('queue')}>
          Applications queue
        </TabButton>
        <TabButton active={tab === 'verify'} onClick={() => setTab('verify')}>
          Verify licenses
        </TabButton>
      </div>
      {tab === 'queue' ? <ApplicationsQueue /> : <VerifyLicensesQueue />}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex-1 rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
        active ? 'bg-white text-ink shadow-card' : 'text-ink-soft hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}

function ApplicationsQueue() {
  const [rows, setRows] = useState<AppRow[] | null>(null);
  const [inputs, setInputs] = useState<Record<number, string>>({});
  const toast = useToast();

  function load() {
    fetch('/api/admin/fssai')
      .then((r) => r.json())
      .then((d) => setRows(d.applications))
      .catch(() => {});
  }
  useEffect(load, []);

  async function act(id: number, body: Record<string, string | boolean>) {
    const res = await fetch(`/api/admin/fssai/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await res.json();
    if (!res.ok) {
      toast(d.error || 'Could not update', 'err');
      return;
    }
    toast('Updated ✅');
    setInputs((prev) => ({ ...prev, [id]: '' }));
    load();
  }

  if (!rows) return <Skeleton className="mt-5 h-64 w-full" />;

  return (
    <div>
      <p className="mt-4 text-sm text-ink-soft">
        New applications are always self-filed by the seller — this queue is for tracking each to
        grant once filed on FoSCoS, plus any legacy application PadosiPlate's back office filed by hand.
        Applications land here once filed (there's no public FoSCoS submission API to poll instead).
      </p>

      {rows.length === 0 ? (
        <EmptyState emoji="🗂️" title="Queue is clear" />
      ) : (
        <div className="mt-5 space-y-4">
          {rows.map((a) => {
            const badge = STATUS_BADGE[a.status] ?? { label: a.status, tone: 'neutral' as const };
            return (
              <Card key={a.id} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">
                      {a.kitchenName || a.applicantName}{' '}
                      <span className="text-xs font-normal text-ink-faint">#{a.id}</span>
                    </div>
                    <div className="text-xs text-ink-faint">
                      {a.applicantName} · {a.sellerPhone} ·{' '}
                      {a.licenseType === 'state' ? 'State License' : 'Basic Registration'} ·{' '}
                      {a.filingMode === 'self' ? 'self-filed' : "PadosiPlate's back office files"}
                    </div>
                  </div>
                  <Badge tone={badge.tone}>{badge.label}</Badge>
                </div>
                <p className="mt-2 text-sm text-ink-soft">📍 {a.kitchenAddress}</p>
                {a.documentsJson && a.documentsJson.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {a.documentsJson.map((d) => (
                      <a
                        key={d.label}
                        href={d.url}
                        target="_blank"
                        rel="noreferrer"
                        className="rounded-pill bg-rice-deep px-2.5 py-1 text-xs text-ink-soft hover:bg-rice-line"
                      >
                        📎 {d.label}
                      </a>
                    ))}
                  </div>
                )}
                <Link
                  href={`/fssai/${a.id}/summary`}
                  className="mt-2 inline-block text-xs font-semibold text-leaf underline"
                >
                  View prefilled summary & bundle →
                </Link>
                {a.foscosRefNumber && (
                  <p className="mt-2 text-xs">
                    FoSCoS ref: <strong>{a.foscosRefNumber}</strong>
                  </p>
                )}
                {a.filingMode === 'facilitator' && (
                  <div className="mt-2 flex items-center gap-2 text-xs">
                    <span className={a.sponsoredByPlatform ? 'text-leaf' : 'text-ink-faint'}>
                      {a.sponsoredByPlatform
                        ? `✅ Sponsored (${formatINR(a.facilitationCostInPaise)}) — PadosiPlate acquisition cost, not a seller debt`
                        : '⛔ Not sponsored (outside cohort cap)'}
                    </span>
                    <button
                      className="text-ink-faint underline hover:text-ink"
                      onClick={() => act(a.id, { action: 'sponsor', sponsoredByPlatform: !a.sponsoredByPlatform })}
                    >
                      Toggle
                    </button>
                  </div>
                )}

                {a.status === 'submitted_to_backoffice' && (
                  <div className="mt-3 flex gap-2">
                    <Input
                      placeholder="FoSCoS reference no."
                      value={inputs[a.id] ?? ''}
                      onChange={(e) => setInputs((p) => ({ ...p, [a.id]: e.target.value }))}
                    />
                    <Button
                      size="sm"
                      disabled={!(inputs[a.id] ?? '').trim()}
                      onClick={() => act(a.id, { action: 'file', foscosRefNumber: inputs[a.id] })}
                    >
                      Mark filed
                    </Button>
                    <Button size="sm" variant="danger" onClick={() => act(a.id, { action: 'reject' })}>
                      Reject
                    </Button>
                  </div>
                )}
                {a.status === 'filed_on_foscos' && (
                  <div className="mt-3 space-y-2">
                    <div className="flex gap-2">
                      <Input
                        placeholder="Granted 14-digit license no."
                        inputMode="numeric"
                        maxLength={14}
                        value={inputs[a.id] ?? ''}
                        onChange={(e) => setInputs((p) => ({ ...p, [a.id]: e.target.value.replace(/\D/g, '') }))}
                      />
                      <Button
                        size="sm"
                        disabled={(inputs[a.id] ?? '').length !== 14}
                        onClick={() => act(a.id, { action: 'grant', licenseNumber: inputs[a.id] })}
                      >
                        Mark granted
                      </Button>
                    </div>
                    {/* FSSAI hardening v3 (DECISIONS.md #119+): record it if FoSCoS
                        actually responded during the deemed-commencement window —
                        see src/lib/fssai/gate.ts. */}
                    <div className="flex gap-2 text-xs">
                      {a.licenseType === 'registration' ? (
                        <button
                          className="text-ink-faint underline hover:text-chili"
                          onClick={() => act(a.id, { action: 'inspection_ordered' })}
                        >
                          FoSCoS ordered an inspection
                        </button>
                      ) : (
                        <button
                          className="text-ink-faint underline hover:text-chili"
                          onClick={() => act(a.id, { action: 'inadequacy_notice' })}
                        >
                          FoSCoS issued an inadequacy notice
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------- Verify licenses (FSSAI hardening v3, DECISIONS.md #119+, item 3) ----------

type VerifyRow = {
  userId: number;
  sellerName: string;
  sellerPhone: string;
  kitchenName: string;
  kitchenAddress: string | null;
  fssaiNumber: string | null;
  fssaiExpiry: string | null;
  fssaiCertificateUrl: string | null;
  fssaiLicenseeName: string | null;
  fssaiLicenseeAddress: string | null;
  timelineJson: { at: string; event: string }[];
};

const FOSCOS_URL = 'https://foscos.fssai.gov.in';

function VerifyLicensesQueue() {
  const [rows, setRows] = useState<VerifyRow[] | null>(null);
  const toast = useToast();

  function load() {
    fetch('/api/admin/fssai/verify-queue')
      .then((r) => r.json())
      .then((d) => setRows(d.sellers))
      .catch(() => {});
  }
  useEffect(load, []);

  if (!rows) return <Skeleton className="mt-5 h-64 w-full" />;

  return (
    <div>
      <p className="mt-4 text-sm text-ink-soft">
        Sellers who entered a license number PadosiPlate couldn't auto-confirm — compare their identity
        against the number they entered, then mark it verified or reject it with a reason.
      </p>
      {rows.length === 0 ? (
        <EmptyState emoji="✅" title="Nothing to check right now" />
      ) : (
        <div className="mt-5 space-y-4">
          {rows.map((r) => (
            <VerifyRowCard key={r.userId} row={r} onDone={load} toast={toast} />
          ))}
        </div>
      )}
    </div>
  );
}

function VerifyRowCard({
  row,
  onDone,
  toast,
}: {
  row: VerifyRow;
  onDone: () => void;
  toast: (msg: string, tone?: 'ok' | 'err') => void;
}) {
  const [confirmName, setConfirmName] = useState(false);
  const [confirmAddress, setConfirmAddress] = useState(false);
  const [confirmExpiry, setConfirmExpiry] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  async function act(body: Record<string, unknown>) {
    setBusy(true);
    const res = await fetch(`/api/admin/fssai/verify-queue/${row.userId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) {
      toast(d.error || 'Could not update', 'err');
      return;
    }
    toast('Updated ✅');
    onDone();
  }

  function copyNumber() {
    if (row.fssaiNumber) navigator.clipboard?.writeText(row.fssaiNumber).catch(() => {});
    toast('Copied number');
  }

  const expiryInFuture = row.fssaiExpiry ? new Date(row.fssaiExpiry) > new Date() : false;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold">{row.kitchenName || row.sellerName}</div>
          <div className="text-xs text-ink-faint">{row.sellerName} · {row.sellerPhone}</div>
        </div>
        <Badge tone="amber">Verification in progress</Badge>
      </div>

      {/* side-by-side identity check */}
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs">
        <div>
          <div className="eyebrow mb-1">ON FILE (SELLER)</div>
          <div className="font-medium">{row.sellerName}</div>
          <div className="text-ink-soft">{row.kitchenName}</div>
          <div className="mt-1 text-ink-soft">{row.kitchenAddress || '—'}</div>
        </div>
        <div>
          <div className="eyebrow mb-1">NUMBER ENTERED / API RESULT</div>
          <div className="flex items-center gap-1.5 font-medium">
            {row.fssaiNumber || '—'}
            {row.fssaiNumber && (
              <button onClick={copyNumber} className="text-ink-faint underline hover:text-ink">
                copy
              </button>
            )}
          </div>
          {row.fssaiLicenseeName ? (
            <>
              <div className="text-ink-soft">API found: {row.fssaiLicenseeName}</div>
              <div className="text-ink-soft">{row.fssaiLicenseeAddress || 'No address returned'}</div>
            </>
          ) : (
            <div className="text-chili-dark">API could not verify this number</div>
          )}
          <div className="mt-1 text-ink-soft">
            Expiry: {row.fssaiExpiry || '—'} {row.fssaiExpiry && (expiryInFuture ? '(future ✓)' : '(past/expired ⚠️)')}
          </div>
        </div>
      </div>

      {row.fssaiCertificateUrl && (
        <a
          href={row.fssaiCertificateUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2 flex items-center gap-2 text-xs font-semibold text-leaf underline"
        >
          {/* Inline thumbnail for an image certificate; a PDF has no cheap
              in-browser thumbnail without a new rendering dependency (none
              exists anywhere in this codebase — same reasoning as the tax
              invoice / FSSAI summary pages using window.print() instead of
              a PDF library, DECISIONS.md #68), so it falls back to a plain link. */}
          {/\.(jpe?g|png|webp)$/i.test(row.fssaiCertificateUrl) ? (
             
            <img
              src={row.fssaiCertificateUrl}
              alt="FSSAI certificate"
              className="h-14 w-14 rounded-lg border border-rice-line object-cover"
            />
          ) : (
            <span>📎</span>
          )}
          View uploaded certificate
        </a>
      )}
      <a
        href={FOSCOS_URL}
        target="_blank"
        rel="noreferrer"
        className="mt-2 ml-3 inline-block text-xs font-semibold text-leaf underline"
      >
        Check on FoSCoS →
      </a>

      {row.timelineJson.length > 0 && (
        <div className="mt-3 space-y-1.5 border-t border-rice-line pt-2.5">
          {row.timelineJson.map((t, i) => (
            <div key={i} className="text-xs text-ink-faint">
              {new Date(t.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })} — {t.event}
            </div>
          ))}
        </div>
      )}

      <div className="mt-3 space-y-2 rounded-2xl bg-rice px-3 py-2.5">
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={confirmName} onChange={(e) => setConfirmName(e.target.checked)} className="accent-leaf" />
          Name matches the seller
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={confirmAddress} onChange={(e) => setConfirmAddress(e.target.checked)} className="accent-leaf" />
          Address matches the kitchen
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input type="checkbox" checked={confirmExpiry} onChange={(e) => setConfirmExpiry(e.target.checked)} className="accent-leaf" />
          Expiry is in the future
        </label>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={!confirmName || !confirmAddress || !confirmExpiry}
          loading={busy}
          onClick={() => act({ action: 'verify', confirmName, confirmAddress, confirmExpiryFuture: confirmExpiry })}
        >
          Mark verified
        </Button>
      </div>
      <div className="mt-2 flex gap-2">
        <Input placeholder="Rejection reason (optional)" value={reason} onChange={(e) => setReason(e.target.value)} />
        <Button size="sm" variant="danger" loading={busy} onClick={() => act({ action: 'reject', reason })}>
          Reject
        </Button>
      </div>
    </Card>
  );
}
