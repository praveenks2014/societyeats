'use client';

import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

/**
 * Registers the service worker and surfaces a persistent "Update available"
 * banner once a new version has installed and is waiting to take over —
 * distinct from the generic auto-dismissing toast (useToast in providers.tsx)
 * because this needs a click-to-act button and must stay on screen until
 * the visitor sees it, not disappear after ~3 seconds.
 */
export function SwRegister() {
  const [waitingWorker, setWaitingWorker] = useState<ServiceWorker | null>(null);
  const reloadingRef = useRef(false);

  useEffect(() => {
    if (process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker.addEventListener('controllerchange', () => {
      // a new worker just took control — reload once to pick up the fresh HTML/JS
      if (reloadingRef.current) return;
      reloadingRef.current = true;
      window.location.reload();
    });

    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        // a build shipped while this tab was open earlier and is already waiting
        if (reg.waiting && reg.active) setWaitingWorker(reg.waiting);

        reg.addEventListener('updatefound', () => {
          const installing = reg.installing;
          if (!installing) return;
          installing.addEventListener('statechange', () => {
            // "installed" + an existing controller means this is an *update*,
            // not the first-ever install (which has no controller yet)
            if (installing.state === 'installed' && navigator.serviceWorker.controller) {
              setWaitingWorker(reg.waiting ?? installing);
            }
          });
        });
      })
      .catch(() => {});
  }, []);

  const reload = () => {
    if (waitingWorker) {
      waitingWorker.postMessage('SKIP_WAITING');
    } else {
      window.location.reload();
    }
  };

  return (
    <AnimatePresence>
      {waitingWorker && (
        <motion.div
          role="status"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 24 }}
          transition={{ duration: 0.22 }}
          className="pointer-events-auto fixed inset-x-4 bottom-24 z-[95] flex items-center justify-between gap-3 rounded-card bg-ink px-4 py-3 text-sm text-rice shadow-lift sm:inset-x-auto sm:right-6 sm:w-80"
        >
          <span>Update available</span>
          <button
            type="button"
            onClick={reload}
            className="rounded-pill bg-leaf px-3 py-1.5 font-semibold text-white"
          >
            Reload
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
