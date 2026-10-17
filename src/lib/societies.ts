import crypto from 'node:crypto';
import { z } from 'zod';

export function newInviteCode(name: string): string {
  const base = name.replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 8) || 'PADOSI';
  return `${base}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
}

export const societyInput = z.object({
  name: z.string().trim().min(2, 'Name is required').max(160),
  city: z.string().trim().min(2, 'City is required').max(80),
  addressText: z.string().trim().min(3, 'Address is required').max(500),
  pincode: z.string().trim().regex(/^\d{6}$/, 'Pincode must be 6 digits').optional().or(z.literal('')),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  isLive: z.boolean().optional(),
  requireApproval: z.boolean().optional(),
  targetHouseholds: z.number().int().min(1).max(100000).optional(),
});
