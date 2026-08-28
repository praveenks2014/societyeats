'use client';

import { useState } from 'react';

/**
 * Plain <img> with graceful fallback to a brand placeholder — seeded Unsplash
 * URLs keep working offline-ish and a dead URL never shows a broken image.
 */
export function FoodImage({
  src,
  alt,
  className = '',
}: {
  src?: string | null;
  alt: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const url = !src || failed ? '/placeholder-dish.svg' : src;
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      loading="lazy"
      onError={() => setFailed(true)}
      className={`bg-rice-deep object-cover ${className}`}
    />
  );
}
