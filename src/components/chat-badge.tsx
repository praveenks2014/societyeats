'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

/** Header chat icon with the total of unread chat messages. Hidden for admins (they have no chats of their own). */
export function ChatBadge({ role }: { role: string }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (role === 'admin') return;
    let live = true;
    const tick = () =>
      fetch('/api/chat/unread')
        .then((r) => (r.ok ? r.json() : { total: 0 }))
        .then((d) => live && setN(d.total ?? 0))
        .catch(() => {});
    tick();
    const i = setInterval(tick, 15_000);
    return () => {
      live = false;
      clearInterval(i);
    };
  }, [role]);
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
