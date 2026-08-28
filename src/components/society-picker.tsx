'use client';

import { useEffect, useState } from 'react';
import { Modal, Button, Spinner } from '@/components/ui';
import { useLocation, useToast } from '@/components/providers';

type Society = { id: number; name: string; city: string; lat: number; lng: number };

export function SocietyPicker() {
  const { pickerOpen, closePicker, setLoc } = useLocation();
  const toast = useToast();
  const [societies, setSocieties] = useState<Society[] | null>(null);
  const [locating, setLocating] = useState(false);

  useEffect(() => {
    if (!pickerOpen || societies) return;
    fetch('/api/societies')
      .then((r) => r.json())
      .then((d) => setSocieties(d.societies))
      .catch(() => setSocieties([]));
  }, [pickerOpen, societies]);

  function useMyLocation() {
    if (!navigator.geolocation) {
      toast('Location not supported on this device', 'err');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLoc({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          label: 'Current location',
        });
        setLocating(false);
        closePicker();
      },
      () => {
        setLocating(false);
        toast('Could not get your location — pick a society instead', 'err');
      },
      { timeout: 8000 },
    );
  }

  return (
    <Modal open={pickerOpen} onClose={closePicker} title="Where should we look?" sheet>
      <Button onClick={useMyLocation} loading={locating} className="w-full" size="lg">
        📡 Use my current location
      </Button>
      <div className="my-4 flex items-center gap-3 text-xs text-ink-faint">
        <span className="h-px flex-1 bg-rice-line" /> or pick your society
        <span className="h-px flex-1 bg-rice-line" />
      </div>
      {!societies ? (
        <div className="flex justify-center py-6">
          <Spinner />
        </div>
      ) : (
        <div className="space-y-2">
          {societies.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setLoc({ lat: s.lat, lng: s.lng, label: s.name, societyId: s.id });
                closePicker();
              }}
              className="flex w-full items-center gap-3 rounded-2xl border border-rice-line bg-white px-4 py-3 text-left transition-colors hover:border-leaf/50"
            >
              <span className="text-xl" aria-hidden>
                🏢
              </span>
              <span>
                <span className="block text-sm font-semibold">{s.name}</span>
                <span className="block text-xs text-ink-faint">{s.city}</span>
              </span>
            </button>
          ))}
        </div>
      )}
    </Modal>
  );
}
