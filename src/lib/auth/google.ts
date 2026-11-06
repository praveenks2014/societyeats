import crypto from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';

/**
 * GoogleOAuthAdapter — OFF unless GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are set. Authorization-code flow;
 * the id_token is verified against Google's keys (issuer, audience, expiry, nonce).
 * A Google account whose e-mail matches an existing account is NEVER linked automatically: the user signs in with
 * their existing method once and links Google from their account page (prevents account takeover through a
 * look-alike e-mail on the identity provider side).
 */
export const googleEnabled = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);

const AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN = 'https://oauth2.googleapis.com/token';
const JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export const newState = () => crypto.randomBytes(16).toString('hex');

export function authorizationUrl(redirectUri: string, state: string, nonce: string): string {
  const q = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, redirect_uri: redirectUri, response_type: 'code', scope: 'openid email profile', state, nonce, prompt: 'select_account' });
  return `${AUTH}?${q}`;
}

export type GoogleProfile = { sub: string; email: string; emailVerified: boolean; name: string };

export async function exchangeCode(code: string, redirectUri: string, nonce: string, fetcher: typeof fetch = fetch, verify: typeof jwtVerify = jwtVerify): Promise<GoogleProfile> {
  const res = await fetcher(TOKEN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: redirectUri, grant_type: 'authorization_code' }),
  });
  if (!res.ok) throw new Error('Google sign-in failed');
  const { id_token } = (await res.json()) as { id_token?: string };
  if (!id_token) throw new Error('Google sign-in failed');
  const { payload } = await verify(id_token, JWKS, { issuer: ['https://accounts.google.com', 'accounts.google.com'], audience: process.env.GOOGLE_CLIENT_ID });
  if (payload.nonce !== nonce) throw new Error('Google sign-in failed');
  return { sub: String(payload.sub), email: String(payload.email ?? '').toLowerCase(), emailVerified: payload.email_verified === true, name: String(payload.name ?? '') };
}
