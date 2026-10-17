import { BRAND } from '@/config/brand';
import { siteOriginSafe } from '@/lib/site-url';

export function joinUrl(inviteCode: string): string {
  return `${siteOriginSafe()}/join/${encodeURIComponent(inviteCode)}`;
}

/** The copy-paste WhatsApp invitation for a society. */
export function whatsappMessage(societyName: string, inviteCode: string): string {
  return [
    `🍛 *${BRAND.appName}* is now live in *${societyName}*!`,
    '',
    `${BRAND.tagline} — order fresh home-cooked food from neighbours in your society, or list your own kitchen and earn.`,
    '',
    `👉 Join here: ${joinUrl(inviteCode)}`,
    `Invite code: *${inviteCode}*`,
    '',
    'You pay the kitchen directly (UPI or at pickup). Only a small platform fee goes to us.',
  ].join('\n');
}
