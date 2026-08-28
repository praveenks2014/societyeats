'use client';

import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { useCart } from '@/components/providers';
import { formatINR } from '@/lib/money';

/** Swiggy-style floating "View cart" bar. */
export function CartBar() {
  const { count, subtotalPaise, vendor } = useCart();
  return (
    <AnimatePresence>
      {count > 0 && (
        <motion.div
          initial={{ y: 80, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 80, opacity: 0 }}
          transition={{ type: 'spring', damping: 28, stiffness: 380 }}
          className="fixed inset-x-0 bottom-0 z-40 px-4 pb-4 safe-bottom"
        >
          <Link
            href="/cart"
            className="mx-auto flex max-w-lg items-center justify-between rounded-2xl bg-leaf px-5 py-3.5 text-white shadow-lift"
          >
            <span className="text-sm">
              <span className="font-bold">{count} item{count > 1 ? 's' : ''}</span>
              {vendor && <span className="text-white/70"> · {vendor.name}</span>}
            </span>
            <span className="flex items-center gap-2 text-sm font-bold">
              View cart · {formatINR(subtotalPaise)} <span aria-hidden>→</span>
            </span>
          </Link>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
