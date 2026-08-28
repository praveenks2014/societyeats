'use client';

import { useEffect, useState } from 'react';
import { Badge, Button, Card, EmptyState, Input, Skeleton } from '@/components/ui';
import { useToast } from '@/components/providers';

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
};

const STATUS_BADGE: Record<string, { label: string; tone: 'amber' | 'green' | 'red' | 'neutral' }> = {
  submitted_to_backoffice: { label: 'To file on FoSCoS', tone: 'amber' },
  filed_on_foscos: { label: 'Filed — awaiting grant', tone: 'neutral' },
  granted: { label: 'Granted', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
};

export default function AdminFssai() {
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

  async function act(id: number, body: Record<string, string>) {
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

  if (!rows) return <Skeleton className="h-64 w-full" />;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">FSSAI back-office queue</h1>
      <p className="mt-1 text-sm text-ink-soft">
        The team files each application on FoSCoS manually (there is no public government API), then
        records the reference number and final grant here.
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
                      {a.licenseType === 'state' ? 'State License' : 'Basic Registration'}
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
                {a.foscosRefNumber && (
                  <p className="mt-2 text-xs">
                    FoSCoS ref: <strong>{a.foscosRefNumber}</strong>
                  </p>
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
                  <div className="mt-3 flex gap-2">
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
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
