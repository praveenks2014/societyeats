'use client';

import Link from 'next/link';
import { usePolledResource } from '@/lib/use-polled-resource';

/** Header chat icon with the total of unread chat messages. Hidden for admins (they have no chats of their own). */
export function ChatBadge({ role }: { role: string }) {
  const { data } = usePolledResource<{ total: number }>(
    async (signal) => {
      if (role === 'admin') return null;
      try {
        const r = await fetch('/api/chat/unread', { signal });
        return r.ok ? { total: ((await r.json()).total as number) ?? 0 } : { total: 0 };
      } catch {
        return null;
      }
    },
    { intervalMs: 15_000, enabled: role !== 'admin', resetKey: role },
  );
  const n = data?.total ?? 0;
  if (role === 'admin') return null;
  return (
    <Link href={role === 'seller' ? '/seller/orders' : '/orders'} className="relative rounded-xl p-2 text-xl transition-colors hover:bg-rice-deep" aria-label={`Messages, ${n} unread`} data-testid="chat-badge">
      <span aria-hidden>💬</span>
      {n > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-chili px-1 text-[11px] font-bold text-white" data-testid="chat-unread">{n > 9 ? '9+' : n}</span>
      )}
    </Link>
  );
}
