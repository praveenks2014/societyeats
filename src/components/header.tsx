'use client';

import { BRAND } from '@/config/brand';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { Session } from '@/lib/auth';
import { useCart, useLocation } from '@/components/providers';
import { SocietyPicker } from '@/components/society-picker';

const roleHome: Record<string, { href: string; label: string }> = {
  seller: { href: '/seller', label: 'Kitchen dashboard' },
  restaurant: { href: '/restaurant', label: 'Counter console' },
  admin: { href: '/admin', label: 'Admin' },
  buyer: { href: '/orders', label: 'My orders' },
};

export function Header({ session }: { session: Session | null }) {
  const { loc, openPicker } = useLocation();
  const { count } = useCart();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('click', close);
    return () => document.removeEventListener('click', close);
  }, []);

  async function logout() {
    await fetch('/api/auth/logout', { method: 'POST' });
    setMenuOpen(false);
    router.push('/');
    router.refresh();
  }

  return (
    <>
      <header className="sticky top-0 z-50 border-b border-rice-line bg-rice/85 backdrop-blur-md">
        <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-2 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-1.5" aria-label={`${BRAND.appName} home`}>
            <BowlMark />
            <span className="font-display text-xl font-bold tracking-tight text-leaf">
              {BRAND.appName}
            </span>
          </Link>

          <button
            onClick={openPicker}
            className="ml-1 flex min-w-0 max-w-[46vw] items-center gap-1 rounded-pill border border-rice-line bg-white px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:border-leaf/40 sm:max-w-xs sm:text-sm"
          >
            <span aria-hidden>📍</span>
            <span className="truncate">{loc ? loc.label : 'Set location'}</span>
            <span className="text-ink-faint" aria-hidden>▾</span>
          </button>

          <div className="ml-auto flex items-center gap-1.5">
            {session && <Bell />}
            <Link
              href="/cart"
              className="relative rounded-xl p-2 text-xl transition-colors hover:bg-rice-deep"
              aria-label={`Cart, ${count} items`}
            >
              🧺
              {count > 0 && (
                <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 animate-pop-in items-center justify-center rounded-pill bg-chili px-1 text-[11px] font-bold text-white">
                  {count}
                </span>
              )}
            </Link>
            {session ? (
              <div className="relative" ref={menuRef}>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen((o) => !o);
                  }}
                  className="flex h-9 w-9 items-center justify-center rounded-pill bg-leaf text-sm font-bold text-white"
                  aria-label="Account menu"
                >
                  {session.name.charAt(0).toUpperCase()}
                </button>
                {menuOpen && (
                  <div className="absolute right-0 top-11 w-56 overflow-hidden rounded-2xl border border-rice-line bg-white shadow-lift">
                    <div className="border-b border-rice-line px-4 py-3">
                      <div className="text-sm font-semibold">{session.name}</div>
                      <div className="text-xs capitalize text-ink-faint">{session.role}</div>
                    </div>
                    <Link
                      href={roleHome[session.role].href}
                      onClick={() => setMenuOpen(false)}
                      className="block px-4 py-2.5 text-sm hover:bg-rice"
                    >
                      {roleHome[session.role].label}
                    </Link>
                    {session.role === 'buyer' && (
                      <Link
                        href="/"
                        onClick={() => setMenuOpen(false)}
                        className="block px-4 py-2.5 text-sm hover:bg-rice"
                      >
                        Browse food
                      </Link>
                    )}
                    <Link
                      href="/refer"
                      onClick={() => setMenuOpen(false)}
                      className="block px-4 py-2.5 text-sm hover:bg-rice"
                    >
                      🎁 Invite neighbours
                    </Link>
                    <button
                      onClick={logout}
                      className="block w-full px-4 py-2.5 text-left text-sm text-chili hover:bg-rice"
                    >
                      Log out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link
                href="/login"
                className="rounded-xl bg-leaf px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-leaf-dark"
              >
                Log in
              </Link>
            )}
          </div>
        </div>
      </header>
      <SocietyPicker />
    </>
  );
}

function Bell() {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<
    { id: number; title: string; body: string | null; href: string | null; readAt: string | null }[]
  >([]);
  const [unread, setUnread] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  async function load() {
    try {
      const res = await fetch('/api/notifications');
      if (!res.ok) return;
      const data = await res.json();
      setItems(data.notifications);
      setUnread(data.unread);
    } catch {}
  }

  useEffect(() => {
    load();
    const t = setInterval(load, 25000);
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('click', close);
    return () => {
      clearInterval(t);
      document.removeEventListener('click', close);
    };
  }, []);

  async function openBell(e: React.MouseEvent) {
    e.stopPropagation();
    setOpen((o) => !o);
    if (!open && unread > 0) {
      await fetch('/api/notifications', { method: 'PATCH' });
      setUnread(0);
    }
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={openBell}
        className="relative rounded-xl p-2 text-xl transition-colors hover:bg-rice-deep"
        aria-label={`Notifications, ${unread} unread`}
      >
        🔔
        {unread > 0 && (
          <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-chili ring-2 ring-rice" />
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-11 max-h-96 w-72 overflow-y-auto rounded-2xl border border-rice-line bg-white shadow-lift">
          {items.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-ink-faint">
              No notifications yet
            </div>
          ) : (
            items.map((n) => (
              <Link
                key={n.id}
                href={n.href || '#'}
                onClick={() => setOpen(false)}
                className="block border-b border-rice-line px-4 py-3 last:border-0 hover:bg-rice"
              >
                <div className="text-sm font-semibold">{n.title}</div>
                {n.body && <div className="mt-0.5 text-xs text-ink-soft">{n.body}</div>}
              </Link>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function BowlMark() {
  return (
    <svg viewBox="0 0 32 32" className="h-7 w-7" aria-hidden>
      <path d="M4 17a12 12 0 0 0 24 0z" fill="#1E4D2B" />
      <ellipse cx="16" cy="17" rx="12" ry="2" fill="#E8A020" />
      <path
        d="M12 12q1.4-2.2 0-4.4Q10.6 5.6 12 4"
        stroke="#C63D2F"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M19 13q1.4-2.2 0-4.4Q17.6 6.6 19 5"
        stroke="#E8A020"
        strokeWidth="2"
        fill="none"
        strokeLinecap="round"
        opacity="0.8"
      />
    </svg>
  );
}
