/**
 * Aadhaar masking. A 12-digit Aadhaar number is printed in three groups of
 * four; the first 8 digits (the first two groups) must be hidden before the
 * image leaves the browser. These helpers work on raw RGBA pixel data so the
 * very same code runs in the browser canvas tool and in unit tests.
 */
export type Rect = { x: number; y: number; w: number; h: number };

/** Paints an opaque black rectangle over `rect` (clamped to the image) — destroys the underlying pixels, not just overlays them. */
export function maskRegion(data: Uint8ClampedArray, width: number, height: number, rect: Rect): number {
  const x0 = Math.max(0, Math.floor(rect.x));
  const y0 = Math.max(0, Math.floor(rect.y));
  const x1 = Math.min(width, Math.ceil(rect.x + rect.w));
  const y1 = Math.min(height, Math.ceil(rect.y + rect.h));
  let n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * width + x) * 4;
      data[i] = 0;
      data[i + 1] = 0;
      data[i + 2] = 0;
      data[i + 3] = 255;
      n++;
    }
  }
  return n;
}

/**
 * The default mask for an Aadhaar card photo: the number sits roughly in the
 * lower-middle of a front-on card. The user can drag/resize the box; this is
 * only the starting position — covers the left 2/3 of the number line, i.e.
 * the first 8 of 12 digits.
 */
export function defaultAadhaarMask(width: number, height: number): Rect {
  return { x: width * 0.12, y: height * 0.68, w: width * 0.52, h: height * 0.14 };
}
