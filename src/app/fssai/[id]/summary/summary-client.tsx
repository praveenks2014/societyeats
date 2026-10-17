'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Input, Skeleton } from '@/components/ui';
import { useToast } from '@/components/providers';

type Step = { id: number; title: string; body: string; tip: string | null; screenshotUrl: string | null };
type Summary = {
  persistentNotice: string;
  formA: { title: string; rows: string[][] }[] | null;
  feeInPaise: number | null;
  years: number | null;
  id: number;
  generatedAt: string;
  platform: { name: string };
  applicant: { name: string; phone: string; kitchenName: string; kitchenAddress: string };
  licenseType: 'registration' | 'state';
  documents: { label: string; url: string }[];
  filingMode: 'facilitator' | 'self';
  facilitationCostInPaise: number;
  sponsoredByPlatform: boolean;
  status: string;
  foscosRefNumber: string | null;
  createdAt: string;
  canSelfFile: boolean;
};

const FOSCOS_URL = 'https://foscos.fssai.gov.in/';

export function FssaiSummaryView({ applicationId }: { applicationId: number }) {
  const [data, setData] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ref, setRef] = useState('');
  const [busy, setBusy] = useState(false);
  const [lang, setLang] = useState('en');
  const [steps, setSteps] = useState<Step[]>([]);
  const [languages, setLanguages] = useState<{ code: string; label: string }[]>([]);
  const toast = useToast();

  useEffect(() => {
    fetch(`/api/fssai/walkthrough?lang=${lang}`).then((r) => r.json()).then((d) => { setSteps(d.steps ?? []); setLanguages(d.languages ?? []); }).catch(() => {});
  }, [lang]);

  function printPack() {
    fetch('/api/fssai/funnel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stage: 'pack_downloaded' }) }).catch(() => {});
    window.print();
  }

  function load() {
    fetch(`/api/fssai/applications/${applicationId}/summary`)
      .then(async (r) => {
        const d = await r.json();
        if (!r.ok) {
          setError(d.error || 'Could not load application summary');
          return;
        }
        setData(d);
      })
      .catch(() => setError('Network error'));
  }
  useEffect(load, [applicationId]);

  async function submitSelfFile() {
    setBusy(true);
    const res = await fetch(`/api/fssai/applications/${applicationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ foscosRefNumber: ref }),
    });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) {
      toast(d.error || 'Could not save', 'err');
      return;
    }
    toast('Saved — tracking your application to grant ✅');
    load();
  }

  if (error) {
    return (
      <div className="pt-16 text-center">
        <p className="text-lg font-semibold">{error}</p>
        <Link href="/seller/compliance" className="mt-3 inline-block text-sm text-leaf underline">
          ← Back to compliance
        </Link>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="mx-auto max-w-xl space-y-4 pt-6">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-72 w-full" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl pt-6">
      <div className="mb-4 flex items-center justify-between print:hidden">
        <Link href="/seller/compliance" className="text-sm font-semibold text-leaf underline">
          ← Back to compliance
        </Link>
        <Button size="sm" onClick={printPack} data-testid="print-pack">
          🖨 Print / Save as PDF
        </Button>
      </div>

      <Card className="p-6 print:border-0 print:shadow-none">
        <div className="flex items-start justify-between gap-4 border-b border-dashed border-rice-line pb-4">
          <div>
            <div className="font-display text-xl font-bold text-leaf">{data.platform.name}</div>
            <div className="mt-0.5 text-xs text-ink-faint">FSSAI application summary — for filing on FoSCoS</div>
          </div>
          <div className="text-right">
            <div className="text-sm font-bold uppercase tracking-wide">Application #{data.id}</div>
            <div className="text-xs text-ink-faint">
              Generated{' '}
              {new Date(data.generatedAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </div>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
          <div>
            <div className="eyebrow mb-1">APPLICANT</div>
            <div className="font-semibold">{data.applicant.name}</div>
            <div className="text-ink-soft">{data.applicant.phone}</div>
          </div>
          <div>
            <div className="eyebrow mb-1">KITCHEN</div>
            <div className="font-semibold">{data.applicant.kitchenName || '—'}</div>
            <div className="text-ink-soft">{data.applicant.kitchenAddress}</div>
          </div>
        </div>

        <p className="mt-4 rounded-xl bg-turmeric-tint px-3 py-2.5 text-sm text-ink-soft" data-testid="pack-notice">{data.persistentNotice}</p>

        {data.formA ? (
          <div className="mt-4 space-y-3" data-testid="form-a">
            <div className="eyebrow">FSSAI BASIC REGISTRATION · FORM A</div>
            {data.formA.map((sec) => (
              <div key={sec.title}>
                <div className="text-sm font-bold">{sec.title}</div>
                <dl className="mt-1 space-y-0.5 text-sm">
                  {sec.rows.map(([k, v], i) => (
                    <div key={i} className="flex justify-between gap-4"><dt className="shrink-0 text-ink-faint">{k}</dt><dd className="text-right">{v}</dd></div>
                  ))}
                </dl>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-4 rounded-xl bg-leaf-tint px-3 py-2.5 text-sm text-leaf-dark">
            This is a legacy application set to <strong>{data.licenseType === 'state' ? 'State License' : 'Basic Registration'}</strong>. Confirm category, documents and fees on FoSCoS.
          </div>
        )}

        <div className="mt-4">
          <div className="eyebrow mb-1.5">DOCUMENT BUNDLE</div>
          {data.documents.length === 0 ? (
            <p className="text-sm text-ink-faint">No documents uploaded.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {data.documents.map((d) => (
                <a
                  key={d.label}
                  href={d.url}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-pill bg-rice-deep px-2.5 py-1 text-xs text-ink-soft hover:bg-rice-line print:no-underline"
                >
                  📎 {d.label}
                </a>
              ))}
            </div>
          )}
        </div>

        <div className="mt-5 border-t border-dashed border-rice-line pt-4">
          {data.filingMode === 'facilitator' ? (
            <>
              <div className="flex items-center gap-2">
                <Badge tone="amber">Filed for you</Badge>
                <span className="text-sm font-semibold">PadosiPlate's back office files this on FoSCoS</span>
              </div>
              <p className="mt-2 text-sm text-ink-soft">
                PadosiPlate's back office uses this exact summary and document bundle to file your
                application on FoSCoS by hand within 48 hours, then tracks it through to grant on your{' '}
                <Link href="/seller/compliance" className="text-leaf underline">
                  compliance page
                </Link>
                .
              </p>
              <p className="mt-2 text-xs text-ink-faint">
                {data.sponsoredByPlatform
                  ? `Facilitation is sponsored by PadosiPlate for this pilot cohort — ₹${(data.facilitationCostInPaise / 100).toLocaleString('en-IN')} recorded as our own acquisition cost, never billed to you.`
                  : 'This application is outside the current sponsorship cap — contact support about facilitation costs.'}
              </p>
            </>
          ) : (
            <>
              <div className="flex items-center gap-2">
                <Badge tone="neutral">Filing it yourself</Badge>
                <span className="text-sm font-semibold">Step-by-step FoSCoS walkthrough</span>
              </div>
              {languages.length > 1 && (
                <div className="mt-2 flex gap-1.5 print:hidden" role="tablist" aria-label="Language">
                  {languages.map((l) => (
                    <button key={l.code} role="tab" aria-selected={lang === l.code} onClick={() => setLang(l.code)} className={`min-h-[36px] rounded-pill px-3 text-xs font-semibold ${lang === l.code ? 'bg-leaf text-white' : 'bg-rice-deep text-ink-soft'}`}>{l.label}</button>
                  ))}
                </div>
              )}
              <ol className="mt-3 list-decimal space-y-3 pl-5 text-sm text-ink-soft" data-testid="walkthrough">
                {steps.map((st) => (
                  <li key={st.id}>
                    <div className="font-semibold text-ink">{st.title}</div>
                    <p>{st.body}</p>
                    {st.tip && <p className="mt-0.5 text-xs text-ink-faint">💡 {st.tip}</p>}
                    {st.screenshotUrl && <img src={st.screenshotUrl} alt={`Screenshot: ${st.title}`} className="mt-1 max-h-48 rounded-lg border border-rice-line" />}
                  </li>
                ))}
              </ol>
              {data.canSelfFile && (
                <div className="mt-4 flex gap-2 print:hidden">
                  <Input
                    placeholder="FoSCoS reference no."
                    value={ref}
                    onChange={(e) => setRef(e.target.value)}
                  />
                  <Button size="sm" loading={busy} disabled={!ref.trim()} onClick={submitSelfFile}>
                    I&apos;ve filed it
                  </Button>
                </div>
              )}
              {data.foscosRefNumber && (
                <p className="mt-3 rounded-xl bg-rice px-3 py-2 text-xs">
                  FoSCoS reference: <strong>{data.foscosRefNumber}</strong>
                </p>
              )}
            </>
          )}
        </div>

        <p className="mt-6 border-t border-dashed border-rice-line pt-3 text-[11px] leading-relaxed text-ink-faint">
          This is a prefilled summary to speed up filing — {data.platform.name} does not submit
          applications to any government system on your behalf through an API; FoSCoS has no public
          submission API for third parties. File this by hand yourself, or — for a small number of
          legacy pilot applications — PadosiPlate&apos;s back office does so manually on your behalf.
          Confirm license category, required documents and fees on FoSCoS or with your CA before
          relying on this document.
        </p>
      </Card>
    </div>
  );
}
