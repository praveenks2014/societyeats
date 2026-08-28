export function formatINR(paise: number): string {
  const rupees = paise / 100;
  const formatted = rupees.toLocaleString('en-IN', {
    maximumFractionDigits: rupees % 1 === 0 ? 0 : 2,
    minimumFractionDigits: rupees % 1 === 0 ? 0 : 2,
  });
  return `₹${formatted}`;
}

export function pctOf(amountPaise: number, pct: number): number {
  return Math.round((amountPaise * pct) / 100);
}
