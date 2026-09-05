import pg from 'pg';

const { Pool } = pg;

const URL_STR = process.env.DATABASE_URL || '';

/* Work out whether TLS is wanted from the host itself:
     Neon / any public host  -> has dots, needs TLS
     Render's internal host  -> bare name like "dpg-abc123-a", no TLS
     localhost               -> no TLS
   DB_SSL=on|off overrides it if a host ever breaks the pattern. */
function wantsSsl(urlStr) {
  const forced = (process.env.DB_SSL || '').toLowerCase();
  if (forced === 'on') return true;
  if (forced === 'off') return false;
  let host = '';
  try { host = new URL(urlStr).hostname; } catch { return false; }
  if (!host || host === 'localhost' || host === '127.0.0.1') return false;
  return host.includes('.');
}

export const pool = new Pool({
  connectionString: URL_STR,
  ssl: wantsSsl(URL_STR) ? { rejectUnauthorized: false } : false,
  max: 8,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on('error', (e) => console.error('[db] idle client error', e.message));

export const q = (text, params) => pool.query(text, params);
export const one = async (text, params) => (await pool.query(text, params)).rows[0] || null;
export const many = async (text, params) => (await pool.query(text, params)).rows;

const MIGRATIONS = [
  `create table if not exists admins (
     id serial primary key,
     email text unique not null,
     pass_hash text not null,
     created_at timestamptz not null default now()
   )`,
  `create table if not exists sessions (
     token text primary key,
     admin_id int not null references admins(id) on delete cascade,
     expires_at timestamptz not null,
     created_at timestamptz not null default now()
   )`,
  `create table if not exists settings (
     key text primary key,
     value text not null default ''
   )`,
  `create table if not exists images (
     id serial primary key,
     mime text not null,
     bytes bytea not null,
     created_at timestamptz not null default now()
   )`,
  `create table if not exists products (
     id serial primary key,
     name text not null,
     blurb text not null default '',
     body text not null default '',
     price_p int not null default 0,
     was_p int,
     deposit_p int,
     status text not null default 'stock',
     image_id int references images(id) on delete set null,
     position int not null default 0,
     created_at timestamptz not null default now()
   )`,
  `create table if not exists delivery_options (
     id serial primary key,
     label text not null,
     note text not null default '',
     price_p int not null default 0,
     is_collection boolean not null default false,
     enabled boolean not null default true,
     position int not null default 0
   )`,
  /* Delivery grew up: who carries it, where it goes, how long it takes.
     `zone` is 'GB', 'EU', 'WORLD' or a comma-separated ISO-2 list; checkout
     only offers an option the customer's country is actually in. */
  `alter table delivery_options add column if not exists courier text not null default ''`,
  `alter table delivery_options add column if not exists zone text not null default 'GB'`,
  `alter table delivery_options add column if not exists days_min int not null default 0`,
  `alter table delivery_options add column if not exists days_max int not null default 0`,
  `alter table delivery_options add column if not exists free_over_p int not null default 0`,
  `create table if not exists orders (
     id serial primary key,
     ref text unique not null,
     product_id int references products(id) on delete set null,
     product_name text not null,
     qty int not null default 1,
     unit_p int not null default 0,
     delivery_label text not null default '',
     delivery_p int not null default 0,
     total_p int not null default 0,
     is_deposit boolean not null default false,
     method text not null default 'bank',
     status text not null default 'awaiting',
     cust_name text not null default '',
     cust_email text not null default '',
     cust_phone text not null default '',
     address text not null default '',
     created_at timestamptz not null default now(),
     paid_at timestamptz
   )`,
  /* --- customer accounts, so buyers can track their own orders --- */
  `create table if not exists customers (
     id serial primary key,
     email text unique not null,
     pass_hash text not null,
     name text not null default '',
     phone text not null default '',
     address text not null default '',
     created_at timestamptz not null default now()
   )`,
  `create table if not exists customer_sessions (
     token text primary key,
     customer_id int not null references customers(id) on delete cascade,
     expires_at timestamptz not null,
     created_at timestamptz not null default now()
   )`,
  `alter table orders add column if not exists customer_id int references customers(id) on delete set null`,
  `alter table orders add column if not exists tracking_carrier text not null default ''`,
  `alter table orders add column if not exists tracking_number text not null default ''`,
  `alter table orders add column if not exists dispatched_at timestamptz`,
  `alter table orders add column if not exists note text not null default ''`,
  `alter table orders add column if not exists provider_ref text not null default ''`,

  /* --- buyer-uploaded proof of payment --- */
  `create table if not exists payment_proofs (
     id serial primary key,
     order_id int not null references orders(id) on delete cascade,
     image_id int references images(id) on delete set null,
     note text not null default '',
     created_at timestamptz not null default now()
   )`,

  /* --- a written history the customer can actually follow --- */
  `create table if not exists order_events (
     id serial primary key,
     order_id int not null references orders(id) on delete cascade,
     label text not null,
     detail text not null default '',
     created_at timestamptz not null default now()
   )`,
  `create index if not exists order_events_idx on order_events (order_id, created_at)`,
  `create index if not exists orders_customer_idx on orders (customer_id, created_at desc)`,
  `create index if not exists orders_status_idx on orders (status, created_at desc)`,
  /* Rate limiting that survives a restart, unlike an in-memory map. */
  `create table if not exists rate_hits (
     bucket text not null,
     at timestamptz not null default now()
   )`,
  `create index if not exists rate_hits_idx on rate_hits (bucket, at desc)`,
  `create index if not exists products_pos_idx on products (position, id)`,
  `alter table customers add column if not exists country text not null default 'GB'`,
  /* Live viewer counts. One row per (product, visitor); the visitor is a
     hash of IP + user agent + a salt that rolls daily, so nothing that
     identifies a person is stored and there is no cookie to consent to.
     Rows older than the window are swept on write. */
  `create table if not exists product_views (
     product_id int not null references products(id) on delete cascade,
     visitor text not null,
     seen_at timestamptz not null default now(),
     primary key (product_id, visitor)
   )`,
  `create index if not exists product_views_seen on product_views (seen_at)`,

  /* Two kinds of bike, kept apart on the shop page: builds we have grafted,
     and brand new ones out of the box. */
  `alter table products add column if not exists category text not null default 'grafted'`,

  /* Order updates carry a place now, so "where is it" has an answer. */
  `alter table order_events add column if not exists location text not null default ''`,
  /* Shops seeded before couriers existed showed "No courier" against a row
     that plainly said Royal Mail. Name them once; anything already set is
     left alone. */
  `update delivery_options set courier = 'royalmail'
     where courier = '' and label ilike '%royal mail%'`,
  `update delivery_options set courier = 'dpd'     where courier = '' and label ilike '%dpd%'`,
  `update delivery_options set courier = 'evri'    where courier = '' and label ilike '%evri%'`,
  `update delivery_options set courier = 'collect' where courier = '' and is_collection`,
];

/* Sensible defaults so a fresh shop is usable before anything is configured. */
const DEFAULT_SETTINGS = {
  shop_name: 'Ron Cartel',
  tagline: 'Grafted Sur-Ron builds from Manchester',
  bank_account_name: '',
  bank_sort: '',
  bank_number: '',
  paypal_address: '',
  paypal_note: 'Send as Friends & Family and put the reference in the message.',
  collection_note: 'The pickup address is sent once your payment clears.',
  hold_hours: '24',
  contact_email: '',
  /* Outbound email. Filled in from Settings — never committed. */
  smtp_host: '',
  smtp_port: '587',
  smtp_user: '',
  smtp_pass: '',
  smtp_from: '',
  emails_on: '',

  /* Business identity. UK distance selling requires a trader to give their
     name, a geographic address and contact details before a customer buys —
     and their absence is what makes a shop feel like a front. */
  legal_name: '',
  trading_address: '',
  contact_phone: '',
  vat_number: '',
  company_number: '',
  returns_days: '14',
  returns_note: '',
  privacy_note: '',
  terms_note: '',
  site_url: '',

  /* Pay by bank (open banking) via TrueLayer. */
  bank_pay_on: '',
  /* Crezco — open banking with no monthly fee and no per-payment fee on UK
     domestic transfers, which is the shape this shop needs. Kept separate
     from the TrueLayer keys so either can be used. */
  /* the hero, editable — the shop owner knows their own pitch */
  hero_line1: 'The cheapest grafted',
  hero_line2: 'Sur-Rons in the UK.',
  hero_blurb: 'Built and tested here, not pulled off a pallet and shipped on. '
            + 'Next-day UK delivery, or collect in person with a deposit.',
  hero_stat1_k: 'Top speed',  hero_stat1_v: '56mph',
  hero_stat2_k: 'Peak power', hero_stat2_v: '12.5kW',
  hero_stat3_k: 'Wheel torque', hero_stat3_v: '440Nm',
  hero_bike: 'Ultra Bee · 19\" front, 18\" rear',
  hero_r1: '56',  hero_r1k: 'mph',
  hero_r2: '12.5', hero_r2k: 'kW peak',
  hero_r3: '74V',  hero_r3k: '55Ah',
  hero_r4: '85',   hero_r4k: 'kg',

  /* a bar across the top of every page, for a drop or a delay */
  announce_on: '',
  announce_text: '',
  announce_link: '',

  /* sign in with Google */
  google_client_id: '',
  google_client_secret: '',

  bank_which: '',
  crezco_on: '',
  crezco_link: '',
  crezco_api_key: '',
  crezco_account: '',
  tl_env: 'sandbox',
  tl_client_id: '',
  tl_client_secret: '',
  tl_kid: '',
  tl_private_key: '',
  tl_merchant_id: '',
};

const DEFAULT_DELIVERY = [
  ['Royal Mail Tracked 24', 'Ordered before 2pm — arrives tomorrow, signed for', 699, false, 1, 'royalmail', 'GB', 1, 1],
  ['DPD Next Day', 'Live tracking with a one-hour window', 999, false, 2, 'dpd', 'GB', 1, 1],
  ['Royal Mail Tracked 48', 'Two to three working days', 349, false, 3, 'royalmail', 'GB', 2, 3],
  ['Collect in person', 'Free — a deposit reserves it', 0, true, 4, 'collect', 'GB', 0, 0],
];

export async function migrate() {
  for (const sql of MIGRATIONS) await q(sql);

  for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
    await q(
      `insert into settings (key, value) values ($1, $2)
       on conflict (key) do nothing`,
      [key, value]
    );
  }

  const { rows } = await q('select count(*)::int as n from delivery_options');
  if (rows[0].n === 0) {
    for (const [label, note, price_p, is_collection, position, courier, zone, dmin, dmax]
         of DEFAULT_DELIVERY) {
      await q(
        `insert into delivery_options
           (label, note, price_p, is_collection, position, courier, zone, days_min, days_max)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [label, note, price_p, is_collection, position, courier, zone, dmin, dmax]
      );
    }
  }
  console.log('[db] migrations applied');
}

export async function getSettings() {
  const rows = await many('select key, value from settings');
  const out = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return out;
}

export async function setSettings(patch) {
  for (const [key, value] of Object.entries(patch)) {
    await q(
      `insert into settings (key, value) values ($1,$2)
       on conflict (key) do update set value = excluded.value`,
      [key, String(value ?? '')]
    );
  }
}
