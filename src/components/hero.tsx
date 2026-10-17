'use client';

import { useRef } from 'react';
import {
  motion,
  useMotionValue,
  useReducedMotion,
  useScroll,
  useSpring,
  useTransform,
} from 'framer-motion';
import { Button } from '@/components/ui';
import { useLocation } from '@/components/providers';

/**
 * The one orchestrated moment: a "society at dusk" parallax scene.
 * Apartment-tower silhouettes scroll at different speeds while dish cards
 * tilt in 3D under the pointer and rise like balcony lights. Steam is CSS.
 * Everything collapses to a calm static header under prefers-reduced-motion.
 */
export function Hero() {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const { scrollY } = useScroll();
  const yFar = useTransform(scrollY, [0, 500], [0, reduce ? 0 : 90]);
  const yNear = useTransform(scrollY, [0, 500], [0, reduce ? 0 : 30]);
  const yCards = useTransform(scrollY, [0, 500], [0, reduce ? 0 : -60]);

  // pointer-driven 3D tilt for the floating dish cards
  const mx = useMotionValue(0);
  const my = useMotionValue(0);
  const rotateY = useSpring(useTransform(mx, [-0.5, 0.5], [-8, 8]), { stiffness: 150, damping: 20 });
  const rotateX = useSpring(useTransform(my, [-0.5, 0.5], [8, -8]), { stiffness: 150, damping: 20 });

  function onPointerMove(e: React.PointerEvent) {
    if (reduce || !ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    mx.set((e.clientX - rect.left) / rect.width - 0.5);
    my.set((e.clientY - rect.top) / rect.height - 0.5);
  }

  const { openPicker, loc } = useLocation();

  return (
    <section
      ref={ref}
      onPointerMove={onPointerMove}
      className="relative -mx-4 mb-8 overflow-hidden rounded-b-[2rem] bg-gradient-to-b from-[#12291A] via-[#1E4D2B] to-[#3A5D34] px-4 pb-24 pt-14 text-rice sm:-mx-6 sm:px-6"
      style={{ perspective: 900 }}
    >
      {/* dusk glow */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-turmeric/30 to-transparent" />

      {/* far towers */}
      <motion.div style={{ y: yFar }} className="pointer-events-none absolute inset-x-0 bottom-0">
        <Towers className="h-40 w-full opacity-40 sm:h-52" seed={1} />
      </motion.div>
      {/* near towers */}
      <motion.div style={{ y: yNear }} className="pointer-events-none absolute inset-x-0 -bottom-2">
        <Towers className="h-28 w-full opacity-80 sm:h-40" seed={2} />
      </motion.div>

      <div className="relative z-10 mx-auto flex max-w-5xl flex-col items-start gap-8 sm:flex-row sm:items-center">
        <div className="max-w-md">
          <div className="eyebrow mb-3 !text-turmeric">HOME FOOD · FROM YOUR PADOSI</div>
          <h1 className="text-4xl font-bold leading-[1.05] sm:text-5xl">
            Home food
            <br />
            from <span className="text-turmeric">your neighbours</span>
          </h1>
          <p className="mt-4 text-sm leading-relaxed text-rice/80 sm:text-base">
            Verified home kitchens within 10 km — dum biryani from the 12th floor,
            tiffins from the tower next door.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button size="lg" onClick={openPicker}>
              {loc ? `Browsing near ${loc.label}` : '📍 Find food near me'}
            </Button>
          </div>
        </div>

        {/* floating dish cards */}
        <motion.div
          style={{ y: yCards, rotateX, rotateY, transformStyle: 'preserve-3d' }}
          className="relative mx-auto hidden h-64 w-72 shrink-0 sm:block"
          aria-hidden
        >
          <FloatCard
            className="left-0 top-6"
            emoji="🍛"
            title="Hyderabadi Dum Biryani"
            meta="1.2 km · Aparna Cyberzon"
            delay={0}
          />
          <FloatCard
            className="right-0 top-0"
            emoji="🥗"
            title="Keto Paneer Bowl"
            meta="3.4 km · My Home Avatar"
            delay={1.2}
          />
          <FloatCard
            className="bottom-0 left-10"
            emoji="🍮"
            title="Nolen Gurer Sandesh"
            meta="800 m · Mishti Ghor"
            delay={2.1}
          />
          {/* steam wisps */}
          <div className="absolute left-24 top-2">
            <span className="absolute block h-8 w-1.5 rounded-full bg-rice/60 blur-[3px] animate-steam" />
            <span className="absolute left-3 block h-8 w-1.5 rounded-full bg-rice/40 blur-[3px] animate-steam [animation-delay:1.1s]" />
            <span className="absolute left-6 block h-8 w-1.5 rounded-full bg-rice/50 blur-[3px] animate-steam [animation-delay:2.2s]" />
          </div>
        </motion.div>
      </div>
    </section>
  );
}

function FloatCard({
  className,
  emoji,
  title,
  meta,
  delay,
}: {
  className: string;
  emoji: string;
  title: string;
  meta: string;
  delay: number;
}) {
  const reduce = useReducedMotion();
  return (
    <motion.div
      animate={reduce ? undefined : { y: [0, -8, 0] }}
      transition={{ duration: 4.5, repeat: Infinity, ease: 'easeInOut', delay }}
      className={`absolute w-44 rounded-2xl border border-white/15 bg-white/10 p-3 shadow-lift backdrop-blur-md ${className}`}
      style={{ transform: 'translateZ(40px)' }}
    >
      <div className="text-2xl">{emoji}</div>
      <div className="mt-1 text-sm font-semibold leading-tight text-rice">{title}</div>
      <div className="eyebrow mt-1 !text-rice/60">{meta}</div>
    </motion.div>
  );
}

/** Apartment tower silhouettes with lit windows, generated deterministically. */
function Towers({ className, seed }: { className: string; seed: number }) {
  const rand = mulberry(seed);
  const towers: { x: number; w: number; h: number; windows: { wx: number; wy: number }[] }[] = [];
  let x = 0;
  while (x < 1200) {
    const w = 60 + Math.floor(rand() * 80);
    const h = 60 + Math.floor(rand() * 120);
    const windows: { wx: number; wy: number }[] = [];
    for (let wy = 12; wy < h - 10; wy += 18) {
      for (let wx = 8; wx < w - 10; wx += 16) {
        if (rand() > 0.55) windows.push({ wx, wy });
      }
    }
    towers.push({ x, w, h, windows });
    x += w + 14 + Math.floor(rand() * 30);
  }
  return (
    <svg viewBox="0 0 1200 200" preserveAspectRatio="xMidYMax slice" className={className}>
      {towers.map((t, i) => (
        <g key={i} transform={`translate(${t.x} ${200 - t.h})`}>
          <rect width={t.w} height={t.h} fill="#0D1F13" />
          {t.windows.map((wnd, j) => (
            <rect
              key={j}
              x={wnd.wx}
              y={wnd.wy}
              width="7"
              height="9"
              fill="#E8A020"
              opacity={0.35 + (j % 4) * 0.15}
            />
          ))}
        </g>
      ))}
    </svg>
  );
}

function mulberry(seed: number) {
  let a = seed * 1000 + 12345;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
