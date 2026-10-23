import { beforeAll, describe, expect, test, vi } from 'vitest';
import sharp from 'sharp';
import { eq } from 'drizzle-orm';
import { call, jsonReq, loginAs } from '../helpers/http';
import { makeLiveKitchen, makeSociety, makeUser } from '../helpers/fixtures';
import { useTestDb } from '../helpers/db';
import * as s from '@/lib/db/schema';
import { DECLARATIONS, FOOD_CATEGORIES, basicRegistrationFeePaise, checkEligibility, validateFormA, buildFormASections } from '@/lib/fssai/assistant';
import { defaultAadhaarMask, maskRegion } from '@/lib/fssai/mask';

vi.mock('next/headers', () => import('../helpers/next-headers'));

let db: Awaited<ReturnType<typeof useTestDb>>;
let societyId: number;
beforeAll(async () => {
  process.env.LOCAL_UPLOAD_DIR = `${process.cwd()}/.data/test-uploads`;
  process.env.STORAGE_ADAPTER = 'local';
  db = await useTestDb();
  societyId = (await makeSociety(db)).id;
});

describe('eligibility routing', () => {
  test('under ₹12 lakh + home kitchen + only Telangana → Form A', () => {
    expect(checkEligibility({ sales: 'under_12l', homeKitchen: true, onlyTelangana: true })).toMatchObject({ route: 'form_a' });
  });
  test('everything else → a licence, with the right kind', () => {
    expect(checkEligibility({ sales: '12l_to_20cr', homeKitchen: true, onlyTelangana: true })).toMatchObject({ route: 'licence', kind: 'state' });
    expect(checkEligibility({ sales: 'above_20cr', homeKitchen: true, onlyTelangana: true })).toMatchObject({ route: 'licence', kind: 'central' });
    expect(checkEligibility({ sales: 'under_12l', homeKitchen: false, onlyTelangana: true })).toMatchObject({ route: 'licence', kind: 'state' });
    expect(checkEligibility({ sales: 'under_12l', homeKitchen: true, onlyTelangana: false })).toMatchObject({ route: 'licence', kind: 'central' });
  });
});

describe('fee by years', () => {
  test('₹100 × years from config, 1–5 only', () => {
    expect(basicRegistrationFeePaise(1, 100)).toBe(10000);
    expect(basicRegistrationFeePaise(5, 100)).toBe(50000);
    expect(basicRegistrationFeePaise(3, 150)).toBe(45000);
    expect(() => basicRegistrationFeePaise(0, 100)).toThrow();
    expect(() => basicRegistrationFeePaise(6, 100)).toThrow();
    expect(() => basicRegistrationFeePaise(1.5, 100)).toThrow();
  });
});

describe('Form A validation and pack', () => {
  const good = { eligibility: { sales: 'under_12l' as const, homeKitchen: true, onlyTelangana: true }, foodCategories: [FOOD_CATEGORIES[0]], years: 2, waterSource: 'Municipal supply', idType: 'pan' as const, declarations: [...DECLARATIONS] };
  test('accepts a complete answer set, rejects each gap', () => {
    expect(validateFormA(good)).toBeNull();
    expect(validateFormA({ ...good, foodCategories: [] })).toMatch(/category/i);
    expect(validateFormA({ ...good, foodCategories: ['Moon cheese'] })).toMatch(/Unknown/);
    expect(validateFormA({ ...good, years: 9 })).toMatch(/1–5/);
    expect(validateFormA({ ...good, waterSource: '' })).toMatch(/water/i);
    expect(validateFormA({ ...good, declarations: [DECLARATIONS[0]] })).toMatch(/declarations/i);
    expect(validateFormA({ ...good, eligibility: { sales: 'above_20cr', homeKitchen: true, onlyTelangana: true } })).toMatch(/Form A/);
  });
  test('filing pack is organised by Form A sections', () => {
    const sections = buildFormASections({ applicantName: 'A', phone: '9', email: null, kitchenName: 'K', kitchenAddress: 'Addr', form: { ...good, feeInPaise: 20000 }, documents: [{ label: 'Photo ID' }] });
    expect(sections.map((x) => x.title.split(' — ')[0])).toEqual(['Section 1', 'Section 2', 'Section 3', 'Section 4', 'Section 5', 'Section 6', 'Section 7']);
    expect(sections[3].rows.flat().join(' ')).toContain('₹200');
  });
});

describe('Aadhaar masking', () => {
  test('maskRegion destroys the pixels under the box and nothing else', () => {
    const w = 20, h = 10;
    const data = new Uint8ClampedArray(w * h * 4).fill(200);
    const n = maskRegion(data, w, h, { x: 2, y: 3, w: 8, h: 2 });
    expect(n).toBe(16);
    const px = (x: number, y: number) => Array.from(data.slice((y * w + x) * 4, (y * w + x) * 4 + 4));
    expect(px(2, 3)).toEqual([0, 0, 0, 255]);
    expect(px(9, 4)).toEqual([0, 0, 0, 255]);
    expect(px(10, 4)).toEqual([200, 200, 200, 200]);
    expect(px(2, 5)).toEqual([200, 200, 200, 200]);
  });
  test('the box is clamped to the image', () => {
    const data = new Uint8ClampedArray(4 * 4 * 4).fill(9);
    expect(maskRegion(data, 4, 4, { x: -5, y: -5, w: 100, h: 100 })).toBe(16);
    const r = defaultAadhaarMask(1000, 600);
    expect(r.w).toBeGreaterThan(400);
  });

  async function upload(fields: Record<string, string>, purpose = 'id_proof') {
    const { POST } = await import('@/app/api/uploads/route');
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#888' } }).png().toBuffer();
    const fd = new FormData();
    fd.append('file', new File([new Uint8Array(png)], 'id.png', { type: 'image/png' }));
    fd.append('purpose', purpose);
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    const req = new Request('http://localhost:3000/api/uploads', { method: 'POST', body: fd });
    const { NextRequest } = await import('next/server');
    return call(POST as never, new NextRequest(req) as never);
  }

  test('an Aadhaar upload is refused unless the browser tool vouches that it was masked', async () => {
    const seller = await makeUser(db, 'seller', { societyId });
    await loginAs(seller.id);
    expect((await upload({ idType: 'aadhaar' })).status).toBe(400);
    const ok = await upload({ idType: 'aadhaar', aadhaarMasked: 'true' });
    expect(ok.status).toBe(200);
    // a PAN card does not need masking
    expect((await upload({ idType: 'pan' })).status).toBe(200);
  });

  test('ID and address proofs are stored ENCRYPTED, privately, with a retention date; buyers cannot upload them', async () => {
    const seller = await makeUser(db, 'seller', { societyId });
    await loginAs(seller.id);
    const r = await upload({ idType: 'pan' }, 'address_proof');
    const key = (r.json.key as string);
    const [meta] = await db.select().from(s.files).where(eq(s.files.key, key));
    expect(meta).toMatchObject({ encrypted: true, visibility: 'private', purpose: 'address_proof' });
    expect(meta.deleteAfter).not.toBeNull();
    const { getStorage } = await import('@/lib/storage');
    const raw = (await (await getStorage()).get(key))!;
    expect(raw.subarray(0, 4).toString('hex')).not.toBe('89504e47'); // not a PNG on disk
    const buyer = await makeUser(db, 'buyer', { societyId });
    await loginAs(buyer.id);
    expect((await upload({}, 'id_proof')).status).toBe(403);
  });

  test('private documents are served only to the owner and admins; admin views are audit-logged', async () => {
    const { GET } = await import('@/app/api/files/[key]/route');
    const seller = await makeUser(db, 'seller', { societyId });
    await loginAs(seller.id);
    const key = (await upload({ idType: 'pan' }, 'id_proof')).json.key as string;
    const get = (k: string) => call(GET as never, jsonReq(`/api/files/${k}`, undefined, { method: 'GET' }) as never, { key: k });
    expect((await get(key)).status).toBe(200);
    const other = await makeUser(db, 'seller', { societyId });
    await loginAs(other.id);
    expect((await get(key)).status).toBe(403);
    const admin = await makeUser(db, 'admin');
    process.env.ADMIN_EMAILS = admin.email!;
    await loginAs(admin.id);
    expect((await get(key)).status).toBe(200);
    const audits = await db.select().from(s.auditLog).where(eq(s.auditLog.action, 'document.view'));
    expect(audits.some((a) => a.targetId === key && a.actorId === admin.id)).toBe(true);
  });
});

describe('assistant API + funnel', () => {
  const body = { applicantName: 'Lakshmi', kitchenAddress: '12 Gachibowli Hyderabad 500032', licenseType: 'registration', filingMode: 'self', documents: ['a', 'b', 'c', 'd'].map((x) => ({ label: x, url: `/api/files/${x}` })), formA: { eligibility: { sales: 'under_12l', homeKitchen: true, onlyTelangana: true }, foodCategories: [FOOD_CATEGORIES[1]], years: 3, waterSource: 'Municipal supply', idType: 'pan', declarations: [...DECLARATIONS] } };

  test('creating an application stores Form A, computes the fee server-side and records funnel stages', async () => {
    const { POST } = await import('@/app/api/fssai/applications/route');
    const seller = await makeUser(db, 'seller', { societyId });
    await db.insert(s.sellerProfiles).values({ userId: seller.id, kitchenName: 'K' });
    await loginAs(seller.id);
    const r = await call(POST, jsonReq('/api/fssai/applications', { ...body, formA: { ...body.formA, feeInPaise: 1 } }));
    expect(r.status).toBe(200);
    const [app] = await db.select().from(s.fssaiApplications).where(eq(s.fssaiApplications.sellerId, seller.id));
    expect(app.formAJson).toMatchObject({ years: 3, feeInPaise: 30000 }); // client-supplied fee ignored
    const stages = (await db.select().from(s.fssaiFunnelEvents).where(eq(s.fssaiFunnelEvents.sellerId, seller.id))).map((x) => x.stage).sort();
    expect(stages).toEqual(['details_complete', 'documents_ready', 'eligible', 'started']);
    // an ineligible answer set is refused on the server too
    const bad = await call(POST, jsonReq('/api/fssai/applications', { ...body, formA: { ...body.formA, eligibility: { sales: 'above_20cr', homeKitchen: true, onlyTelangana: true } } }));
    expect(bad.status).toBe(400);
  });

  test('funnel report counts per society', async () => {
    const { funnelReport } = await import('@/lib/fssai/funnel');
    const r = await funnelReport();
    expect(r.total.started).toBeGreaterThanOrEqual(1);
    expect(r.societies.length).toBeGreaterThanOrEqual(1);
  });
});

describe('expiry, reminders, retention', () => {
  test('an expired licence unpublishes the kitchen from the buyer feed until renewed', async () => {
    const { browseListings } = await import('@/lib/browse');
    const { seller, dish } = await makeLiveKitchen(db, { societyId });
    const titles = async () => (await browseListings({})).listings.map((l) => l.id);
    expect(await titles()).toContain(dish.id);
    await db.update(s.sellerProfiles).set({ fssaiExpiry: '2020-01-01' }).where(eq(s.sellerProfiles.userId, seller.id));
    expect(await titles()).not.toContain(dish.id);
    await db.update(s.sellerProfiles).set({ fssaiExpiry: '2099-01-01' }).where(eq(s.sellerProfiles.userId, seller.id));
    expect(await titles()).toContain(dish.id);
  });

  test('day-3 and day-6 reminders after filing, and 30-day expiry reminder — each sent once', async () => {
    const { runFssaiJobs } = await import('@/lib/fssai/jobs');
    const seller = await makeUser(db, 'seller', { societyId });
    await db.insert(s.sellerProfiles).values({ userId: seller.id, kitchenName: 'R', fssaiStatus: 'pending_application' });
    const filedAt = new Date('2026-03-01T06:00:00Z');
    await db.insert(s.fssaiApplications).values({ sellerId: seller.id, applicantName: 'R', kitchenAddress: 'x', status: 'filed_on_foscos', foscosRefNumber: 'REF1', filedAt, filingMode: 'self' });
    const day = (n: number) => new Date(filedAt.getTime() + n * 86_400_000 + 3600_000);
    expect((await runFssaiJobs(day(2))).day3).toBe(0);
    expect((await runFssaiJobs(day(3))).day3).toBe(1);
    expect((await runFssaiJobs(day(3))).day3).toBe(0); // deduped
    expect((await runFssaiJobs(day(6))).day6).toBe(1);
    const mails = await db.select().from(s.emailOutbox).where(eq(s.emailOutbox.userId, seller.id));
    expect(mails.length).toBe(2); // in-app AND email for each

    const k = await makeLiveKitchen(db, { societyId });
    await db.update(s.sellerProfiles).set({ fssaiExpiry: '2026-04-10' }).where(eq(s.sellerProfiles.userId, k.seller.id));
    expect((await runFssaiJobs(new Date('2026-03-01T06:00:00Z'))).expiry30).toBe(0);
    expect((await runFssaiJobs(new Date('2026-03-15T06:00:00Z'))).expiry30).toBe(1);
    expect((await runFssaiJobs(new Date('2026-03-16T06:00:00Z'))).expiry30).toBe(0);
    expect((await runFssaiJobs(new Date('2026-04-12T06:00:00Z'))).expired).toBe(1);
  });

  test('ID documents are deleted fssaiDocRetentionDays after verification and unlinked from the application', async () => {
    const { scheduleDocumentDeletion, purgeExpiredDocuments } = await import('@/lib/fssai/jobs');
    const { saveUpload } = await import('@/lib/storage/files');
    const seller = await makeUser(db, 'seller', { societyId });
    const png = await sharp({ create: { width: 10, height: 10, channels: 3, background: '#111' } }).png().toBuffer();
    const idf = await saveUpload({ ownerId: seller.id, purpose: 'id_proof', buffer: png, visibility: 'private', encrypt: true, allowed: ['image'] });
    const kit = await saveUpload({ ownerId: seller.id, purpose: 'fssai_doc', buffer: png, visibility: 'private', allowed: ['image'] });
    await db.insert(s.fssaiApplications).values({ sellerId: seller.id, applicantName: 'x', kitchenAddress: 'y', documentsJson: [{ label: 'Photo ID', url: idf.url }, { label: 'Kitchen', url: kit.url }] });
    await scheduleDocumentDeletion(seller.id, new Date('2026-05-01T00:00:00Z')); // default retention: 30 days
    const [meta] = await db.select().from(s.files).where(eq(s.files.key, idf.key));
    expect(meta.deleteAfter!.toISOString()).toBe('2026-05-31T00:00:00.000Z');
    expect((await db.select().from(s.files).where(eq(s.files.key, kit.key)))[0].deleteAfter).toBeNull(); // non-identity docs untouched
    expect(await purgeExpiredDocuments(new Date('2026-05-30T00:00:00Z'))).toBe(0);
    expect(await purgeExpiredDocuments(new Date('2026-06-01T00:00:00Z'))).toBe(1);
    const { getStorage } = await import('@/lib/storage');
    expect(await (await getStorage()).get(idf.key)).toBeNull();
    const [app] = await db.select().from(s.fssaiApplications).where(eq(s.fssaiApplications.sellerId, seller.id));
    expect(app.documentsJson).toEqual([{ label: 'Kitchen', url: kit.url }]);
  });
});
