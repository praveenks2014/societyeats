import crypto from 'node:crypto';
import { isMockMode } from '@/lib/config';

/**
 * GeocodeAdapter. Mock (MOCK_MODE=true or no GEOCODE_API_KEY): a deterministic
 * coordinate near Hyderabad derived from the address text, so the admin UI is
 * fully usable offline. Live: Google Geocoding API.
 */
export type GeocodeResult = { lat: number; lng: number; formatted: string; mock: boolean };

export async function geocode(address: string, pincode?: string): Promise<GeocodeResult | null> {
  const query = [address, pincode, 'India'].filter(Boolean).join(', ').trim();
  if (!query || query.length < 4) return null;
  const key = process.env.GEOCODE_API_KEY;
  if (isMockMode() || !key) {
    const h = crypto.createHash('sha256').update(query.toLowerCase()).digest();
    const lat = 17.2 + (h.readUInt16BE(0) / 65535) * 0.45;
    const lng = 78.2 + (h.readUInt16BE(2) / 65535) * 0.45;
    return { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)), formatted: `${query} (mock location)`, mock: true };
  }
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&region=in&key=${key}`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = (await res.json()) as { status: string; results?: { formatted_address: string; geometry: { location: { lat: number; lng: number } } }[] };
  const r = data.results?.[0];
  if (data.status !== 'OK' || !r) return null;
  return { lat: r.geometry.location.lat, lng: r.geometry.location.lng, formatted: r.formatted_address, mock: false };
}
