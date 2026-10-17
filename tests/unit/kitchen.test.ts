import { describe, expect, test } from 'vitest';
import { evaluateGate, paymentDetailsOk, VPA_RE } from '@/lib/kitchen/gate';
import { nextKitchenState } from '@/lib/kitchen/state';
import { moderationAfterEdit, moderationOnCreate, needsReReview } from '@/lib/dishes/moderation';
import { isFssaiEligibleToPublish } from '@/lib/fssai/gate';

const okProfile = { listingState: 'approved', fssaiStatus: 'verified' as const, fssaiExpiry: null, upiVpa: 'cook@okhdfc', acceptsUpiNow: true, acceptsPayAtPickup: true };
const gate = (over: Partial<Parameters<typeof evaluateGate>[0]> & { profile?: Partial<typeof okProfile> } = {}) =>
  evaluateGate({ profile: { ...okProfile, ...(over.profile ?? {}) }, application: null, subscribed: true, userBlocked: false, ...over, ...(over.profile ? { profile: { ...okProfile, ...over.profile } } : {}) });

describe('listing gate (approved + subscribed + FSSAI + payment details)', () => {
  test('all four satisfied → ok', () => expect(gate().ok).toBe(true));
  test('each requirement independently blocks', () => {
    expect(gate({ profile: { listingState: 'submitted' } }).checks.approved).toBe(false);
    expect(gate({ profile: { listingState: 'delisted' } }).ok).toBe(false);
    expect(gate({ subscribed: false }).checks.subscribed).toBe(false);
    expect(gate({ profile: { fssaiStatus: 'unverified' } }).checks.fssai).toBe(false);
    expect(gate({ profile: { upiVpa: null } }).checks.paymentDetails).toBe(false);
    expect(gate({ userBlocked: true }).ok).toBe(false);
  });
  test('pay-at-pickup-only kitchens need no VPA', () => {
    expect(paymentDetailsOk({ upiVpa: null, acceptsUpiNow: false, acceptsPayAtPickup: true })).toBe(true);
    expect(paymentDetailsOk({ upiVpa: null, acceptsUpiNow: true, acceptsPayAtPickup: true })).toBe(false);
    expect(paymentDetailsOk({ upiVpa: 'bad vpa', acceptsUpiNow: true, acceptsPayAtPickup: false })).toBe(false);
    expect(paymentDetailsOk({ upiVpa: null, acceptsUpiNow: false, acceptsPayAtPickup: false })).toBe(false);
  });
  test('VPA format validation', () => {
    for (const good of ['name@okhdfcbank', 'a.b-c_1@ybl', '9876543210@paytm']) expect(VPA_RE.test(good)).toBe(true);
    for (const bad of ['name', '@bank', 'name@', 'na me@bank', 'name@1bank', 'a@b@c']) expect(VPA_RE.test(bad)).toBe(false);
  });
  test('FSSAI licence expiry unpublishes until renewed', () => {
    const now = new Date('2026-06-15T10:00:00Z');
    expect(isFssaiEligibleToPublish({ fssaiStatus: 'verified', fssaiExpiry: '2026-06-14' }, null, now)).toBe(false);
    expect(isFssaiEligibleToPublish({ fssaiStatus: 'verified', fssaiExpiry: '2026-06-15' }, null, now)).toBe(true);
    expect(isFssaiEligibleToPublish({ fssaiStatus: 'verified', fssaiExpiry: '2027-01-01' }, null, now)).toBe(true);
  });
});

describe('kitchen state machine', () => {
  test('happy path and relist', () => {
    expect(nextKitchenState('draft', 'submit', 'seller')).toBe('submitted');
    expect(nextKitchenState('submitted', 'approve', 'admin')).toBe('approved');
    expect(nextKitchenState('approved', 'delist', 'admin', 'hygiene')).toBe('delisted');
    expect(nextKitchenState('delisted', 'relist', 'admin')).toBe('approved');
  });
  test('request changes → resubmit; reject needs a reason', () => {
    expect(nextKitchenState('submitted', 'request_changes', 'admin', 'photos')).toBe('changes_requested');
    expect(nextKitchenState('changes_requested', 'submit', 'seller')).toBe('submitted');
    expect(() => nextKitchenState('submitted', 'reject', 'admin', '  ')).toThrow(/reason/i);
    expect(() => nextKitchenState('submitted', 'request_changes', 'admin')).toThrow(/reason/i);
  });
  test('illegal transitions and wrong actors are refused', () => {
    expect(() => nextKitchenState('draft', 'approve', 'admin')).toThrow();
    expect(() => nextKitchenState('approved', 'submit', 'seller')).toThrow();
    expect(() => nextKitchenState('rejected', 'approve', 'admin')).toThrow();
    expect(() => nextKitchenState('submitted', 'approve', 'seller')).toThrow(/cannot/i);
    expect(() => nextKitchenState('delisted', 'delist', 'admin', 'x')).toThrow();
  });
});

describe('dish moderation', () => {
  const approved = { title: 'Dum Biryani', photoUrl: '/a.jpg', priceInPaise: 20000 };
  test('new dishes are pending when moderation is on, approved when off', () => {
    expect(moderationOnCreate(true)).toBe('pending');
    expect(moderationOnCreate(false)).toBe('approved');
  });
  test('name or photo change re-queues; price within 30% does not, beyond does', () => {
    expect(needsReReview(approved, { ...approved, title: 'Chicken Biryani' })).toBe(true);
    expect(needsReReview(approved, { ...approved, title: ' dum biryani ' })).toBe(false);
    expect(needsReReview(approved, { ...approved, photoUrl: '/b.jpg' })).toBe(true);
    expect(needsReReview(approved, { ...approved, priceInPaise: 26000 })).toBe(false); // +30% exactly
    expect(needsReReview(approved, { ...approved, priceInPaise: 26100 })).toBe(true);
    expect(needsReReview(approved, { ...approved, priceInPaise: 13999 })).toBe(true); // -30.005%
    expect(needsReReview(null, approved)).toBe(true);
  });
  test('status after an edit', () => {
    expect(moderationAfterEdit('approved', approved, { ...approved, priceInPaise: 21000 }, true)).toBe('approved');
    expect(moderationAfterEdit('approved', approved, { ...approved, priceInPaise: 40000 }, true)).toBe('pending');
    expect(moderationAfterEdit('hidden', approved, { ...approved, title: 'x' }, true)).toBe('hidden');
    expect(moderationAfterEdit('rejected', approved, approved, true)).toBe('pending');
    expect(moderationAfterEdit('pending', null, approved, false)).toBe('approved');
  });
});
