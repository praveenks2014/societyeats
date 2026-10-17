'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AnimatePresence, motion } from 'framer-motion';

// ============================== Toast ==============================

type Toast = { id: number; text: string; kind: 'ok' | 'err' };
const ToastCtx = createContext<(text: string, kind?: 'ok' | 'err') => void>(() => {});
export const useToast = () => useContext(ToastCtx);

// ============================== Location ==============================

export type BuyerLoc = { lat: number; lng: number; label: string; societyId?: number };

type LocationState = {
  loc: BuyerLoc | null;
  setLoc: (loc: BuyerLoc) => void;
  pickerOpen: boolean;
  openPicker: () => void;
  closePicker: () => void;
};
const LocationCtx = createContext<LocationState>({
  loc: null,
  setLoc: () => {},
  pickerOpen: false,
  openPicker: () => {},
  closePicker: () => {},
});
export const useLocation = () => useContext(LocationCtx);

// ============================== Cart ==============================

export type CartVendor = {
  kind: 'seller' | 'restaurant';
  id: number;
  name: string;
  mallSlug?: string;
  counterNumber?: string;
};
export type CartItem = {
  id: number;
  title: string;
  pricePaise: number;
  isVeg: boolean;
  photoUrl?: string | null;
  qty: number;
  maxQty: number;
};

type CartState = {
  vendor: CartVendor | null;
  items: CartItem[];
  count: number;
  subtotalPaise: number;
  add: (vendor: CartVendor, item: Omit<CartItem, 'qty'>) => 'added' | 'conflict';
  replaceWith: (vendor: CartVendor, item: Omit<CartItem, 'qty'>) => void;
  inc: (id: number) => void;
  dec: (id: number) => void;
  clear: () => void;
};
const CartCtx = createContext<CartState>({
  vendor: null,
  items: [],
  count: 0,
  subtotalPaise: 0,
  add: () => 'added',
  replaceWith: () => {},
  inc: () => {},
  dec: () => {},
  clear: () => {},
});
export const useCart = () => useContext(CartCtx);

// ============================== Provider ==============================

function readLS<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function Providers({ children }: { children: React.ReactNode }) {
  // toast
  const [toasts, setToasts] = useState<Toast[]>([]);
  const idRef = useRef(1);
  const toast = useCallback((text: string, kind: 'ok' | 'err' = 'ok') => {
    const id = idRef.current++;
    setToasts((t) => [...t, { id, text, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 2800);
  }, []);

  // location
  const [loc, setLocState] = useState<BuyerLoc | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => {
    setLocState(readLS<BuyerLoc>('padosi_loc'));
  }, []);
  const setLoc = useCallback((next: BuyerLoc) => {
    setLocState(next);
    try {
      localStorage.setItem('padosi_loc', JSON.stringify(next));
    } catch {}
  }, []);

  // cart
  const [vendor, setVendor] = useState<CartVendor | null>(null);
  const [items, setItems] = useState<CartItem[]>([]);
  const hydrated = useRef(false);
  useEffect(() => {
    const saved = readLS<{ vendor: CartVendor | null; items: CartItem[] }>('padosi_cart');
    if (saved) {
      setVendor(saved.vendor);
      setItems(saved.items);
    }
    hydrated.current = true;
  }, []);
  useEffect(() => {
    if (!hydrated.current) return;
    try {
      localStorage.setItem('padosi_cart', JSON.stringify({ vendor, items }));
    } catch {}
  }, [vendor, items]);

  const sameVendor = (a: CartVendor | null, b: CartVendor) =>
    !!a && a.kind === b.kind && a.id === b.id;

  const add = useCallback<CartState['add']>(
    (v, item) => {
      let result: 'added' | 'conflict' = 'added';
      setItems((prev) => {
        if (vendor && !sameVendor(vendor, v) && prev.length > 0) {
          result = 'conflict';
          return prev;
        }
        const existing = prev.find((i) => i.id === item.id);
        if (existing) {
          return prev.map((i) =>
            i.id === item.id ? { ...i, qty: Math.min(i.qty + 1, i.maxQty) } : i,
          );
        }
        return [...prev, { ...item, qty: 1 }];
      });
      if (result === 'added') setVendor(v);
      return result;
    },
    [vendor],
  );

  const replaceWith = useCallback<CartState['replaceWith']>((v, item) => {
    setVendor(v);
    setItems([{ ...item, qty: 1 }]);
  }, []);

  const inc = useCallback((id: number) => {
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, qty: Math.min(i.qty + 1, i.maxQty) } : i)),
    );
  }, []);
  const dec = useCallback((id: number) => {
    setItems((prev) =>
      prev
        .map((i) => (i.id === id ? { ...i, qty: i.qty - 1 } : i))
        .filter((i) => i.qty > 0),
    );
  }, []);
  const clear = useCallback(() => {
    setVendor(null);
    setItems([]);
  }, []);

  const count = items.reduce((s, i) => s + i.qty, 0);
  const subtotalPaise = items.reduce((s, i) => s + i.qty * i.pricePaise, 0);

  const cartValue = useMemo(
    () => ({ vendor: count > 0 ? vendor : null, items, count, subtotalPaise, add, replaceWith, inc, dec, clear }),
    [vendor, items, count, subtotalPaise, add, replaceWith, inc, dec, clear],
  );
  const locValue = useMemo(
    () => ({
      loc,
      setLoc,
      pickerOpen,
      openPicker: () => setPickerOpen(true),
      closePicker: () => setPickerOpen(false),
    }),
    [loc, setLoc, pickerOpen],
  );

  return (
    <ToastCtx.Provider value={toast}>
      <LocationCtx.Provider value={locValue}>
        <CartCtx.Provider value={cartValue}>
          {children}
          {/* toast stack */}
          <div className="pointer-events-none fixed inset-x-0 top-16 z-[90] flex flex-col items-center gap-2 px-4">
            <AnimatePresence>
              {toasts.map((t) => (
                <motion.div
                  key={t.id}
                  initial={{ opacity: 0, y: -12, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -8, scale: 0.97 }}
                  transition={{ duration: 0.22 }}
                  className={`pointer-events-auto rounded-pill px-4 py-2 text-sm font-medium text-white shadow-lift ${
                    t.kind === 'err' ? 'bg-chili' : 'bg-leaf'
                  }`}
                >
                  {t.text}
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        </CartCtx.Provider>
      </LocationCtx.Provider>
    </ToastCtx.Provider>
  );
}
