# Ron Cartel

Static storefront for Ron Cartel — grafted Sur-Ron performance parts.

| Page | What it is |
|---|---|
| `index.html` | Storefront — hero, ticker, product grid with In stock / Reserved / Sold states |
| `product.html` | Product detail — variant options, quantity, live price, dispatch countdown |
| `checkout.html` | Checkout — address → delivery → payment, unique payment reference, receipt |
| `admin.html` | Payment matching — paste a reference, mark the order paid |

Fonts (Archivo, JetBrains Mono) are self-hosted in `assets/fonts/`, so the site
makes zero external requests.

Deployed on Render as a static site (`render.yaml`).
