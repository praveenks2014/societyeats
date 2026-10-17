import { z } from 'zod';

export type ListingBody = {
  title: string;
  description?: string;
  priceRupees: number;
  isVeg: boolean;
  cuisine: string;
  photoUrl?: string;
  prepTimeMins: number;
  availableQty: number;
  days: string[];
  slots: string[];
  isActive?: boolean;
};

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
const SLOTS = ['breakfast', 'lunch', 'dinner'];

export const listingCreateSchema = z.object({
  title: z.string().trim().min(1, 'Dish name required').max(160),
  description: z.string().trim().max(1000).optional(),
  priceRupees: z.number({ invalid_type_error: 'Price required' }).finite().min(1, 'Price must be at least ₹1').max(50_000, 'Price is too high'),
  isVeg: z.boolean(),
  cuisine: z.string().trim().min(1, 'Cuisine required').max(60),
  photoUrl: z.string().trim().max(500).optional().nullable(),
  prepTimeMins: z.number().finite().min(0).max(24 * 60).default(30),
  availableQty: z.number().int('Quantity must be a whole number').min(0).max(1000).default(0),
  days: z.array(z.enum(DAYS as [string, ...string[]])).default(DAYS),
  slots: z.array(z.enum(SLOTS as [string, ...string[]])).default(['lunch', 'dinner']),
  isActive: z.boolean().optional(),
});

export const listingPatchSchema = listingCreateSchema.partial();

/** ₹ → integer paise, safely (no float artefacts like 12.34*100 = 1233.9999). */
export function rupeesToPaise(r: number): number {
  return Math.round(r * 100 + 1e-9);
}
