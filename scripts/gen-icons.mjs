/** npm run icons — rasterises public/icon*.svg into the PNG sizes the manifest references. */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const pub = path.join(process.cwd(), 'public');
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
