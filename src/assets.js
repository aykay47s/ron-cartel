/* Asset fingerprints.
 *
 * The stylesheet used to be served as /assets/app.css with a one-day cache
 * header, so a browser that had loaded the old one kept using it for up to
 * twenty-four hours after a deploy. Shipping a redesign and being told
 * "mine still looks the same" is the symptom.
 *
 * Every asset URL now carries a short hash of the file's contents. Change
 * the file, the URL changes, the browser fetches it. Nothing changes, the
 * URL is stable and the cached copy is reused. Hashes are read once at boot
 * because the files do not change while the process is running.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const ASSETS = new URL('../assets/', import.meta.url).pathname;
const cache = new Map();

export function asset(rel) {
  if (!cache.has(rel)) {
    const file = join(ASSETS, rel);
    let tag = 'x';
    if (existsSync(file)) {
      tag = createHash('sha1').update(readFileSync(file)).digest('hex').slice(0, 10);
    }
    cache.set(rel, `/assets/${rel}?v=${tag}`);
  }
  return cache.get(rel);
}
