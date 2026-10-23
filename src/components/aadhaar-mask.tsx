'use client';

import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui';
import { defaultAadhaarMask, maskRegion, type Rect } from '@/lib/fssai/mask';

/**
 * In-browser Aadhaar masking. The original photo never leaves the device: the
 * user positions a box over the first 8 digits, the pixels under it are
 * overwritten with black, and ONLY the masked PNG is handed back for upload.
 */
export function AadhaarMask({ file, onMasked, onCancel }: { file: File; onMasked: (masked: File) => void; onCancel: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [rect, setRect] = useState<Rect>({ x: 0, y: 0, w: 0, h: 0 });

  useEffect(() => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1200 / img.width);
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);
      imgRef.current = img;
      setSize({ w, h });
      setRect(defaultAadhaarMask(w, h));
    };
    img.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => {
    const c = canvasRef.current;
    const img = imgRef.current;
    if (!c || !img || !size) return;
    c.width = size.w;
    c.height = size.h;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0, size.w, size.h);
    ctx.fillStyle = 'rgba(0,0,0,0.92)';
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeStyle = '#E8A020';
    ctx.lineWidth = 3;
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  }, [size, rect]);

  function apply() {
    const img = imgRef.current;
    if (!img || !size) return;
    const off = document.createElement('canvas');
    off.width = size.w;
    off.height = size.h;
    const ctx = off.getContext('2d')!;
    ctx.drawImage(img, 0, 0, size.w, size.h);
    const data = ctx.getImageData(0, 0, size.w, size.h);
    maskRegion(data.data, size.w, size.h, rect);
    ctx.putImageData(data, 0, 0);
    off.toBlob((blob) => {
      if (blob) onMasked(new File([blob], 'aadhaar-masked.png', { type: 'image/png' }));
    }, 'image/png');
  }

  const slider = (label: string, key: keyof Rect, max: number) => (
    <label className="block text-xs text-ink-soft">
      {label}
      <input type="range" min={0} max={Math.round(max)} value={Math.round(rect[key])} onChange={(e) => setRect((r) => ({ ...r, [key]: Number(e.target.value) }))} className="mt-1 w-full accent-leaf" />
    </label>
  );

  return (
    <div className="space-y-3" data-testid="aadhaar-mask">
      <p className="rounded-xl bg-turmeric-tint px-3 py-2 text-sm text-ink-soft" role="note">
        🔒 Cover the <strong>first 8 digits</strong> of your Aadhaar number. This happens on your phone — the original photo is never uploaded.
      </p>
      {!size ? <p className="text-sm text-ink-faint">Loading photo…</p> : (
        <>
          <canvas ref={canvasRef} className="w-full rounded-xl border border-rice-line" aria-label="Aadhaar photo with mask" />
          <div className="grid grid-cols-2 gap-3">
            {slider('Left', 'x', size.w)}
            {slider('Top', 'y', size.h)}
            {slider('Width', 'w', size.w)}
            {slider('Height', 'h', size.h)}
          </div>
        </>
      )}
      <div className="flex gap-2">
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button className="flex-1" onClick={apply} disabled={!size} data-testid="apply-mask">Mask &amp; use this photo</Button>
      </div>
    </div>
  );
}
