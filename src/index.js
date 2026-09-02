import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';
import { migrate, pool } from './db.js';
import { sessionFrom, readCookie, seedOwner, customerFrom, readCustomerCookie } from './auth.js';
import { publicRoutes } from './routes-public.js';
import { checkoutRoutes } from './routes-checkout.js';
import { adminRoutes } from './routes-admin.js';
import { customerRoutes } from './routes-customer.js';
import { layout, icon } from './ui.js';

const app = new Hono();
const ASSETS = new URL('../assets/', import.meta.url).pathname;
const MIME = {
  '.css': 'text/css; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.json': 'application/json',
};

/* Security headers. No inline styles are used, but the pages do carry small
   inline scripts, so script-src allows 'unsafe-inline' and nothing remote. */
app.use('*', async (c, next) => {
  await next();
  c.header('X-Content-Type-Options', 'nosniff');
  c.header('X-Frame-Options', 'DENY');
  c.header('Referrer-Policy', 'same-origin');
  c.header('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; " +
    "script-src 'self' 'unsafe-inline'; font-src 'self'; form-action 'self'; " +
    "frame-ancestors 'none'; base-uri 'none'");
});

/* Make the session available everywhere so the header can show who's in. */
app.use('*', async (c, next) => {
  const sess = await sessionFrom(readCookie(c)).catch(() => null);
  if (sess) c.set('admin', sess);
  const cust = await customerFrom(readCustomerCookie(c)).catch(() => null);
  if (cust) c.set('customer', cust);
  await next();
});

app.get('/assets/*', async (c) => {
  const rel = normalize(c.req.path.replace('/assets/', '')).replace(/^(\.\.[/\\])+/, '');
  const file = join(ASSETS, rel);
  if (!file.startsWith(ASSETS) || !existsSync(file)) return c.notFound();
  const body = await readFile(file);
  return new Response(body, {
    headers: {
      'content-type': MIME[extname(file)] || 'application/octet-stream',
      'cache-control': 'public, max-age=86400',
    },
  });
});

app.get('/healthz', (c) => c.text('ok'));

app.route('/', adminRoutes);
app.route('/', customerRoutes);
app.route('/', checkoutRoutes);
app.route('/', publicRoutes);

app.notFound((c) => c.html(layout({
  title: 'Not found',
  body: `<main class="shell"><div class="blank" style="margin:70px 0 100px">
    <div class="ico">${icon.bag}</div><h3>Nothing here</h3>
    <p>That page doesn't exist, or it has been taken down.</p>
    <a class="btn" href="/" style="display:inline-flex">Back to the shop</a></div></main>`,
  admin: c.get('admin'),
}), 404));

app.onError((err, c) => {
  console.error('[error]', c.req.method, c.req.path, err);
  return c.html(layout({
    title: 'Something broke',
    body: `<main class="shell"><div class="blank" style="margin:70px 0 100px">
      <div class="ico">${icon.bag}</div><h3>Something broke</h3>
      <p>That's on us. Try again, and if it keeps happening let us know.</p>
      <a class="btn" href="/" style="display:inline-flex">Back to the shop</a></div></main>`,
  }), 500);
});

const port = Number(process.env.PORT || 3000);

if (!process.env.DATABASE_URL) {
  console.error(
    '[boot] DATABASE_URL is not set.\n' +
    '       Add it in the Render dashboard under Environment, then redeploy.\n' +
    '       It looks like: postgresql://user:password@host/dbname?sslmode=require'
  );
  process.exit(1);
}

migrate()
  .then(seedOwner)
  .then(() => {
    serve({ fetch: app.fetch, port }, (info) => {
      console.log(`[ron-cartel] listening on :${info.port}`);
    });
  })
  .catch((e) => {
    // Print everything useful — an empty message here is impossible to debug.
    console.error('[boot] could not reach the database.');
    console.error('       message:', e.message || '(none)');
    if (e.code) console.error('       code:', e.code);
    if (e.severity) console.error('       severity:', e.severity);
    if (e.detail) console.error('       detail:', e.detail);
    if (e.cause) console.error('       cause:', e.cause.message || e.cause);
    console.error(e.stack);
    process.exit(1);
  });

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, async () => {
    console.log('[shutdown]', sig);
    await pool.end().catch(() => {});
    process.exit(0);
  });
}
