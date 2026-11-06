import Link from 'next/link';
import type { ReactNode } from 'react';
import { BRAND } from '@/config/brand';
import { formatINR } from '@/lib/money';
import { ANTI_SCAM_NOTICE, RULES_VERIFIED_NOTE } from '@/lib/fssai/assistant';
import type { PlatformSettings } from '@/lib/settings/defs';

/** Fills `{{key}}` placeholders from settings. Unknown keys are left visible so a typo is noticed. */
export function legalVars(s: PlatformSettings): Record<string, string> {
  return {
    appName: BRAND.appName,
    entity: s.legalEntityName || BRAND.legalEntityName,
    feePct: String(s.buyerPlatformFeeBps / 100),
    feeMin: formatINR(s.buyerPlatformFeeMinPaise),
    feeMax: formatINR(s.buyerPlatformFeeMaxPaise),
    gstNote: s.platformGstin && s.gstMode !== 'unregistered' ? ', plus GST' : '',
    unpaidMin: String(s.unpaidOrderExpiryMinutes),
    acceptMin: String(s.sellerAcceptWindowMinutes),
    graceDays: String(s.subscriptionGraceDays),
    sellerStrikeLimit: String(s.sellerStrikeLimit),
    strikeWindowDays: String(s.strikeWindowDays),
    grievance: s.grievanceOfficer || BRAND.grievanceOfficer,
    supportEmail: s.supportEmail || BRAND.supportEmail,
    supportPhone: s.supportPhone || 'not set yet',
    ackHours: String(s.grievanceAckHours),
    resolveDays: String(s.grievanceResolveDays),
    platformLicence: s.platformFssaiCentralLicenseNo ? `Central Licence ${s.platformFssaiCentralLicenseNo}` : 'applied for',
    antiScam: ANTI_SCAM_NOTICE,
    rulesNote: RULES_VERIFIED_NOTE,
  };
}

export function fillLegal(text: string, vars: Record<string, string>): string {
  return text.replace(/\{\{(\w+)\}\}/g, (m, k: string) => (k in vars ? vars[k] : m));
}

function inline(text: string, key: string): ReactNode[] {
  // **bold** and [label](/path) only; everything else is plain text, which React escapes.
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|\[[^\]]+\]\((?:\/|https:\/\/)[^)\s]*\))/g;
  text.split(re).forEach((part, i) => {
    if (part.startsWith('**')) out.push(<strong key={`${key}${i}`}>{part.slice(2, -2)}</strong>);
    else if (part.startsWith('[')) {
      const m = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)!;
      out.push(m[2].startsWith('/') ? <Link key={`${key}${i}`} href={m[2]} className="underline">{m[1]}</Link> : <a key={`${key}${i}`} href={m[2]} className="underline" rel="noopener noreferrer" target="_blank">{m[1]}</a>);
    } else if (part) out.push(part);
  });
  return out;
}

/** Small, safe Markdown renderer: #/## headings (with `{#anchor}`), `-` lists, paragraphs. No raw HTML. */
export function renderMarkdown(md: string): ReactNode {
  const blocks: ReactNode[] = [];
  let list: string[] = [];
  let para: string[] = [];
  let n = 0;
  const flushList = () => {
    if (list.length) {
      const k = `l${n++}`;
      blocks.push(<ul key={k}>{list.map((li, i) => <li key={i}>{inline(li, `${k}-${i}`)}</li>)}</ul>);
      list = [];
    }
  };
  const flushPara = () => {
    if (para.length) {
      const k = `p${n++}`;
      blocks.push(<p key={k}>{inline(para.join(' '), k)}</p>);
      para = [];
    }
  };
  for (const raw of md.split('\n')) {
    const line = raw.trimEnd();
    const h = /^(#{1,2})\s+(.*?)(?:\s*\{#([\w-]+)\})?$/.exec(line);
    if (h) {
      flushList();
      flushPara();
      const k = `h${n++}`;
      blocks.push(h[1] === '#' ? <h1 key={k}>{inline(h[2], k)}</h1> : <h2 key={k} id={h[3]}>{inline(h[2], k)}</h2>);
    } else if (/^-\s+/.test(line)) {
      flushPara();
      list.push(line.replace(/^-\s+/, ''));
    } else if (!line.trim()) {
      flushList();
      flushPara();
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushList();
  flushPara();
  return <>{blocks}</>;
}
