# Ron Cartel

Storefront and admin for Ron Cartel — grafted Sur-Ron builds.

Node + Hono + Postgres, server-rendered. Deployed on Render (`render.yaml`),
database on Neon.

## Running it

    DATABASE_URL=postgres://... node src/index.js

Migrations run automatically on boot. The first visit to `/admin` offers a
one-time setup page to create the single admin account; after that it is
closed and `/admin/*` requires a session.

## What's where

| Path | |
|---|---|
| `src/db.js` | pool, migrations, settings |
| `src/auth.js` | scrypt passwords, DB-backed sessions, the admin gate |
| `src/ui.js` | layout and shared markup helpers |
| `src/routes-public.js` | shop, product page, image serving |
| `src/routes-checkout.js` | checkout, order creation, order status |
| `src/routes-admin.js` | login, orders, products, settings |

## Notes

- Money is stored as integer pence everywhere and only formatted for display.
- Order totals are recomputed server-side; nothing the browser posts about
  price or delivery cost is trusted.
- `DATABASE_URL` is set in the Render dashboard, never committed.
