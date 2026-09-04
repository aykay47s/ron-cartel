/* How many people are actually looking at this bike right now.
 *
 * Real numbers only. A made-up "23 people viewing" is a false statement about
 * consumer interest — banned outright by the UK Consumer Protection from
 * Unfair Trading Regulations and now the DMCC Act — and it is the single
 * fastest way to make a small shop look like a scam to anyone who refreshes
 * twice and watches the number move at random.
 *
 * So this counts. When two or more people genuinely are on the same listing,
 * it says so, and that carries weight precisely because it is true.
 *
 * Privacy: the visitor key is a hash of IP + user agent + a salt that rolls
 * every day. It cannot be reversed to a person, it cannot follow anyone
 * between days, and there is no cookie — so nothing here needs consent.
 */
import { createHash, randomBytes } from 'node:crypto';
import { q, one } from './db.js';

/* Minutes a view stays "live". Long enough to cover someone reading the
   spec list, short enough that the number means what it says. */
const WINDOW_MIN = 4;

let salt = randomBytes(16).toString('hex');
let saltDay = new Date().toISOString().slice(0, 10);

function visitorKey(c) {
  const today = new Date().toISOString().slice(0, 10);
  if (today !== saltDay) { salt = randomBytes(16).toString('hex'); saltDay = today; }
  const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim()
          || c.req.header('x-real-ip') || 'local';
  const ua = c.req.header('user-agent') || '';
  return createHash('sha256').update(ip + '|' + ua + '|' + salt).digest('hex').slice(0, 24);
}

/* Record that someone is here, then say how many others are. Never lets a
   counting problem take a product page down with it. */
export async function seen(c, productId) {
  try {
    await q(
      `insert into product_views (product_id, visitor, seen_at)
       values ($1, $2, now())
       on conflict (product_id, visitor) do update set seen_at = now()`,
      [productId, visitorKey(c)]
    );
    /* Sweep occasionally rather than on every hit — the table is tiny and
       this keeps the common path to a single write. */
    if (Math.random() < 0.05) {
      await q(`delete from product_views where seen_at < now() - interval '1 hour'`);
    }
    const r = await one(
      `select count(*)::int as n from product_views
        where product_id = $1 and seen_at > now() - interval '${WINDOW_MIN} minutes'`,
      [productId]
    );
    return r ? r.n : 0;
  } catch {
    return 0;
  }
}

/* "3 people are looking at this right now."
   One viewer is the person reading it, so that says nothing and shows nothing. */
export function viewerLine(n) {
  if (!n || n < 2) return '';
  return `${n} people are looking at this right now`;
}
