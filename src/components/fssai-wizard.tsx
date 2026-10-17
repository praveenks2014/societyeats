'use client';

import { useRef, useState } from 'react';
import { AadhaarMask } from '@/components/aadhaar-mask';
import { Button, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { useToast } from '@/components/providers';
import { formatINR } from '@/lib/money';
import {
  DECLARATIONS, FOOD_CATEGORIES, ID_TYPES, MAX_YEARS, MIN_YEARS, PERSISTENT_NOTICE, SALES_LABELS, WATER_SOURCES,
  basicRegistrationFeePaise, checkEligibility, type IdType, type SalesBand,
} from '@/lib/fssai/assistant';

const DOC_SLOTS = [
  { key: 'id', label: 'Photo ID', purpose: 'id_proof' },
  { key: 'address', label: 'Address proof', purpose: 'address_proof' },
  { key: 'kitchen', label: 'Photo of your kitchen', purpose: 'fssai_doc' },
  { key: 'photo', label: 'Passport-size photo', purpose: 'fssai_doc' },
] as const;

/** FSSAI Basic Registration assistant: eligibility first, then Form A sections. The seller files the application themselves on FoSCoS. */
export function FssaiWizard({
  open,
  kitchenName,
  feePerYearRupees,
  onClose,
  onDone,
  onManualLicence,
}: {
  open: boolean;
  kitchenName: string;
  feePerYearRupees: number;
  onClose: () => void;
  onDone: (applicationId: number) => void;
  onManualLicence: () => void;
}) {
  const toast = useToast();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [sales, setSales] = useState<SalesBand | ''>('');
  const [home, setHome] = useState<boolean | null>(null);
  const [telangana, setTelangana] = useState<boolean | null>(null);
  const [applicantName, setApplicantName] = useState('');
  const [idType, setIdType] = useState<IdType>('aadhaar');
  const [kitchenAddress, setKitchenAddress] = useState('');
  const [categories, setCategories] = useState<string[]>([]);
  const [years, setYears] = useState(1);
  const [water, setWater] = useState<string>(WATER_SOURCES[0]);
  const [docs, setDocs] = useState<Record<string, string>>({});
  const [uploading, setUploading] = useState<string | null>(null);
  const [maskFor, setMaskFor] = useState<{ key: string; file: File } | null>(null);
  const [decl, setDecl] = useState<string[]>([]);
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const eligibility = sales && home !== null && telangana !== null ? checkEligibility({ sales, homeKitchen: home, onlyTelangana: telangana }) : null;
  const fee = basicRegistrationFeePaise(years, feePerYearRupees);

  async function checkRoute() {
    if (!eligibility || !sales) return;
    const res = await fetch('/api/fssai/eligibility', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sales, homeKitchen: home, onlyTelangana: telangana }) });
    if (!res.ok) return toast('Could not check — try again', 'err');
    if (eligibility.route === 'form_a') setStep(1);
  }

  async function upload(slot: (typeof DOC_SLOTS)[number], file: File, masked = false) {
    setUploading(slot.key);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('purpose', slot.purpose);
    if (slot.key === 'id') {
      fd.append('idType', idType);
      if (masked) fd.append('aadhaarMasked', 'true');
    }
    const res = await fetch('/api/uploads', { method: 'POST', body: fd });
    const d = await res.json().catch(() => ({}));
    setUploading(null);
    if (!res.ok) return toast(d.error || 'Upload failed', 'err');
    setDocs((p) => ({ ...p, [slot.key]: d.url }));
  }

  function pick(slot: (typeof DOC_SLOTS)[number], file: File) {
    if (slot.key === 'id' && idType === 'aadhaar') setMaskFor({ key: slot.key, file });
    else upload(slot, file);
  }

  async function submit() {
    if (!sales || home === null || telangana === null) return;
    setBusy(true);
    const res = await fetch('/api/fssai/applications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        applicantName,
        kitchenAddress,
        licenseType: 'registration',
        filingMode: 'self',
        documents: DOC_SLOTS.map((s) => ({ label: s.label, url: docs[s.key] })),
        formA: { eligibility: { sales, homeKitchen: home, onlyTelangana: telangana }, foodCategories: categories, years, waterSource: water, idType, declarations: decl },
      }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(d.error || 'Could not submit', 'err');
    setStep(0);
    onDone(d.application.id);
  }

  const yn = (label: string, value: boolean | null, set: (v: boolean) => void, test: string) => (
    <fieldset className="rounded-2xl border border-rice-line p-3">
      <legend className="px-1 text-sm font-semibold">{label}</legend>
      <div className="mt-1 flex gap-2">
        {[true, false].map((v) => (
          <label key={String(v)} className={`flex min-h-[44px] flex-1 cursor-pointer items-center justify-center rounded-xl border text-sm font-medium ${value === v ? 'border-leaf bg-leaf-tint/50' : 'border-rice-line'}`}>
            <input type="radio" className="sr-only" name={test} checked={value === v} onChange={() => set(v)} data-testid={`${test}-${v ? 'yes' : 'no'}`} />
            {v ? 'Yes' : 'No'}
          </label>
        ))}
      </div>
    </fieldset>
  );

  const steps = [
    {
      title: 'Which form do you need?',
      valid: !!eligibility && eligibility.route === 'form_a',
      body: (
        <div className="space-y-3">
          <Field label="Annual food sales">
            <Select value={sales} onChange={(e) => setSales(e.target.value as SalesBand)} data-testid="sales">
              <option value="">Select…</option>
              {(Object.keys(SALES_LABELS) as SalesBand[]).map((k) => <option key={k} value={k}>{SALES_LABELS[k]}</option>)}
            </Select>
          </Field>
          {yn('Is this a home kitchen?', home, setHome, 'home')}
          {yn('Do you sell only within Telangana?', telangana, setTelangana, 'telangana')}
          {eligibility && (
            <div className={`rounded-2xl px-4 py-3 text-sm ${eligibility.route === 'form_a' ? 'bg-leaf-tint text-leaf-dark' : 'bg-turmeric-tint text-ink-soft'}`} role="status" data-testid="eligibility-result">
              <div className="font-semibold">{eligibility.title}</div>
              <p className="mt-1">{eligibility.message}</p>
              {eligibility.route === 'licence' && (
                <Button className="mt-2" size="sm" variant="secondary" onClick={() => { onClose(); onManualLicence(); }}>
                  I have a licence — enter it
                </Button>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      title: 'Form A · Section 1 — Applicant',
      valid: applicantName.trim().length > 1,
      body: (
        <div className="space-y-3">
          <Field label="Applicant’s full legal name" hint="As on your ID proof"><Input value={applicantName} onChange={(e) => setApplicantName(e.target.value)} data-testid="applicant" /></Field>
          <Field label="ID proof you will use">
            <Select value={idType} onChange={(e) => { setIdType(e.target.value as IdType); setDocs((d) => { const n = { ...d }; delete n.id; return n; }); }}>
              {ID_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </Select>
          </Field>
        </div>
      ),
    },
    {
      title: 'Form A · Section 2 — Premises',
      valid: kitchenAddress.trim().length > 8,
      body: <Field label={`Full address of ${kitchenName}`} hint="Flat, society, area, city, PIN"><Textarea rows={3} value={kitchenAddress} onChange={(e) => setKitchenAddress(e.target.value)} data-testid="address" /></Field>,
    },
    {
      title: 'Form A · Section 3 — Food categories',
      valid: categories.length > 0,
      body: (
        <div className="grid gap-2">
          {FOOD_CATEGORIES.map((c) => (
            <label key={c} className="flex min-h-[44px] cursor-pointer items-center gap-3 rounded-xl border border-rice-line px-3 text-sm">
              <input type="checkbox" className="h-5 w-5 accent-leaf" checked={categories.includes(c)} onChange={(e) => setCategories((p) => (e.target.checked ? [...p, c] : p.filter((x) => x !== c)))} />
              {c}
            </label>
          ))}
        </div>
      ),
    },
    {
      title: 'Form A · Sections 4–5 — Duration & water',
      valid: true,
      body: (
        <div className="space-y-3">
          <Field label="Registration period (years)" hint={`${formatINR(feePerYearRupees * 100)} per year, paid to FSSAI`}>
            <Select value={years} onChange={(e) => setYears(Number(e.target.value))} data-testid="years">
              {Array.from({ length: MAX_YEARS - MIN_YEARS + 1 }, (_, i) => MIN_YEARS + i).map((y) => <option key={y} value={y}>{y} year{y === 1 ? '' : 's'}</option>)}
            </Select>
          </Field>
          <div className="rounded-xl bg-rice px-3 py-2.5 text-sm" data-testid="fee">Government fee: <strong>{formatINR(fee)}</strong> <span className="text-ink-faint">(paid directly to FSSAI)</span></div>
          <Field label="Source of water"><Select value={water} onChange={(e) => setWater(e.target.value)}>{WATER_SOURCES.map((w) => <option key={w}>{w}</option>)}</Select></Field>
        </div>
      ),
    },
    {
      title: 'Form A · Section 6 — Documents',
      valid: DOC_SLOTS.every((s) => docs[s.key]),
      body: maskFor ? (
        <AadhaarMask
          file={maskFor.file}
          onCancel={() => setMaskFor(null)}
          onMasked={(f) => {
            const slot = DOC_SLOTS.find((s) => s.key === maskFor.key)!;
            setMaskFor(null);
            upload(slot, f, true);
          }}
        />
      ) : (
        <div className="space-y-2.5">
          <p className="text-xs text-ink-faint">ID and address documents are stored encrypted and deleted automatically after verification.</p>
          {DOC_SLOTS.map((s) => (
            <div key={s.key} className="flex items-center justify-between gap-3 rounded-2xl border border-rice-line bg-white px-3 py-2.5">
              <span className="text-sm">{docs[s.key] ? '✅' : '📄'} {s.label}{s.key === 'id' && idType === 'aadhaar' ? ' (masked)' : ''}</span>
              <input ref={(el) => { fileRefs.current[s.key] = el; }} type="file" accept="image/*" className="hidden" data-testid={`file-${s.key}`} onChange={(e) => e.target.files?.[0] && pick(s, e.target.files[0])} />
              <Button size="sm" variant="secondary" loading={uploading === s.key} onClick={() => fileRefs.current[s.key]?.click()}>{docs[s.key] ? 'Replace' : 'Upload'}</Button>
            </div>
          ))}
        </div>
      ),
    },
    {
      title: 'Form A · Section 7 — Declaration',
      valid: DECLARATIONS.every((d) => decl.includes(d)),
      body: (
        <div className="space-y-2">
          {DECLARATIONS.map((d, i) => (
            <label key={d} className="flex min-h-[44px] cursor-pointer items-start gap-3 rounded-xl border border-rice-line p-3 text-sm">
              <input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-leaf" checked={decl.includes(d)} onChange={(e) => setDecl((p) => (e.target.checked ? [...p, d] : p.filter((x) => x !== d)))} data-testid={`decl-${i}`} />
              {d}
            </label>
          ))}
        </div>
      ),
    },
    {
      title: 'Review & create your filing pack',
      valid: true,
      body: (
        <div className="space-y-2 text-sm">
          <Row k="Applicant" v={applicantName} />
          <Row k="Kitchen" v={kitchenAddress} />
          <Row k="Food categories" v={`${categories.length} selected`} />
          <Row k="Period" v={`${years} year${years === 1 ? '' : 's'} · ${formatINR(fee)} to FSSAI`} />
          <Row k="Documents" v={`${Object.keys(docs).length}/${DOC_SLOTS.length} uploaded`} />
          <p className="mt-3 rounded-xl bg-turmeric-tint px-3 py-2.5 text-xs text-ink-soft">{PERSISTENT_NOTICE}</p>
        </div>
      ),
    },
  ];
  const current = steps[step];
  const last = step === steps.length - 1;

  return (
    <Modal
      open={open}
      onClose={onClose}
      sheet
      title="FSSAI Basic Registration assistant"
      footer={
        <div className="space-y-2">
          <p className="text-[11px] leading-snug text-ink-faint">{PERSISTENT_NOTICE}</p>
          <div className="flex gap-3">
            {step > 0 && <Button variant="ghost" onClick={() => setStep((s) => s - 1)}>← Back</Button>}
            {last ? (
              <Button className="flex-1" loading={busy} onClick={submit} data-testid="wizard-submit">Create my filing pack</Button>
            ) : (
              <Button className="flex-1" disabled={!current.valid} onClick={() => (step === 0 ? checkRoute() : setStep((s) => s + 1))} data-testid="wizard-next">Continue</Button>
            )}
          </div>
        </div>
      }
    >
      <div className="mb-4 flex gap-1.5">{steps.map((_, i) => <span key={i} className={`h-1.5 flex-1 rounded-pill ${i <= step ? 'bg-leaf' : 'bg-rice-line'}`} />)}</div>
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
