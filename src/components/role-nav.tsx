'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

export function RoleNav({
  title,
  tabs,
}: {
  title: string;
  tabs: { href: string; label: string }[];
}) {
  const pathname = usePathname();
  return (
    <div className="sticky top-14 z-30 -mx-4 border-b border-rice-line bg-rice/90 px-4 pb-0 pt-3 backdrop-blur-md sm:-mx-6 sm:px-6">
      <div className="eyebrow">{title}</div>
      <nav className="no-scrollbar -mb-px mt-2 flex gap-1 overflow-x-auto">
        {tabs.map((t) => {
          const active = pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold transition-colors ${
                active
                  ? 'border-leaf text-leaf'
                  : 'border-transparent text-ink-faint hover:text-ink'
              }`}
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
