/**
 * npm run icons:generate — rebuilds every brand image from src/config/brand.json:
 *   public/icon.svg, icon-maskable.svg   a monogram of the name's first letter on the brand green
 *   public/wordmark.svg                  the text wordmark
 *   public/icon-192.png, icon-512.png, icon-maskable-512.png, apple-touch-icon.png   rasterised from the SVGs
 * Colours are the design tokens in tailwind.config.ts (leaf, turmeric, rice). The letter K is drawn as a path (no font needed); other
 * initials fall back to text, which needs a system font when rasterising.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const pub = path.join(process.cwd(), 'public');
const { name } = JSON.parse(fs.readFileSync(path.join(process.cwd(), 'src', 'config', 'brand.json'), 'utf8'));
const LEAF = '#1E4D2B';
const TURMERIC = '#E8A020';
const RICE = '#FBF7F0';
const initial = name.trim().charAt(0).toUpperCase();

// A bold "K": stem and two arms, drawn in a 512 box.
const glyph =
  initial === 'K'
    ? `<path d="M178 118 V394" stroke="${RICE}" stroke-width="58" stroke-linecap="round" fill="none"/>
    <path d="M196 276 L352 122" stroke="${TURMERIC}" stroke-width="58" stroke-linecap="round" fill="none"/>
    <path d="M232 238 L356 394" stroke="${RICE}" stroke-width="58" stroke-linecap="round" fill="none"/>`
    : `<text x="256" y="372" text-anchor="middle" font-family="Bricolage Grotesque, Inter, system-ui, sans-serif" font-size="300" font-weight="700" fill="${RICE}">${initial}</text>`;

const icon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="112" fill="${LEAF}"/>
  ${glyph}
</svg>
`;
const maskable = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${LEAF}"/>
  <g transform="translate(256 256) scale(0.72) translate(-256 -256)">
    ${glyph}
  </g>
</svg>
`;
const rest = name.slice(1);
const wordmark = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 120" role="img" aria-label="${name}">
  <g transform="translate(8 8) scale(0.2)">
    <rect width="512" height="512" rx="112" fill="${LEAF}"/>
    ${glyph}
  </g>
  <text x="128" y="78" font-family="Bricolage Grotesque, Inter, system-ui, sans-serif" font-size="64" font-weight="700" fill="${LEAF}" letter-spacing="-1.5">${initial}<tspan fill="${TURMERIC}">${rest}</tspan></text>
</svg>
`;
fs.writeFileSync(path.join(pub, 'icon.svg'), icon);
fs.writeFileSync(path.join(pub, 'icon-maskable.svg'), maskable);
fs.writeFileSync(path.join(pub, 'wordmark.svg'), wordmark);
console.log('wrote icon.svg, icon-maskable.svg, wordmark.svg');

const jobs = [
  ['icon.svg', 'icon-192.png', 192],
  ['icon.svg', 'icon-512.png', 512],
  ['icon-maskable.svg', 'icon-maskable-512.png', 512],
  ['icon.svg', 'apple-touch-icon.png', 180],
];
for (const [src, out, size] of jobs) {
  await sharp(fs.readFileSync(path.join(pub, src)), { density: 384 }).resize(size, size).png().toFile(path.join(pub, out));
  console.log('wrote', out);
}
