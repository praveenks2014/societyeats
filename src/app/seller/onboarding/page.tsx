'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Input, Skeleton, Textarea } from '@/components/ui';
import { FoodImage } from '@/components/food-image';
import { useToast } from '@/components/providers';

const CUISINES = ['Biryani', 'Tiffins', 'North Indian', 'South Indian', 'Jain Thali', 'Bengali Sweets', 'Desserts', 'Snacks', 'Healthy bowls', 'Other'];
const DAYS = [
  ['mon', 'Mon'], ['tue', 'Tue'], ['wed', 'Wed'], ['thu', 'Thu'], ['fri', 'Fri'], ['sat', 'Sat'], ['sun', 'Sun'],
] as const;
const MARKS = [
  ['veg', 'Vegetarian only'], ['veg_egg', 'Vegetarian + egg'], ['non_veg', 'Non-vegetarian'],
] as const;

type Profile = {
  kitchenName: string; legalName: string | null; displayName: string | null; languages: string[]; tower: string | null;
  cuisines: string[]; foodMark: string; cookingDays: string[]; cookingHours: string | null; maxOrdersPerDay: number; minOrderPaise: number;
  offersSelfPickup: boolean; offersSellerDelivery: boolean; deliveryRadiusKm: number; pickupInstructions: string | null; photos: string[];
  hygiene: Record<string, string>; hygieneItems: { key: string; label: string }[]; panMasked: string | null; panNameOnCard: string | null; gstin: string | null;
  agreementVersion: string | null; currentAgreementVersion: string; memberOk: boolean; minPhotos: number; maxPhotos: number; upiVerifyStatus: string;
};
type Checklist = { items: { key: string; label: string; done: boolean; href: string; hint?: string }[]; requestReady: boolean; requiredCount: number; state: string; reviewNote: string | null; live: boolean };

export default function SellerOnboarding() {
  const [p, setP] = useState<Profile | null>(null);
  const [list, setList] = useState<Checklist | null>(null);
  const toast = useToast();

  const loadList = useCallback(() => {
    fetch('/api/seller/listing-request').then((r) => r.json()).then(setList).catch(() => {});
  }, []);
  useEffect(() => {
    fetch('/api/seller/profile').then((r) => r.json()).then(setP).catch(() => {});
    loadList();
  }, [loadList]);

  async function save(step: string, data: unknown, okMsg = 'Saved ✅'): Promise<boolean> {
    const res = await fetch('/api/seller/profile', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ step, data }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(d.error || 'Could not save', 'err');
      return false;
    }
    setP(d);
    toast(okMsg);
    loadList();
    return true;
  }

  if (!p || !list) return <Skeleton className="mx-auto h-64 w-full max-w-2xl" />;
  const done = (key: string) => list.items.find((i) => i.key === key)?.done ?? false;

  return (
    <div className="mx-auto max-w-2xl pb-16">
      <h1 className="text-2xl font-bold">Set up your kitchen</h1>
      <p className="mt-1 text-sm text-ink-soft">Each step saves on its own — you can stop and come back any time.</p>

      <Card className="mt-5 p-4" data-testid="wizard-progress">
        <div className="eyebrow mb-2">{list.items.slice(0, list.requiredCount).filter((i) => i.done).length}/{list.requiredCount} STEPS DONE</div>
        <ol className="grid gap-1 sm:grid-cols-2">
          {list.items.slice(0, list.requiredCount).map((i) => (
            <li key={i.key}>
              <Link href={i.href} className="flex min-h-[44px] items-center gap-2 rounded-xl px-2 text-sm hover:bg-rice">
                <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i.done ? 'bg-leaf text-white' : 'border-2 border-rice-line text-ink-faint'}`} aria-hidden>{i.done ? '✓' : ''}</span>
                <span className={i.done ? 'text-ink-soft' : 'font-medium'}>{i.label}</span>
              </Link>
            </li>
          ))}
        </ol>
      </Card>

      <AboutStep p={p} done={done('about')} save={save} />
      <KitchenStep p={p} done={done('kitchen')} save={save} />
      <HygieneStep p={p} done={done('hygiene')} save={save} />
      <Card className="mt-5 p-4" id="fssai">
        <div className="flex items-center justify-between"><div className="eyebrow">FSSAI</div>{done('fssai') ? <Badge tone="green">Started</Badge> : <Badge tone="amber">To do</Badge>}</div>
        <p className="mt-2 text-sm text-ink-soft">Already registered? Enter your 14-digit number and certificate. New to FSSAI? Our guide helps you fill Form A yourself on the official FoSCoS site. PadosiPlate never files for you and never charges for it.</p>
        <Link href="/seller/compliance"><Button variant="secondary" className="mt-3">Open the FSSAI guide</Button></Link>
      </Card>
      <TaxStep p={p} done={done('tax')} save={save} />
      <Card className="mt-5 p-4" id="upi">
        <div className="flex items-center justify-between"><div className="eyebrow">UPI ID · ₹1 CHECK</div>{done('upi') ? <Badge tone="green">Verified</Badge> : <Badge tone="amber">To do</Badge>}</div>
        <p className="mt-2 text-sm text-ink-soft">Buyers pay you at their door on this UPI ID, so we confirm it is really yours with a ₹1 payment, refunded to you.</p>
        <Link href="/seller/payment-details"><Button variant="secondary" className="mt-3">Verify my UPI ID</Button></Link>
      </Card>
      <AgreementStep p={p} done={done('agreement')} save={save} />
      <Card className="mt-5 p-4" id="dishes">
        <div className="flex items-center justify-between"><div className="eyebrow">FIRST DISH</div>{done('dishes') ? <Badge tone="green">Added</Badge> : <Badge tone="amber">To do</Badge>}</div>
        <Link href="/seller/listings"><Button variant="secondary" className="mt-3">Add a dish</Button></Link>
      </Card>

      <SubmitCard list={list} onDone={loadList} />
    </div>
  );
}

type SaveFn = (step: string, data: unknown, msg?: string) => Promise<boolean>;

function StepHead({ id, title, done }: { id: string; title: string; done: boolean }) {
  return (
    <div id={id} className="flex items-center justify-between">
      <div className="eyebrow">{title}</div>
      {done ? <Badge tone="green">Done</Badge> : <Badge tone="amber">To do</Badge>}
    </div>
  );
}

function AboutStep({ p, done, save }: { p: Profile; done: boolean; save: SaveFn }) {
  const [legalName, setLegalName] = useState(p.legalName ?? '');
  const [displayName, setDisplayName] = useState(p.displayName ?? '');
  const [kitchenName, setKitchenName] = useState(p.kitchenName);
  const [tower, setTower] = useState(p.tower ?? '');
  const [flat, setFlat] = useState('');
  const [languages, setLanguages] = useState(p.languages.join(', '));
  const [busy, setBusy] = useState(false);
  return (
    <Card className="mt-5 p-4">
      <StepHead id="about" title="ABOUT YOU" done={done} />
      {!p.memberOk && <p className="mt-2 rounded-xl bg-chili-tint px-3 py-2 text-sm text-chili-dark" role="alert">You need to be an approved member of a pilot society to sell. Join through your society&apos;s invite link.</p>}
      <div className="mt-3 space-y-3">
        <Field label="Legal name (as on your PAN)"><Input value={legalName} onChange={(e) => setLegalName(e.target.value)} data-testid="legal-name" /></Field>
        <Field label="Name buyers see"><Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} data-testid="display-name" /></Field>
        <Field label="Kitchen name"><Input value={kitchenName} onChange={(e) => setKitchenName(e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Tower / block"><Input value={tower} onChange={(e) => setTower(e.target.value)} /></Field>
          <Field label="Flat no."><Input value={flat} onChange={(e) => setFlat(e.target.value)} /></Field>
        </div>
        <Field label="Languages you speak (comma separated)"><Input value={languages} onChange={(e) => setLanguages(e.target.value)} placeholder="Telugu, Hindi, English" /></Field>
        <Button loading={busy} onClick={async () => { setBusy(true); await save('about', { legalName, displayName, kitchenName, tower, flat, languages: languages.split(',').map((x) => x.trim()).filter(Boolean) }); setBusy(false); }} data-testid="save-about">Save</Button>
      </div>
    </Card>
  );
}

function KitchenStep({ p, done, save }: { p: Profile; done: boolean; save: SaveFn }) {
  const [cuisines, setCuisines] = useState<string[]>(p.cuisines);
  const [foodMark, setFoodMark] = useState(p.foodMark);
  const [days, setDays] = useState<string[]>(p.cookingDays);
  const [hours, setHours] = useState(p.cookingHours ?? '');
  const [maxOrders, setMaxOrders] = useState(String(p.maxOrdersPerDay));
  const [minOrder, setMinOrder] = useState(String(p.minOrderPaise / 100));
  const [pickup, setPickup] = useState(p.offersSelfPickup);
  const [delivery, setDelivery] = useState(p.offersSellerDelivery);
  const [radius, setRadius] = useState(String(p.deliveryRadiusKm));
  const [instr, setInstr] = useState(p.pickupInstructions ?? '');
  const [photos, setPhotos] = useState<string[]>(p.photos);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const toggle = (arr: string[], v: string, set: (a: string[]) => void) => set(arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  async function upload(file: File) {
    setUploading(true);
    const fd = new FormData();
    fd.append('file', file);
    fd.append('purpose', 'kitchen');
    const res = await fetch('/api/uploads', { method: 'POST', body: fd });
    const d = await res.json().catch(() => ({}));
    setUploading(false);
    if (!res.ok) return toast(d.error || 'Upload failed', 'err');
    setPhotos((x) => [...x, d.url].slice(0, p.maxPhotos));
  }

  return (
    <Card className="mt-5 p-4">
      <StepHead id="kitchen" title="YOUR KITCHEN" done={done} />
      <div className="mt-3 space-y-4">
        <Field label="What do you cook?">
          <div className="flex flex-wrap gap-2">{CUISINES.map((c) => <Chip key={c} on={cuisines.includes(c)} onClick={() => toggle(cuisines, c, setCuisines)}>{c}</Chip>)}</div>
        </Field>
        <Field label="Food type">
          <div className="flex flex-wrap gap-2" role="radiogroup">{MARKS.map(([v, l]) => <Chip key={v} on={foodMark === v} onClick={() => setFoodMark(v)} radio>{l}</Chip>)}</div>
        </Field>
        <Field label="Days you cook">
          <div className="flex flex-wrap gap-2">{DAYS.map(([v, l]) => <Chip key={v} on={days.includes(v)} onClick={() => toggle(days, v, setDays)}>{l}</Chip>)}</div>
        </Field>
        <Field label="Typical cooking hours"><Input value={hours} onChange={(e) => setHours(e.target.value)} placeholder="e.g. 11am–2pm, 7pm–9pm" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Max orders per day"><Input inputMode="numeric" value={maxOrders} onChange={(e) => setMaxOrders(e.target.value.replace(/\D/g, ''))} /></Field>
          <Field label="Minimum order (₹)"><Input inputMode="numeric" value={minOrder} onChange={(e) => setMinOrder(e.target.value.replace(/\D/g, ''))} /></Field>
        </div>
        <Field label="Fulfilment">
          <div className="flex flex-wrap gap-2">
            <Chip on={delivery} onClick={() => setDelivery(!delivery)}>I deliver to the door</Chip>
            <Chip on={pickup} onClick={() => setPickup(!pickup)}>Buyer picks up</Chip>
          </div>
        </Field>
        {delivery && <Field label="Delivery radius (km)"><Input inputMode="decimal" value={radius} onChange={(e) => setRadius(e.target.value)} /></Field>}
        <Field label="Pickup instructions"><Textarea rows={2} value={instr} onChange={(e) => setInstr(e.target.value)} placeholder="Tower, gate, bell…" /></Field>
        <Field label={`Photos of your cooking area (${p.minPhotos}–${p.maxPhotos})`}>
          <div className="flex flex-wrap items-center gap-2">
            {photos.map((u) => (
              <div key={u} className="relative">
                <FoodImage src={u} alt="Kitchen" className="h-20 w-20 rounded-xl" />
                <button aria-label="Remove photo" className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-white text-xs shadow" onClick={() => setPhotos(photos.filter((x) => x !== u))}>✕</button>
              </div>
            ))}
            {photos.length < p.maxPhotos && (
              <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-rice-line text-2xl text-ink-faint">
                {uploading ? '…' : '+'}
                <input type="file" accept="image/*" className="sr-only" data-testid="kitchen-photo-input" aria-label="Add a kitchen photo" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
              </label>
            )}
          </div>
        </Field>
        <Button loading={busy} onClick={async () => {
          setBusy(true);
          await save('kitchen', { cuisines, foodMark, cookingDays: days, cookingHours: hours, maxOrdersPerDay: Number(maxOrders) || 1, minOrderPaise: (Number(minOrder) || 0) * 100, offersSelfPickup: pickup, offersSellerDelivery: delivery, deliveryRadiusKm: Number(radius) || 1, pickupInstructions: instr, photos });
          setBusy(false);
        }} data-testid="save-kitchen">Save</Button>
      </div>
    </Card>
  );
}

function HygieneStep({ p, done, save }: { p: Profile; done: boolean; save: SaveFn }) {
  const [on, setOn] = useState<string[]>(Object.keys(p.hygiene));
  const [busy, setBusy] = useState(false);
  return (
    <Card className="mt-5 p-4">
      <StepHead id="hygiene" title="FOOD-SAFETY DECLARATION" done={done} />
      <p className="mt-2 text-xs text-ink-soft">You are declaring these for yourself. PadosiPlate does not inspect kitchens. <Link href="/legal/food-safety" className="underline">Read the basic hygiene guide</Link>.</p>
      <div className="mt-3 space-y-1" data-testid="hygiene-list">
        {p.hygieneItems.map((i) => (
          <label key={i.key} className="flex min-h-[44px] items-start gap-3 rounded-xl px-2 py-2 text-sm hover:bg-rice">
            <input type="checkbox" className="mt-0.5 h-5 w-5 accent-leaf" checked={on.includes(i.key)} onChange={() => setOn(on.includes(i.key) ? on.filter((x) => x !== i.key) : [...on, i.key])} />
            <span>{i.label}</span>
          </label>
        ))}
      </div>
      <Button className="mt-3" loading={busy} disabled={on.length === 0} onClick={async () => { setBusy(true); await save('hygiene', { declared: on }); setBusy(false); }} data-testid="save-hygiene">Save declaration</Button>
    </Card>
  );
}

function TaxStep({ p, done, save }: { p: Profile; done: boolean; save: SaveFn }) {
  const [pan, setPan] = useState('');
  const [gstin, setGstin] = useState(p.gstin ?? '');
  const [busy, setBusy] = useState(false);
  return (
    <Card className="mt-5 p-4">
      <StepHead id="tax" title="PAN (TAX IDENTITY)" done={done} />
      <p className="mt-2 text-xs text-ink-soft">Under the Income-tax Act, platforms report sellers&apos; sales and may need to deduct 0.1% TDS above ₹5 lakh a year. Sellers below that who give a PAN are exempt. We store your PAN encrypted, show it masked, and never ask for Aadhaar.</p>
      {p.panMasked && <p className="mt-2 text-sm" data-testid="pan-masked">On file: <strong>{p.panMasked}</strong></p>}
      <div className="mt-3 space-y-3">
        <Field label={p.panMasked ? 'Replace PAN' : 'PAN'}><Input value={pan} onChange={(e) => setPan(e.target.value.toUpperCase())} maxLength={10} placeholder="ABCDE1234F" autoCapitalize="characters" data-testid="pan-input" /></Field>
        <Field label="GSTIN (optional — most home cooks do not have one)"><Input value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} maxLength={15} /></Field>
        <Button loading={busy} disabled={pan.length !== 10} onClick={async () => { setBusy(true); const ok = await save('tax', { pan, gstin }); if (ok) setPan(''); setBusy(false); }} data-testid="save-tax">Save PAN</Button>
      </div>
    </Card>
  );
}

function AgreementStep({ p, done, save }: { p: Profile; done: boolean; save: SaveFn }) {
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  return (
    <Card className="mt-5 p-4">
      <StepHead id="agreement" title="KITCHEN AGREEMENT" done={done} />
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-soft">
        <li>My dish descriptions and photos are accurate, and food is freshly prepared in my own kitchen.</li>
        <li>I hold, or am applying for, FSSAI registration.</li>
        <li>I will honour cancellations and refunds under PadosiPlate&apos;s rules.</li>
        <li>I am responsible for my own taxes. I accept strikes and suspension rules.</li>
      </ul>
      <p className="mt-2 text-xs text-ink-faint">Draft, pending lawyer review. <Link href="/legal/kitchen-terms" className="underline">Read the full Kitchen Terms</Link>.</p>
      {done ? <p className="mt-2 text-sm font-semibold text-leaf">✅ Accepted ({p.agreementVersion})</p> : (
        <>
          <label className="mt-3 flex min-h-[44px] items-start gap-3 text-sm"><input type="checkbox" className="mt-0.5 h-5 w-5 accent-leaf" checked={ok} onChange={(e) => setOk(e.target.checked)} data-testid="agree-box" /><span>I have read and accept the Kitchen Terms.</span></label>
          <Button className="mt-2" disabled={!ok} loading={busy} onClick={async () => { setBusy(true); await save('agreement', { accept: true, version: p.currentAgreementVersion }); setBusy(false); }} data-testid="save-agreement">Accept</Button>
        </>
      )}
    </Card>
  );
}

function SubmitCard({ list, onDone }: { list: Checklist; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  async function submit() {
    setBusy(true);
    const res = await fetch('/api/seller/listing-request', { method: 'POST' });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return toast(d.error || 'Could not submit', 'err');
    toast('Sent for review ✅');
    onDone();
  }
  const canSubmit = ['draft', 'changes_requested'].includes(list.state);
  return (
    <Card className="mt-5 p-4" data-testid="submit-card">
      <div className="eyebrow">SUBMIT FOR APPROVAL</div>
      {list.reviewNote && <p className="mt-2 rounded-xl bg-turmeric-tint px-3 py-2 text-sm" role="status"><strong>{list.state === 'rejected' ? 'Not approved: ' : 'Changes requested: '}</strong>{list.reviewNote}</p>}
      {list.state === 'submitted' && <p className="mt-2 text-sm text-ink-soft" role="status">✅ Under review: we usually respond within 48 hours.</p>}
      {list.state === 'approved' && <p className="mt-2 text-sm text-leaf" role="status">✅ Approved{list.live ? ' and live to your neighbours.' : '.'}</p>}
      {canSubmit && (
        <Button className="mt-3 w-full" size="lg" disabled={!list.requestReady} loading={busy} onClick={submit} data-testid="submit-listing-request">
          {list.state === 'changes_requested' ? 'Resubmit for review' : 'Submit for approval'}
        </Button>
      )}
    </Card>
  );
}

function Chip({ on, onClick, children, radio }: { on: boolean; onClick: () => void; children: React.ReactNode; radio?: boolean }) {
  return (
    <button type="button" role={radio ? 'radio' : 'checkbox'} aria-checked={on} data-testid={`chip-${String(children)}`} onClick={onClick} className={`min-h-[44px] rounded-pill border-2 px-4 text-sm font-medium transition-colors ${on ? 'border-leaf bg-leaf text-white' : 'border-rice-line bg-white text-ink-soft'}`}>
      {children}
    </button>
  );
}
