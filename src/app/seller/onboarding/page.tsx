'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Badge, Button, Card, Field, Input, Skeleton } from '@/components/ui';
import { FoodImage } from '@/components/food-image';
import { useToast } from '@/components/providers';

const CUISINES = ['Biryani', 'Tiffins', 'North Indian', 'Jain Thali', 'Bengali Sweets', 'Keto Bowls', 'Desserts', 'Snacks', 'Other'];

type Data = {
  kitchenName: string;
  fssaiStatus: 'verified' | 'pending_application' | 'unverified';
  fssaiNumber: string | null;
  kitchenPhotosJson: string[];
  kitchenVideoUrl: string | null;
  cookingSinceYear: number | null;
  cuisinesJson: string[];
  minKitchenPhotosRequired: number;
};

const FSSAI_BADGE: Record<Data['fssaiStatus'], { label: string; tone: 'green' | 'amber' | 'red' }> = {
  verified: { label: 'FSSAI Verified ✅', tone: 'green' },
  pending_application: { label: 'FSSAI Pending', tone: 'amber' },
  unverified: { label: 'No FSSAI yet', tone: 'red' },
};

export default function SellerOnboarding() {
  const [data, setData] = useState<Data | null>(null);
  const [photos, setPhotos] = useState<string[]>([]);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [cookingSinceYear, setCookingSinceYear] = useState('');
  const [cuisines, setCuisines] = useState<string[]>([]);
  const [uploadingPhoto, setUploadingPhoto] = useState(false);
  const [uploadingVideo, setUploadingVideo] = useState(false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const router = useRouter();

  useEffect(() => {
    fetch('/api/seller/onboarding')
      .then((r) => r.json())
      .then((d: Data) => {
        setData(d);
        setPhotos(d.kitchenPhotosJson);
        setVideoUrl(d.kitchenVideoUrl);
        setCookingSinceYear(d.cookingSinceYear ? String(d.cookingSinceYear) : '');
        setCuisines(d.cuisinesJson);
      })
      .catch(() => {});
  }, []);

  async function uploadPhoto(file: File) {
    setUploadingPhoto(true);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/uploads', { method: 'POST', body: fd });
    const d = await res.json();
    setUploadingPhoto(false);
    if (!res.ok) {
      toast(d.error || 'Upload failed', 'err');
      return;
    }
    setPhotos((p) => [...p, d.url]);
  }

  async function uploadVideo(file: File) {
    setUploadingVideo(true);
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch('/api/uploads', { method: 'POST', body: fd });
    const d = await res.json();
    setUploadingVideo(false);
    if (!res.ok) {
      toast(d.error || 'Upload failed', 'err');
      return;
    }
    setVideoUrl(d.url);
  }

  async function save(andContinue: boolean) {
    setSaving(true);
    const res = await fetch('/api/seller/onboarding', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kitchenPhotosJson: photos,
        kitchenVideoUrl: videoUrl,
        cookingSinceYear: cookingSinceYear ? Number(cookingSinceYear) : null,
        cuisinesJson: cuisines,
      }),
    });
    const d = await res.json();
    setSaving(false);
    if (!res.ok) {
      toast(d.error || 'Could not save', 'err');
      return;
    }
    toast('Kitchen profile saved ✅');
    if (andContinue) router.push('/seller');
  }

  if (!data) return <Skeleton className="mx-auto h-64 w-full max-w-2xl" />;
  const badge = FSSAI_BADGE[data.fssaiStatus];
  const minPhotos = data.minKitchenPhotosRequired;
  const photosDone = photos.length >= minPhotos;

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">Complete your kitchen profile</h1>
      <p className="mt-1 text-sm text-ink-soft">
        Photos build trust with buyers before they've ever tasted your food. This takes a couple of
        minutes — everything except the photos is optional.
      </p>

      <Card className="mt-5 p-4">
        <div className="flex items-center justify-between">
          <div className="eyebrow">KITCHEN PHOTOS · REQUIRED ({photos.length}/{minPhotos})</div>
          {photosDone && <Badge tone="green">✓ Done</Badge>}
        </div>
        <div className="mt-3 flex flex-wrap gap-3">
          {photos.map((url, i) => (
            <div key={i} className="relative">
              <FoodImage src={url} alt="Kitchen" className="h-20 w-20 rounded-xl" />
              <button
                onClick={() => setPhotos((p) => p.filter((_, idx) => idx !== i))}
                className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-chili text-xs text-white"
                aria-label="Remove photo"
              >
                ×
              </button>
            </div>
          ))}
          <label className="flex h-20 w-20 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed border-rice-line text-xs text-ink-faint hover:border-leaf">
            {uploadingPhoto ? '…' : '+ Add'}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              disabled={uploadingPhoto}
              onChange={(e) => e.target.files?.[0] && uploadPhoto(e.target.files[0])}
            />
          </label>
        </div>
      </Card>

      <Card className="mt-4 p-4">
        <div className="eyebrow">KITCHEN VIDEO · OPTIONAL (~20 SEC)</div>
        <div className="mt-3">
          {videoUrl ? (
            <div className="flex items-center gap-3">
              <video src={videoUrl} controls className="h-24 w-40 rounded-xl bg-ink" />
              <Button size="sm" variant="ghost" onClick={() => setVideoUrl(null)}>
                Remove
              </Button>
            </div>
          ) : (
            <label className="inline-flex cursor-pointer">
              <span className="rounded-xl border border-leaf px-4 py-2 text-sm font-semibold text-leaf hover:bg-leaf-tint">
                {uploadingVideo ? 'Uploading…' : 'Upload a short video'}
              </span>
              <input
                type="file"
                accept="video/mp4,video/webm"
                className="hidden"
                disabled={uploadingVideo}
                onChange={(e) => e.target.files?.[0] && uploadVideo(e.target.files[0])}
              />
            </label>
          )}
        </div>
      </Card>

      <Card className="mt-4 p-4">
        <div className="eyebrow mb-3">FSSAI STATUS</div>
        <Badge tone={badge.tone}>{badge.label}</Badge>
        {data.fssaiStatus !== 'verified' && (
          <Link href="/seller/compliance" className="ml-2 text-xs font-semibold text-leaf underline">
            Continue compliance step →
          </Link>
        )}
      </Card>

      <Card className="mt-4 space-y-4 p-4">
        <div className="eyebrow">OPTIONAL EXTRAS</div>
        <Field label="Cooking since (year)" hint="Shown on your kitchen page — optional">
          <Input
            inputMode="numeric"
            maxLength={4}
            placeholder="e.g. 2018"
            value={cookingSinceYear}
            onChange={(e) => setCookingSinceYear(e.target.value.replace(/\D/g, ''))}
          />
        </Field>
        <Field label="Cuisines you cook">
          <div className="flex flex-wrap gap-1.5">
            {CUISINES.map((c) => (
              <button
                key={c}
                onClick={() => setCuisines((cur) => (cur.includes(c) ? cur.filter((x) => x !== c) : [...cur, c]))}
                className={`rounded-pill px-3 py-1 text-xs font-semibold ${
                  cuisines.includes(c) ? 'bg-leaf text-white' : 'bg-rice-deep text-ink-soft'
                }`}
              >
                {c}
              </button>
            ))}
          </div>
        </Field>
      </Card>

      <div className="mt-5 flex gap-3">
        <Button variant="secondary" className="flex-1" loading={saving} onClick={() => save(false)}>
          Save
        </Button>
        <Button className="flex-1" loading={saving} disabled={!photosDone} onClick={() => save(true)}>
          Save &amp; continue to dashboard
        </Button>
      </div>
      {!photosDone && (
        <p className="mt-2 text-center text-xs text-ink-faint">
          Add {minPhotos - photos.length} more photo{minPhotos - photos.length === 1 ? '' : 's'} to
          finish onboarding.
        </p>
      )}
    </div>
  );
}
