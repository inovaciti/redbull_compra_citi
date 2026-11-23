# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Red Bull PDV: a mobile self-checkout for selling Red Bull, backed by FastAPI + PostgreSQL, with real Pix charges via Mercado Pago — the only provider (there is no mock/simulated mode; locally use the integration's test credentials; deploy target is Railway, see README). Comments, docstrings, and log messages in this codebase are written in Portuguese — keep that convention when editing existing files.

## Commands

```bash
# Setup
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements-dev.txt   # requirements.txt = production only
docker compose up -d postgres
alembic upgrade head

# Run the app (http://127.0.0.1:8000, docs at /docs)
uvicorn app.main:app --reload

# Tests (uses TEST_DATABASE_URL only, never DATABASE_URL — see below)
docker compose up -d postgres_test
pytest
pytest tests/test_payment_service.py            # single file
pytest tests/test_payment_service.py::test_name  # single test

# Migrations
alembic current
alembic heads
alembic upgrade head
alembic downgrade -1

# Manual reconciliation for a stuck order (dry-run first, always)
python -m scripts.reconcile_payment --order-id UUID_DO_PEDIDO --dry-run
python -m scripts.reconcile_payment --provider-order-id ID_DA_ORDER --dry-run
```

There is no lint/format command configured in this repo (no ruff/black/mypy config present).

## Architecture

### Request flow

`app/main.py` wires FastAPI routes to two layers:
- `app/store.py` (`DatabaseStore`) — plain CRUD/read paths: listing products, price tiers, fetching an order.
- `app/payment_service.py` — all state-changing payment/order logic. This is where the real business rules live (reservation, charge creation, webhook processing, expiration, reconciliation, cancellation). Route handlers are thin; put new business logic here, not in `main.py`.

`app/payments.py` defines the `PaymentProvider` protocol and its only implementation, `MercadoPagoProvider` (real Pix charges via Mercado Pago's Orders API). `create_payment_provider(settings)` validates the config (both `MERCADOPAGO_*` credentials are mandatory; startup fails without them) and the `lifespan` in `main.py` stores the provider on `app.state.payment_provider` — unless one is already there, which is how the tests inject `tests/fakes.FakePixProvider`. The expiration loop reads the provider from `app.state`. `PaymentProvider.MOCK` survives only as a legacy enum value: migration `b7f2e6c9a104` backfilled old payments with it, so it must stay in the Python enum and the DB type; nothing creates new MOCK rows. There are no `/api/mock/*` routes. `/docs`/`/openapi.json` exist only with `API_DOCS=1`; logging is configured in `main.py` (`LOG_LEVEL`).

`app/models.py` holds the Pydantic API schemas and shared enums (`OrderStatus`, `PaymentStatus`, `ReservationStatus`, etc.); `app/db/models.py` holds the SQLAlchemy ORM models. Keep these in sync manually — they are separate layers by design (API contract vs. persistence).

### Payment/order state machine (the core of this codebase)

Every order carries three parallel states that must stay consistent inside single transactions:
- `Order.status`: `PENDING` → `PAID` / `CANCELLED`
- `Payment.status`: `CREATING` → `WAITING_PAYMENT` → `APPROVED` / `EXPIRED` / `CANCELLED` / `FAILED`
- `Order.reservation_status` (stock hold): `ACTIVE` → `CONSUMED` (on payment) / `RELEASED` (on cancel/expire)

All transitions in `payment_service.py` follow the same pattern: `SELECT ... FOR UPDATE` on `OrderORM`/`PaymentORM` (and `ProductORM` when touching stock) inside `db.begin()`, re-check the current state (never assume it hasn't changed since the caller last read it), then mutate. This defends against concurrent webhook deliveries, expiration sweeps, and manual reconciliation racing each other.

Key entry points and what they do:
- `create_order_with_payment` — reserves stock (`store.reserve_order`) then creates the charge (`ensure_order_payment`).
- `process_mercadopago_payment` — the single choke point for confirming a payment, called from the webhook handler, from `cancel_order_payment` (when a cancel races an approval), from periodic reconciliation, and from the expiration sweep. It is idempotent: recorded via `WebhookEventORM` (unique on `(provider, event_id)`), and it re-derives outcome from current DB + provider state rather than trusting caller intent. It handles the "late approval" case (payment approved after the reservation was already released) by re-checking unreserved stock and flagging a `ManualReview` when there's a conflict, instead of silently overselling.
- `expire_due_payments` — runs on a background asyncio loop (`_expiration_loop` in `main.py`, interval = `PAYMENT_EXPIRATION_CHECK_INTERVAL`). Before expiring anything it reconciles pending Mercado Pago payments first, so a late webhook/slow poll doesn't get incorrectly expired.
- `cancel_order_payment` — cancels at the provider, then locally; if provider cancellation fails, it re-queries the provider and runs it back through `process_mercadopago_payment` in case the payment was actually approved in the meantime.
- Ambiguous states (amount mismatch, missing `approved_at`, stock conflict on a late approval, reservation not active, payment after cancellation) are never silently resolved — they're written to `manual_reviews` via `_flag_manual_review` for a human to check. See `ManualReviewReason` in `app/models.py`.

**Never fix `orders.status` or decrement stock directly via SQL.** Use `scripts/reconcile_payment.py`, which reuses the same transactional `process_mercadopago_payment` function as the webhook. Read-only diagnostic queries live in `docs/payment_diagnostics.sql`.

### Payer email

The payer's email is never an environment variable (don't add `MERCADO_PAYER_EMAIL` / `MERCADOPAGO_PAYER_EMAIL`). Each buyer enters their own email at checkout; it's validated client- and server-side, normalized (`normalize_payer_email` in `app/models.py`), and persisted to `orders.payer_email`. Older rows may have `NULL` here. Charge creation uses exclusively the email stored on the order (`payer.email`), never a config value.

### Webhook security

`POST /api/webhooks/mercadopago` validates `x-signature`/`x-request-id` against `MERCADOPAGO_WEBHOOK_SECRET` (`verify_mercadopago_signature` in `app/payments.py`) using the `data.id` query param as the payload for the signature — not the request body. The body is optional and only used for extra event metadata. Never log tokens, signatures, QR codes, copy-paste Pix strings, or full emails.

### Database / Alembic

This service's ORM does **not** own the whole database: `users` and `stock_adjustments` are external tables that must be preserved, along with legacy columns `products.description`, `products.color`, `products.price` that exist in some installs but not the institutional DB. These are excluded from autogenerate via `UNMANAGED_TABLES` / `include_object` in `app/db/migrations/env.py` — do not remove that filter, and do not let autogenerate propose dropping them.

Before touching migrations in a real deployment, always run, in order: `alembic current`, `alembic heads`, confirm a backup exists, test upgrade+downgrade against a copy/test DB, verify `users`/`stock_adjustments` are untouched, then apply. Never run `alembic stamp head`, and never apply a migration against the institutional DB without explicit authorization. Full history/rationale for past migration surprises is in `docs/alteracoes-recentes.md`.

### Tests

`tests/conftest.py` enforces that tests use `TEST_DATABASE_URL` exclusively — it's validated to use the `postgresql+asyncpg` driver, to have a database name starting with `test` or ending in `_test`, and to differ from `DATABASE_URL`; the harness refuses to run otherwise. It force-runs `alembic upgrade head` against that database as a session-scoped autouse fixture, sets dummy `MERCADOPAGO_*` credentials before any app module is imported, and an autouse fixture (`pix_provider`) puts a fresh `FakePixProvider` on `app.state` for every test. Payments are confirmed through the real path with `tests.fakes.pay_via_webhook` (provider says approved + signed webhook).

### Pricing audience

Who pays member prices is decided server-side from the payer's email: `OrderCreate.pricing_audience` is a read-only property backed by `pricing_audience_for_email` in `app/models.py` (exact domain `citi.org.br` → `MEMBER`, anything else → `NON_MEMBER`). The order payload rejects any extra field (`extra="forbid"`): the client sends only products, quantities, name and email — never a price, total or audience.

### Prices are fixed

The price table is hard-coded in `app/pricing.py` and nowhere else is editable: members 1 can R$ 8,50 · 2–3 cans R$ 8,00 each · 4+ R$ 7,50 each (by total order quantity, all flavors summed: 1/2/3/4 = 8,50/16/24/30); non-members R$ 12,00 per can, always. There is no price table in the database and no endpoint/panel to change prices (`GET /api/price-tiers` and the panel's `GET /api/estoque/precos` only display the code table). Defense in depth: `store.reserve_order` prices from `app/pricing.py`; `payment_service._ensure_fixed_price` re-checks the order before creating any charge; and migration `d8a4f2c61e37` adds `fn_expected_unit_price` plus deferred constraint triggers that make PostgreSQL reject any order/item insert or update whose unit price, subtotal, total or audience (vs. email domain) is off the table — even via manual SQL. Changing a price therefore means changing `app/pricing.py`, a new migration replacing `fn_expected_unit_price`, and `tests/test_pricing.py` together (`test_database_price_rule_matches_code` fails if code and DB disagree). Old orders keep their recorded `order_items.unit_price` and are not re-validated unless their price columns are written.

### Frontend

- **Store (`/`)**: `app/templates/loja.html`, served by `store_page` in `app/main.py` with a strict CSP (`STORE_PAGE_HEADERS`: no inline script/style, no external hosts, `img-src data: blob:` for the liquid-glass effect, `connect-src blob:` for textures embedded in the GLBs). The UI is vanilla ES modules under `app/static/storefront/` (no build step): `src/pdv.js` is the platform entry point (loads `/api/products` + both `/api/price-tiers` + the remembered buyer `/api/comprador`, mounts the store with the payment adapter `src/checkout-api.js`), `src/storefront.js` + `src/ui/*` are the design's components, `src/data/flavors.js` maps DB product ids to the 3D can model/photo/colors/order, `src/pricing.js` mirrors the backend tier rule for display only.
- **Delivery** (`app/storefront_assets.py`): `/` renders `loja.html` pointing every store asset to `/static/v/<version>/storefront/…` (version = hash of path/size/mtime of all store files, so any edit busts the cache automatically; no build step), served with `Cache-Control: immutable` and a precomputed gzip copy (system temp dir, warmed at startup). `modulepreload` links for the UI module graph are generated from disk; the 3D scene is `import()`ed on demand so the UI never waits for Three.js. `loja.html` preloads the API calls, the first-frame fonts and the first can photo. Plain `/static/...` still works (used by the `/estoque` panel). Section 11 of `docs/refatoracao-frontend.md` has the measurements and what was deliberately not changed.
- **Loading** (`src/boot.js`, `assets/styles/boot.css`, block at the top of `loja.html`, images in `assets/loading/`): the dark fridge with the LED "worm" paints instantly (HTML+CSS+image, before any script); act 1 lands it where the 3D will appear (`fridgeLayoutRect` in `src/scene/cooler-frame.js`, Three.js-free, shared with the scene's camera math) and brings in the UI; act 2 lights the 3D under it and wipes the image away. Everything that animates is transform/opacity (compositor); the 3D is mounted only after landing (`fridge.after`) and stays `hold` (no redraws, no bob) until the wipe ends. Images, worm mask/keyframes and sizes are generated from the real engine by `node tools/render-boot-poster.mjs` — rerun it whenever the cooler, its framing or the LED change. Details and deviations from the package: section 12 of `docs/refatoracao-frontend.md`.
- **3D fridge**: the Mini Cooler kit (`app/static/storefront/cooler/`: engine script, artwork, one GLB per flavor, HDR) driven by `src/scene/cooler-scene.js` (stock shown = stock − cart − in flight, max 25; exact-can pick, flights to the cart, gravity restock, door, cart focus), `cooler-stock.js` (GLB loading/instancing — only resting cans live in the instances, kept contiguous with `count` = cans present; never go back to fixed-capacity instances hidden with zero-scale matrices, that multiplied the GPU vertex work by the number of loaded flavors, see section 11.5 of the doc), `cooler-cabinet.js` (kit artwork) and `glass-condensation.js` (fogged door glass with live droplets — the `vidro-condensacao` package file plus only the `veil` option from the loading package, SHA-256 `9d9508f8…`; do not edit it otherwise, its numbers define the approved look). Details, kit-specific adjustments and how to update the kit: section 10 of `docs/refatoracao-frontend.md`.
- **Buyer identification** (pacote `identificacao-carrinho`, seção 13 de `docs/refatoracao-frontend.md`): a second step inside the cart drawer ("Finalizar Compra" → name, surname, e-mail → "Confirmar Pedido" → Pix step, with `order.customer = {firstName, lastName, email, member}`). There is no other identification screen. `src/core/membership.js` (valid e-mail, member = exact `@citi.org.br`, live capitalization `capitalizeTyping`, `tidyName`, `NAME_MAX` 40+39 so `"Nome Sobrenome"` fits `buyer_name`'s 80 chars) and `src/core/email-hint.js` (offline typo suggestion: "gmial.com", ".con", "citi.org"…) are display-side only — the backend still prices from the e-mail. The buyer is remembered on the device by `app/buyer_memory.py` (`GET`/`PUT /api/comprador`, server-set `HttpOnly` cookie `rb_comprador`, `Path=/api/comprador`, 400 days, renewed on each visit; written only after the server accepts the order; nothing in the DB) — deliberately not `localStorage`, which Safari wipes after 7 days without a visit. Never log the cookie's content.
- **Payment (Pix)** (seção 14 de `docs/refatoracao-frontend.md`): the third step of the same drawer. `src/checkout-api.js` (platform) talks to `POST /api/orders`, `GET /api/orders/{id}`, `POST /api/orders/{id}/cancel` and `/api/products`, turns the server `Order` into the store's `Charge` and failures into `CheckoutError.reason` (`stock`/`invalid`/`conflict`/`provider`/`network`); `mountStorefront` requires it as `options.payment`. `src/core/payment-watch.js` polls every 2.5 s (one request at a time, stale responses dropped, immediate re-check when the page becomes visible again); `src/ui/payment-page.js` + `assets/styles/payment.css` render QR (`/api/orders/{id}/qr`), countdown to `expires_at` (corrected by the server `Date` header; the server expires, the UI only re-checks at zero) as plain digits plus a hand clock (`src/ui/payment-clock.js`: minute hand = minutes left, second hand = seconds, quartz-style tick with a small overshoot, only the clock icon moves; digits have no effect), copy-paste code, two-tap cancel and the final screens. The payment step is deliberately neutral white/grey — no blue, no flavor tint, no QR scan effect, no status dot. While a charge is pending the drawer cannot be closed (no X/Esc/veil/drag). Paid → "Concluir" empties the cart; cancelled/expired/failed and a `409` on create put the cans back in the cart after re-reading stock (fewer cans → quantity reduced; sold out → greyed line outside the total). Stock is store state (`state.stock`), not `flavor.stock`.
- **Device tier / weak phones** (seção 15 de `docs/refatoracao-frontend.md`): `src/device-tier.js` (Three-free) runs in `pdv.js` before anything 3D is fetched and returns `full`, `low` (engine `quality:'low'`) or `none` (no WebGL2 / software or very old GPU / <2 GB / save-data / 2G / reduced-data). `none` never imports the scene: the boot poster (fogged fridge image) stays, `html.is-lite` swaps backdrop-filter glass for flat translucent layers (`assets/styles/lite.css`) and disables liquid-glass refraction; `.app.no-3d` hides door/recenter whenever there is no scene. `?3d=0|low|1` forces a tier. Safari reports no memory/cores, so iPhones stay `full`.
- **Stock panel (`/estoque`)**: still the legacy UI (`app/templates/estoque.html` + `app/static/estoque/`); its can photos come from `app/static/storefront/assets/images/cans/`.
- **UI test**: `npm run test:ui` (`tools/ui-smoke-test.mjs`, Playwright) boots uvicorn, stubs the product/price API and checks 11 viewport sizes for layout, pricing, stock limits, JS errors and CSP violations. `responsive.css` holds the layouts beyond the design's two breakpoints (landscape phones, very large screens).

#### Frontend rewrite in progress

The store page has been replaced (phase 1), the buyer identification is in (phase 2a) and the Pix payment is wired (phase 2b). Still to come, in the new design: the new `/estoque` panel (phase 3). Before deploying, do a real test purchase with Mercado Pago on Railway and check on a real phone — the payment flow has only run against test fakes (`tests/fakes.py`, the UI test's stubbed API). Inventory, the behavior contract, the list of local patches applied on top of the design export, and the removal log live in `docs/refatoracao-frontend.md` — read it before touching anything under `app/static/`, `app/templates/` or the frontend tests.

Standing rule: as each piece of the new UI is wired in, delete its legacy counterpart in the same change — HTML blocks, JS functions, CSS rules, assets, tests and doc mentions — even if it looks unused. No commented-out code, no compatibility shims, no "remove later" TODOs. Before deleting, grep for ids/classes/function names/asset filenames across `app/`, `tests/`, `docs/`, `README.md` and `CLAUDE.md` (ignore `.venv/`, `node_modules/`, `entrega_estoque/`, `Claude outputs/`); shared items (e.g. `app/static/assets/logo-citi-transparent.png`, still used by the panel) go only when nothing references them anymore. Log each removal in the table at the end of that doc. There is no git in this folder: the pre-refactor backup tarball (path in the doc) is the only way back, so never delete legacy code that has no new counterpart wired in yet. The panel's CSP (`PANEL_PAGE_HEADERS` in `app/stock_panel.py`) forbids inline scripts/styles and external hosts — keep new panel assets self-hosted or change the CSP deliberately. When the rewrite is done, update this Frontend section and delete the doc.
