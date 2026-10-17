'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { Badge, Button, Card, Field, Input, Modal, Skeleton, Textarea } from '@/components/ui';
import { useToast } from '@/components/providers';

type Summary = {
  profile: {
    kitchenName: string;
    fssaiStatus: 'verified' | 'pending_application' | 'unverified' | 'awaiting_admin_check';
    fssaiNumber: string | null;
    fssaiExpiry: string | null;
    // FSSAI hardening v3 (DECISIONS.md #119+) — the "enter it anytime" card's own state.
    fssaiCertificateUrl: string | null;
    fssaiLicenseeName: string | null;
  };
  application: {
    id: number;
    status: string;
    licenseType: string;
    foscosRefNumber: string | null;
    timelineJson: { at: string; event: string }[] | null;
    createdAt: string;
    filingMode: 'facilitator' | 'self';
    sponsoredByPlatform: boolean;
  } | null;
  // FSSAI hardening v3 (DECISIONS.md #119+): replaces the deleted
  // fssaiPendingMaxDays grace-window countdown — see src/lib/fssai/gate.ts.
  fssaiDeemedGrant: {
    thresholdDays: number;
    daysElapsed: number;
    daysRemaining: number | null;
    eligible: boolean;
  } | null;
};

const APP_STEPS: Record<string, string> = {
  draft: 'Ready for you to file on FoSCoS',
  submitted_to_backoffice: 'Queued for filing',
  filed_on_foscos: 'Filed on FoSCoS',
  granted: 'License granted 🎉',
  rejected: 'Rejected — contact support',
  // FSSAI hardening v3 (DECISIONS.md #119+): the two ways FoSCoS can
  // interrupt the deemed-commencement window — see src/lib/fssai/gate.ts.
  inspection_ordered: 'FoSCoS ordered an inspection — contact support',
  inadequacy_notice: 'FoSCoS issued an inadequacy notice — contact support',
};

export default function CompliancePage() {
  const [data, setData] = useState<Summary | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const toast = useToast();
  const router = useRouter();

  function load() {
    fetch('/api/seller/summary')
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }
  useEffect(load, []);

  if (!data) return <Skeleton className="mx-auto h-64 w-full max-w-2xl" />;
  const { profile, application, fssaiDeemedGrant } = data;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">FSSAI & Compliance</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Every food business in India needs an FSSAI license. PadosiPlate shows your license (or
        application status) on every dish — it&apos;s what makes neighbours trust home kitchens.
      </p>

      {profile.fssaiStatus === 'verified' && (
        <Card className="mt-5 border-leaf bg-leaf-tint/60 p-5">
          <Badge tone="green">FSSAI Verified ✅</Badge>
          <div className="mt-2 font-display text-lg font-bold">License {profile.fssaiNumber}</div>
          {profile.fssaiExpiry && (
            <p className="text-sm text-ink-soft">Valid till {profile.fssaiExpiry}. We&apos;ll nudge you 60 days before renewal.</p>
          )}
        </Card>
      )}

      {/* FSSAI hardening v3 (DECISIONS.md #119+) — item 2: persistent whenever
          fssaiStatus != 'verified', including while an application is pending. */}
      {profile.fssaiStatus !== 'verified' && <EnterLicenseCard profile={profile} onDone={load} />}

      {profile.fssaiStatus === 'pending_application' && application && (
        <Card className="mt-5 p-5">
          <Badge tone="amber">FSSAI Pending</Badge>
          <div className="mt-2 font-display text-lg font-bold">
            {application.licenseType === 'state' ? 'State License' : 'Basic Registration'} application
          </div>
          {fssaiDeemedGrant && (
            <p className="mt-1 text-sm text-ink-soft">
              {fssaiDeemedGrant.eligible ? (
                <>
                  FoSCoS hasn&apos;t responded to your filing in over <strong>{fssaiDeemedGrant.thresholdDays} days</strong> —
                  under FSSAI&apos;s regulation, you may be able to go live now even without a formal
                  grant yet. The moment FoSCoS actually issues your license, enter the number above so
                  we can show your verified badge.
                </>
              ) : (
                <>
                  <strong>{fssaiDeemedGrant.daysRemaining} more days</strong> until this filing is old
                  enough to be deemed eligible under the regulation if FoSCoS still hasn&apos;t responded
                  by then (an inspection order, inadequacy notice or rejection would reset this). FoSCoS
                  has no status-tracking API, so this is reference-number and elapsed-time based — check{' '}
                  <a href="https://foscos.fssai.gov.in" target="_blank" rel="noreferrer" className="text-leaf underline">
                    foscos.fssai.gov.in
                  </a>{' '}
                  directly for the actual live status.
                </>
              )}
            </p>
          )}
          <div className="mt-4 space-y-3">
            {(application.timelineJson ?? []).map((t, i) => (
              <div key={i} className="flex gap-3 text-sm">
                <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-leaf" />
                <div>
                  <div className="font-medium">{t.event}</div>
                  <div className="text-xs text-ink-faint">
                    {new Date(t.at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </div>
                </div>
              </div>
            ))}
            <div className="flex gap-3 text-sm text-ink-faint">
              <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-rice-line" />
              <div>
                {APP_STEPS[application.status]} —{' '}
                {application.filingMode === 'facilitator'
                  ? "PadosiPlate's back office files this on FoSCoS and tracks it to grant."
                  : "you're filing this yourself — PadosiPlate tracks it to grant once you share your FoSCoS reference."}
              </div>
            </div>
          </div>
          {application.foscosRefNumber && (
            <p className="mt-3 rounded-xl bg-rice px-3 py-2 text-xs">
              FoSCoS reference: <strong>{application.foscosRefNumber}</strong>
            </p>
          )}
          <Link
            href={`/fssai/${application.id}/summary`}
            className="mt-3 inline-block text-sm font-semibold text-leaf underline"
          >
            {application.filingMode === 'self'
              ? 'View your application summary & FoSCoS walkthrough →'
              : 'View your application summary →'}
          </Link>
        </Card>
      )}

      {profile.fssaiStatus === 'awaiting_admin_check' && (
        <Card className="mt-5 p-5">
          <Badge tone="amber">Verification in progress</Badge>
          <div className="mt-2 font-display text-lg font-bold">License {profile.fssaiNumber} — under review</div>
          <p className="mt-1 text-sm text-ink-soft">
            {profile.fssaiLicenseeName
              ? `We found a match for "${profile.fssaiLicenseeName}" but couldn't automatically confirm it's yours — a PadosiPlate admin checks it by hand, usually within a day.`
              : "We couldn't automatically verify this number — a PadosiPlate admin checks it by hand, usually within a day."}
          </p>
          {profile.fssaiCertificateUrl && (
            <a
              href={profile.fssaiCertificateUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-block text-xs font-semibold text-leaf underline"
            >
              📎 View your uploaded certificate
            </a>
          )}
        </Card>
      )}

      {profile.fssaiStatus === 'unverified' && (
        <Card className="mt-5 flex flex-col p-5">
          <div className="text-2xl">🧭</div>
          <h2 className="mt-2 font-display text-lg font-bold">Get me a license</h2>
          <p className="mt-1 flex-1 text-sm text-ink-soft">
            No license yet? Answer a few questions, upload your documents, and get a prefilled
            application summary and step-by-step FoSCoS walkthrough — you file it yourself, at your
            own pace. You can start selling with an amber "FSSAI Pending" badge meanwhile.
          </p>
          <Button className="mt-4" onClick={() => setWizardOpen(true)}>
            Start guided application
          </Button>
        </Card>
      )}

      <Card className="mt-6 p-4 text-xs leading-relaxed text-ink-faint">
        <strong>How this works (no shortcuts):</strong> FSSAI&apos;s FoSCoS portal has no public API
        for submitting applications — anyone claiming instant government filing is bluffing. PadosiPlate
        verifies existing licenses instantly via a verification partner. For a new application,
        PadosiPlate gives you a prefilled summary and document bundle to file yourself on FoSCoS. Most
        home kitchens qualify for <strong>Basic Registration</strong> (turnover up to ₹1.5 crore,
        effective 1 April 2026) — but some categories require a <strong>State License</strong>{' '}
        regardless of turnover. Confirm your exact Kind of Business on FoSCoS or with your CA before
        filing.
      </Card>

      <FssaiWizard
        open={wizardOpen}
        kitchenName={profile.kitchenName}
        onClose={() => setWizardOpen(false)}
        onDone={(applicationId) => {
          setWizardOpen(false);
          router.push(`/fssai/${applicationId}/summary`);
          load();
        }}
      />
    </div>
  );
}

/**
 * FSSAI hardening v3 (DECISIONS.md #119+) — item 2's "Got your license?
 * Enter it here" card. Persistent whenever fssaiStatus != 'verified',
 * including while an application is pending (the two are entirely
 * independent — see isFssaiEligibleToPublish's own doc comment).
 */
function EnterLicenseCard({
  profile,
  onDone,
}: {
  profile: Summary['profile'];
  onDone: () => void;
}) {
  const [number, setNumber] = useState('');
  const [certUrl, setCertUrl] = useState('');
  const [certName, setCertName] = useState('');
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const toast = useToast();

  async function uploadCert(file: File) {
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('purpose', 'fssai_doc');
    const res = await fetch('/api/uploads', { method: 'POST', body: fd });
    const d = await res.json();
    setUploading(false);
    if (!res.ok) {
      toast(d.error || 'Upload failed', 'err');
      return;
    }
    setCertUrl(d.url);
    setCertName(file.name);
  }

  async function submit() {
    setBusy(true);
    const res = await fetch('/api/fssai/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ licenseNumber: number, certificateUrl: certUrl }),
    });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) {
      toast(d.error || 'Could not submit', 'err');
      return;
    }
    if (d.status === 'verified') {
      toast(`Verified! Holder: ${d.verification.holderName} ✅`);
    } else {
      toast('Submitted — a PadosiPlate admin will confirm it shortly.');
    }
    setNumber('');
    setCertUrl('');
    setCertName('');
    onDone();
  }

  return (
    <Card className="mt-5 p-5">
      <div className="text-2xl">🪪</div>
      <h2 className="mt-2 font-display text-lg font-bold">Got your license? Enter it here</h2>
      <p className="mt-1 text-sm text-ink-soft">
        {profile.fssaiStatus === 'awaiting_admin_check'
          ? "Need to correct the number or certificate you already entered? Submit again — it replaces what's under review."
          : 'Already have an FSSAI license — from an earlier application, or one you filed yourself on FoSCoS? Enter the number and upload your certificate. PadosiPlate checks it automatically, or a PadosiPlate admin confirms it by hand within a day.'}
      </p>
      <div className="mt-3 space-y-2.5">
        <Input
          inputMode="numeric"
          maxLength={14}
          placeholder="14-digit license number"
          value={number}
          onChange={(e) => setNumber(e.target.value.replace(/\D/g, ''))}
        />
        <div className="flex items-center justify-between gap-3 rounded-2xl border border-rice-line bg-white px-3 py-2.5">
          <span className="min-w-0 flex-1 truncate text-sm">
            {certUrl ? `✅ ${certName}` : '📄 Certificate — PDF, JPG or PNG (required)'}
          </span>
          <input
            ref={fileRef}
            type="file"
            accept="application/pdf,image/jpeg,image/png"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && uploadCert(e.target.files[0])}
          />
          <Button size="sm" variant="secondary" loading={uploading} onClick={() => fileRef.current?.click()}>
            {certUrl ? 'Replace' : 'Upload'}
          </Button>
        </div>
      </div>
      <Button className="mt-3" loading={busy} disabled={number.length !== 14 || !certUrl} onClick={submit}>
        Submit for verification
      </Button>
    </Card>
  );
}

const DOCS = ['Photo ID (Aadhaar/PAN)', 'Address proof', 'Photo of your kitchen', 'Signed declaration'];

function FssaiWizard({
  open,
  kitchenName,
  onClose,
  onDone,
}: {
  open: boolean;
  kitchenName: string;
  onClose: () => void;
  onDone: (applicationId: number) => void;
}) {
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [applicantName, setApplicantName] = useState('');
  const [kitchenAddress, setKitchenAddress] = useState('');
  // FSSAI Basic Registration is the recommended default (turnover <= 1.5cr,
  // rule effective 1 Apr 2026) — never asserted as definitive, see the note
  // in step 3 below (DECISIONS.md #62+).
  const [licenseType, setLicenseType] = useState<'state' | 'registration'>('registration');
  const [docs, setDocs] = useState<Record<string, string>>({});
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null);
  const toast = useToast();

  async function uploadDoc(label: string, file: File) {
    setUploadingDoc(label);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('purpose', 'fssai_doc');
    const res = await fetch('/api/uploads', { method: 'POST', body: fd });
    const d = await res.json();
    setUploadingDoc(null);
    if (!res.ok) {
      toast(d.error || 'Upload failed', 'err');
      return;
    }
    setDocs((prev) => ({ ...prev, [label]: d.url }));
  }

  async function submit() {
    setBusy(true);
    const res = await fetch('/api/fssai/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        applicantName,
        kitchenAddress,
        licenseType,
        // FSSAI hardening v3 (DECISIONS.md #119+) — item 1: the wizard no
        // longer offers a facilitator choice; every new application is
        // self-filed. The backend still fully supports 'facilitator' (an
        // existing back-office task can still be actioned on /admin/fssai)
        // — that code is kept, just no longer reachable from this UI.
        filingMode: 'self',
        documents: Object.entries(docs).map(([label, url]) => ({ label, url })),
      }),
    });
    const d = await res.json();
    setBusy(false);
    if (!res.ok) {
      toast(d.error || 'Could not submit', 'err');
      return;
    }
    // Reset for next time this modal opens.
    setStep(0);
    setApplicantName('');
    setKitchenAddress('');
    setLicenseType('registration');
    setDocs({});
    onDone(d.application.id);
  }

  const steps = [
    {
      title: '1 · Who is applying?',
      valid: applicantName.trim().length > 1,
      body: (
        <Field label="Applicant's full legal name" hint="As on your Aadhaar/PAN">
          <Input value={applicantName} onChange={(e) => setApplicantName(e.target.value)} />
        </Field>
      ),
    },
    {
      title: '2 · Where is the kitchen?',
      valid: kitchenAddress.trim().length > 8,
      body: (
        <Field label={`Full address of ${kitchenName}`} hint="Flat, society, area, city, PIN">
          <Textarea rows={3} value={kitchenAddress} onChange={(e) => setKitchenAddress(e.target.value)} />
        </Field>
      ),
    },
    {
      title: '3 · License type',
      valid: true,
      body: (
        <div className="space-y-3">
          <p className="rounded-xl bg-leaf-tint px-3 py-2.5 text-sm text-leaf-dark">
            💡 <strong>Our default recommendation: Basic Registration.</strong> Most home kitchens
            with turnover up to ₹1.5 crore qualify, under the rule effective 1 April 2026. Some
            categories require a State License regardless of turnover — confirm your exact Kind of
            Business on FoSCoS. Neither tier is definitive here — it&apos;s guidance, not a filed
            determination.
          </p>
          {(
            [
              ['registration', 'Basic Registration (recommended)', 'Turnover up to ₹1.5 crore — most home kitchens'],
              ['state', 'State License', 'Some categories require this regardless of turnover — check FoSCoS'],
            ] as const
          ).map(([value, label, hint]) => (
            <label key={value} className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-3 ${licenseType === value ? 'border-leaf bg-leaf-tint/40' : 'border-rice-line'}`}>
              <input
                type="radio"
                checked={licenseType === value}
                onChange={() => setLicenseType(value)}
                className="mt-1 accent-leaf"
              />
              <span>
                <span className="block text-sm font-semibold">{label}</span>
                <span className="block text-xs text-ink-faint">{hint}</span>
              </span>
            </label>
          ))}
        </div>
      ),
    },
    {
      title: '4 · Documents',
      valid: DOCS.every((d) => docs[d]),
      body: (
        <div className="space-y-2.5">
          {DOCS.map((label) => (
            <div key={label} className="flex items-center justify-between gap-3 rounded-2xl border border-rice-line bg-white px-3 py-2.5">
              <span className="text-sm">
                {docs[label] ? '✅' : '📄'} {label}
              </span>
              <input
                ref={(el) => {
                  fileRefs.current[label] = el;
                }}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(e) => e.target.files?.[0] && uploadDoc(label, e.target.files[0])}
              />
              <Button
                size="sm"
                variant="secondary"
                loading={uploadingDoc === label}
                onClick={() => fileRefs.current[label]?.click()}
              >
                {docs[label] ? 'Replace' : 'Upload'}
              </Button>
            </div>
          ))}
        </div>
      ),
    },
    {
      // FSSAI hardening v3 (DECISIONS.md #119+) — item 1: no more "File it
      // for me" choice here, just a confirmation of what happens next.
      title: '5 · You file this yourself',
      valid: true,
      body: (
        <div className="rounded-2xl border border-leaf bg-leaf-tint/40 p-4">
          <span className="block text-sm font-semibold">
            You&apos;ll file this on FoSCoS yourself — we prefill everything and walk you through it.
          </span>
          <p className="mt-1.5 text-xs text-ink-faint">
            After you submit, PadosiPlate generates a prefilled application summary, your document bundle,
            and a step-by-step FoSCoS walkthrough. You file at your own pace and enter the reference
            number here once it's done — PadosiPlate tracks it to grant from there.
          </p>
        </div>
      ),
    },
    {
      title: '6 · Review & submit',
      valid: true,
      body: (
        <div className="space-y-2 text-sm">
          <Row k="Applicant" v={applicantName} />
          <Row k="Kitchen" v={kitchenAddress} />
          <Row k="License type" v={licenseType === 'state' ? 'State License' : 'Basic Registration'} />
          <Row k="Documents" v={`${Object.keys(docs).length}/${DOCS.length} uploaded`} />
          <Row k="Filing" v="You (self-filed)" />
          <p className="mt-3 rounded-xl bg-turmeric-tint px-3 py-2.5 text-xs text-ink-soft">
            You&apos;ll get a prefilled summary and a step-by-step FoSCoS walkthrough to file this
            yourself. Meanwhile your dishes can go live with an amber "FSSAI Pending" badge.
          </p>
        </div>
      ),
    },
  ];

  const current = steps[step];

  // Modal scroll fix (DECISIONS.md #119+): Back/Continue are passed as
  // Modal's `footer` prop so they're pinned outside the scrollable step
  // body — reachable at any viewport height, not just tall ones — instead
  // of scrolling away with the (sometimes long, e.g. the documents step)
  // step content.
  return (
    <Modal
      open={open}
      onClose={onClose}
      sheet
      title="FSSAI application"
      footer={
        <div className="flex gap-3">
          {step > 0 && (
            <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>
              ← Back
            </Button>
          )}
          {step < steps.length - 1 ? (
            <Button className="flex-1" disabled={!current.valid} onClick={() => setStep((s) => s + 1)}>
              Continue
            </Button>
          ) : (
            <Button className="flex-1" loading={busy} onClick={submit}>
              Submit application
            </Button>
          )}
        </div>
      }
    >
      <div className="mb-4 flex gap-1.5">
        {steps.map((_, i) => (
          <span key={i} className={`h-1.5 flex-1 rounded-pill ${i <= step ? 'bg-leaf' : 'bg-rice-line'}`} />
        ))}
      </div>
      <h4 className="mb-3 font-display text-base font-bold">{current.title}</h4>
      {current.body}
    </Modal>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between gap-4">
      <span className="shrink-0 text-ink-faint">{k}</span>
      <span className="text-right font-medium">{v}</span>
    </div>
  );
}
