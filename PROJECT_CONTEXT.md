# PROJECT_CONTEXT.md - Galago Admin

This file exists to quickly onboard a coding model (Codex, Claude Code, etc.) to the real state of the project.

## What this app is

### Courier settlement email reconciliation, 2026-11-17

- The original daily 07:00 mailbox worker reads `cs@expressone.ba` status notifications, which mostly contain delivery problems/returns. It did not read the daily remittance spreadsheets sent by `danira.borovina@expressone.ba`; this caused settled orders to remain active.
- `expressone-settlements.ts` now shares the Express One scheduler but has its own persistent lease/checkpoint, runs daily at 15:00 Sarajevo (after the morning reports arrive), catches up on startup and retries failed runs after one hour. `Provjeri statuse` also queues a report scan. No new paid API or AI call is involved.
- Only exact `expressone.ba` mailbox senders, GALAGO remittance subjects, GALAGO XLS/XLSX attachments and GALAGO sender rows are accepted. Initial scan starts at the live-work date; subsequent scans use a seven-day overlap and persistent message/file-hash checkpoints. A multi-attachment message is checkpointed only after all its attachments succeed.
- Report `datum_slanja` mixes US month.day.year text with locale-swapped Excel date serials. Both plausible serial-date interpretations are compared against the full order history; ambiguous matches are never auto-applied. Orders use next-workday cycle labels, including weekends. Truncated `broj_posiljke` numbers in these spreadsheets are NOT treated as reliable tracking IDs.
- Automatic settlement requires one exact normalized full name, full COD amount, compatible shipping window and matching product or city; conflicting product families, returns, repeat-buyer ambiguity and partial/zero amounts stay unresolved. Closed orders participate in matching to prevent an old remittance from closing a new purchase. Full-order COD remittance can clear a multi-package financial balance; it is not inferred from one parcel's tracking status.
- Confirmed rows use the existing idempotent Delivered orders archive plus Orders hidden L status and P checkbox; no source rows are deleted. Source identity is revalidated and re-read after writes. Applied reports never re-close restored/copied orders. SQLite keeps report and row provenance for audit.
- Na dostavi exposes the last mailbox processing/report timestamps and failures. Its balance still includes new unshipped orders by prior user request, so it is an estimated COD balance, not a bank remittance receivable.
- Tests: `test:settlements`, `test:expressone`, `test:courier`, `test:delivery-overview`.

### Current scope, 2026-11-16

- Navigation now contains Nove narudzbe, Na dostavi, Povrati, Reklamacije and Uvozi.
- Pregled, Reklame, Statistika, Lager and Racuni are retired by explicit user request. Their old URLs redirect to `/orders` without fetching data; `/` also redirects there. Their UI components and mutation actions were removed.
- Removed Lager's periodic Shopify sync and full-catalog refresh from product/inventory webhooks. Keep Ananas/Bazzar integration jobs, including the Bedly inventory ledger, intact. Historical inventory and receipt records/files remain; already-issued signed receipt links continue to work.
- Google Ads sync and authenticated reporting APIs remain. Meta account-level spend is now saved hourly for today and the preceding two days in `meta_daily_spend`, without rendering profitability/ranking dashboards. Failed fetches preserve previous results. No schedulers run during production builds.
- Uvozi (`/imports`) reads Galago bank transactions from Nalto through a private CLI-only, SELECT-only PHP bridge on the same host. Nalto is never mutated. Settings use `NALTO_APP_PATH`, `NALTO_COMPANY_ID`, `NALTO_PHP_BINARY`, or the persistent private `storage/data/import-payments-source.json` with `appPath`, `companyId`, `phpBinary`.
- Sync runs at most every six hours, with manual refresh at most once per minute. Rendering Uvozi reads local SQLite only. Source IDs make re-sync idempotent, and saved allocations survive re-sync/redeploy.
- Supplier payments and bank fees are separate; BAM/EUR/USD are never added together. Intesa account 50 funding and FX conversions must not be counted again as supplier payments. Account 53 outflows use the ORIGINAL statement PDF, including continuation lines, to identify Tadex/SHENGFENG. Matching requires the exact bank order reference, account, currency, debit amount and date, never just a nearby fee/similar amount. Garma is excluded from tracking and UI by explicit user request. Unresolved records remain unconfirmed, never attributed speculatively.
- Parsed statement rows are cached in `import_bank_documents` by file ID/hash. The private Nalto bridge omits unchanged PDF bytes; only new/changed statements are parsed in bounded subprocess batches. Source and PDF process execution uses the callback contract because Hostinger wrappers drop `execFile`'s custom promisify symbol. Failed sync preserves the previous snapshot and retries on the next eligible scheduler tick (15-minute failure cooldown, not six hours).
- Staff create container/import labels, edit notes/status, split payments across containers and undo allocations. Integer minor units, immediate DB transactions and request IDs prevent over-allocation/retry duplication. Containers with allocations cannot be deleted until those allocations are removed. Missing or materially changed allocated source rows are retained for review and excluded from confirmed totals.
- Each container can have one confirmed supplier PDF invoice. Upload parses digital PDF text in a time/memory-bounded Node subprocess, max 10 MB / 20 pages, without AI/API costs. Final TOTAL is distinguished from Goods Total/subtotals; ambiguous/scanned documents require manual total/currency. Staff confirm/edit the target before it affects progress. Estimated freight warnings remain visible in the invoice editor.
- Invoice progress counts only available allocated principal payments matching the invoice supplier AND currency. Fees, other currencies, other suppliers and changed source records never reduce the remaining balance. Overpayments are shown explicitly; progress bars cap at 100%. Originals are private 0600 files under `storage/import-invoices`, served only by authenticated routes. Replacing/unlinking a target retains the original document/audit and never removes bank allocations.
- Tests: `test:imports`, `test:backend-retirement`; local browser regression `scripts/test-imports-browser.cjs` uses synthetic isolated data and never writes production.
- Older sections below describe the historical retired workflows, not permission to restore them.

`store-admin` is a mobile-first web admin app for operations around incoming customer orders.

Core channels feeding the system:
- Shopify orders
- Telegram intake bot
- Google Sheets operational workflow

## Core product direction

This project pivoted away from older PDF-oriented workflows and into:
- Google Sheets as operational source of truth
- lightweight admin dashboard
- Telegram bot intake
- Shopify import into Sheets

The app is now mainly:
- dashboard
- delivery operations view
- Google Sheets-based control panel

It is **not** intended to be the main place where a human manually types orders.

## Source of truth

### Bedly Ananas integration (2026-10-23)

- Ananas production uses the existing Galago merchant account. Bedly is a second catalog source restricted to two pillows; pajamas and blankets are excluded.
- Bedly prices, descriptions and images come from the documented Shopify Ajax Product API at `bedly.ba`. Each fetch verifies BAM currency. No new Shopify credentials or permissions are needed for this public product data.
- Bedly stock comes from the Administrator panel's `inventory_products`, not Shopify stock: SKU `16` is Bedly ergonomski jastuk; SKU `17` is Bedly cloud jastuk. Exact SKU/name matching is mandatory.
- Cloud is a **set of two** sold at the Shopify product price (49 BAM at setup). Ananas stock is `floor(admin quantity / 2)`: 298 pillows = 149 sets. Confirmed Ananas sales automatically deduct two physical pillows per set; staff must NOT deduct these same sales again.
- Ergonomski is one pillow per sales unit (295 available at setup, regular 98 BAM / sale 49 BAM).
- Bedly mapping IDs and external IDs use `bedly:` prefixes. Merchant SKUs are `BEDLY-16` and `BEDLY-17-SET2`. Stable internal EANs follow the existing `20` + variant suffix + check digit convention, not GS1 assignments.
- Both Shopify weights are unset; the existing Ananas configured 1 kg package fallback is used until actual packed weights are supplied.
- Existing scheduled reconciliations include both sources and continue Galago even if Bedly fails. Targeted runs accept `source: "bedly"`; authenticated status `?source=bedly` previews only these products and their saved links.
- `ANANAS_BEDLY_ENABLED=false` disables Bedly fetching/sync. Never add Bedly to `getShopifyProductsForAnanas`: that function also powers the separate Galago → local Lager flow.
- User explicitly requested automatic stock deductions. The existing Ananas internal scheduler polls orders every 5 minutes, starting from 2026-10-23. Only exact Bedly SKU + EAN matches are processed, using shipment-confirmed quantities (Cloud ×2, Ergonomski ×1). Galago orders are untouched. It does not confirm, pack or ship orders automatically and does not write Shopify inventory.
- `bedly_ananas_order_stock` and `bedly_ananas_stock_movements` provide a transactional, restart-safe consumption ledger and audit. Pre-dispatch cancellations/reduced confirmations restore only previously deducted stock, once. Once a dispatched/unknown/return/damaged/lost status has been observed, reductions never auto-restock: physical returns require staff verification and a manual stock adjustment. Negative Admin balances remain visible (marketplace availability clamps to zero).
- Order polling re-reads the activation window to detect late cancellations. Persistent DB lease prevents concurrent stale writes; API errors preserve stock and are recorded in `bedly_ananas_order_state`. Daily Bedly price/stock export checks order sync first. Authenticated `POST /api/integrations/ananas/run` action `bedly-orders` triggers a check; `GET .../status?source=bedly` includes sync health. `ANANAS_BEDLY_ORDER_SYNC_ENABLED=false` pauses deductions independently.

### Bazzar Galago XML integration (2026-10-24)

- User explicitly requested production XML implementation after confirming Bazzar margin = 15% of actual VAT-inclusive selling price. Bazzar confirmed BAM, net `vendor_price`, both retail prices visible, twice-daily polling, zero-stock/removal deactivation, and manual listing review.
- `vendor_price = Shopify price × 0.85 / 1.17`, rounded once to two decimals. `retail_price` uses compare-at only when higher than current price; `discounted_retail_price` is current price in that case and is omitted otherwise. Retail values include VAT 17%. Never calculate vendor price from the crossed-out price during a sale.
- `/api/integrations/bazzar/feed.xml?token=...` reads fresh Galago Shopify data on every authorized GET. Validates configured store `wktcnu-i5.myshopify.com` and BAM; only active Galago/Galago.ba-branded products, including zero stock. Bedly is excluded. One stable offer per Shopify variant (`GALAGO-<variant ID>`), no mutable SKU identity or grouped-price assumption.
- Uses the published schema at https://bazzar.ba/pages/xml-sync-documentation. Optional weights are actual Shopify weights converted to grams, omitted with warnings if missing; never invent furniture shipping weights. Original EANs, descriptions, images and product-type categories are carried over. No undocumented sale-date tags; this feed follows actual current storefront prices, not Ananas scheduling metafields.
- Auth token is independent of Ananas/Shopify credentials, generated once (0600) in persistent `storage/data/bazzar-feed-secret`, or overridden by `BAZZAR_FEED_TOKEN` (32+ chars). `BAZZAR_FEED_ENABLED=false` pauses with 503, not an empty catalog. Do not expose the URL/token publicly or in logs.
- Errors, invalid/duplicate catalog items and empty catalogs return HTTP 503, never partial/empty/stale XML. Complete pagination is required. Cache/CDN caching disabled. `bazzar_feed_state` stores success/error/counts/warnings/hash (not token or catalog). Concurrent in-process reads share one fetch.
- Password-protected `/integrations/bazzar` shows private feed URL, generation health and a ready-to-send handoff message. Internal `/api/integrations/bazzar/status` uses the existing `x-integration-secret` admin authentication. Bazzar must still register the link, enable polling (suggested 08:00/20:00 Sarajevo), enable automatic discount updates/removal when the optional discount field disappears, and finish listing. Do not claim Bazzar is active until confirmed. Never send email without user authorization.
- This is an outbound catalog/price/stock feed only, not Bazzar order ingestion/stock deductions. Shopify stock must still reflect Bazzar sales through the merchant's order workflow. Ananas and Bedly schedules are unchanged.

Main operational sheets:
- `Orders` (the permanent order ledger and active `Na dostavi` source)
- `Delivered orders` (created on first confirmed courier import)
- `Povrati` (created when the first return is recorded)

`Undelivered orders` is no longer used by the app. The live operational history starts on `07/09/2026`; older test data was intentionally discarded rather than migrated.

Google Apps Script owns the visual/layout structure of those Sheets.
The app should **not fight the sheet layout**.

## Required Google Sheets layout rules

For the relevant sheets, the user wants this exact style:
- row 1 = fixed header
- row 2 = blank
- row 3 = date
- rows 4-8 = blank
- each new workday block goes on top
- weekdays only
- do not break styling
- do not remove existing data

A later requirement was to keep **5 empty rows available** in blocks.

## Current important workflow rules

### Telegram parser / order understanding
Important learned rules:
- `Grad` should be ZIP only
- Bosnia/BiH ZIP recognition matters
- `Artikal` is usually the last segment in Telegram-style orders
- parser and bot were tuned for Bosnia-style address/name/phone formatting

### Telegram bot direction
The standalone Telegram orders bot became an active direction.
The user wanted it working without LLM-heavy behavior.

### Shopify import
Shopify imports into `Orders` via Apps Script / webhook flow.
Multiple Shopify stores can post to the same Apps Script webhook when each webhook URL includes a stable `store` query parameter.
Duplicate detection stores `store:shopifyOrderId` in hidden column `K`; legacy Galago raw ids are still recognized for the default `galago` store.
Weekend orders should not create Saturday/Sunday blocks; Shopify and Telegram/app intake target the upcoming Monday block, creating it on top if needed. Monday reuses the existing block if weekend orders already created it.
Important mapping decisions:
- `Primalac` = customer full name
- `Broj telefona` = normalized phone
- `Grad` = ZIP if available, otherwise city
- `Adresa` = shipping address
- `Artikal` = combined product names
- `Broj paketa` = total quantity across line items
- `Otkupnina` = subtotal amount
- `Vrijednost posiljke` = subtotal amount
- `DOP` = `1`
- `Zamjena` = `0`

### Known unresolved issue
- Shopify duplicate-order behavior was hardened for multi-store ids, but should still be verified with real duplicate webhook retries.

## Hosting / deployment reality

### GitHub repo
Current repo:
- `https://github.com/GalagoDev/galago-admin`

### Hostinger deployment
The app was deployed to Hostinger business hosting / Node app hosting.
Current live URL:
- `https://magenta-tarsier-949777.hostingersite.com/`

Known issue discovered during deployment:
- redeploys wiped the `secrets/` folder
- this broke Google Sheets auth when app relied on `GOOGLE_SERVICE_ACCOUNT_PATH`

A fix was added in code to support:
- `GOOGLE_SERVICE_ACCOUNT_JSON`
with fallback to:
- `GOOGLE_SERVICE_ACCOUNT_PATH`

Important deployment note:
- the permanent stable fix is to use `GOOGLE_SERVICE_ACCOUNT_JSON` in environment variables
- relying on runtime files under `secrets/` is fragile on Hostinger redeploys

## UI direction

The user strongly prefers:
- short answers
- direct execution
- `MACHINE MODE`
- mobile-first UI
- desktop-optimized layouts without cropped order data
- sleek dark design
- minimal clutter

### Home page decisions
Remembered current direction:
- label: `Galago control panel`
- live indicator text: `Live and listening`
- mobile top bar and hamburger menu exposing every active panel, including `Povrati` and `Lager`
- desktop sidebar retains the same navigation destinations
- three top dashboard blocks:
  - `Nove narudžbe`
  - `Na dostavi`
  - `Povrati`
- these blocks were made clickable and open dedicated pages
- operational list headers include a refresh icon that bypasses the server cache after manual Google Sheets edits

### Large-list scaling direction
When lists grow large (ex: 500 undelivered orders), the intended UX is:
- mobile-first
- not render giant full list by default
- search
- first chunk only (e.g. 25)
- load more
- compact rows/cards
- expand for details

This was already being implemented for order list pages.

### Delivery outcome workflow
- The UI has one active-delivery concept: `Na dostavi`; the old `Nedostavljene` route redirects there.
- Every Shopify or Telegram order written to `Orders` is active in `Na dostavi` by default.
- Courier `.xls` and `.xlsx` reports are uploaded on `Na dostavi`, previewed, and confirmed before any Sheet mutation.
- Matching is conservative: normalized exact names (including reversed first/last name order), with amount/product/city only used to resolve duplicates.
- Confirmed deliveries are copied from `Orders` to `Delivered orders` and marked inactive in hidden `Orders` column `L`.
- Visible `Orders` column `P` (`Dostavljeno`) is a native checkbox beside the operational columns. It is not part of the ten-column courier export. Confirmed delivery imports set both hidden `L` and the checkbox; checking `P` manually also excludes that row from `Na dostavi` and exports after refresh, but does not create a historical copy in `Delivered orders`. Unchecking cannot reactivate a row already marked delivered in `L`.
- `Povrati` has an autocomplete over active `Na dostavi` customers; selecting a customer moves that exact order to the return history.
- `Povrati` shows an all-history return rate based on `Broj paketa`: active returned packages divided by packages in all non-duplicate `Orders` rows. The denominator is the recorded order history, which also includes current `Na dostavi` orders because physical courier handoff is not tracked separately.
- Return actions do not use confirmation popups. A recorded return can be restored to `Na dostavi`; the source row is reactivated and the `Povrati` copy is kept in Sheets with a hidden `restored` status.
- Source rows remain permanently in `Orders`; hidden column `K` stores the intake source ID and hidden column `L` removes delivered/returned rows only from active app views.
- Destination copies and hidden status IDs make delivery/return retries idempotent.

### Daily receipt workflow
- `Računi` is a separate operational panel; it does not replace Google Sheets or reintroduce the old PDF-first order workflow.
- A courier `.xls` or `.xlsx` creates a batch for the current Sarajevo date, regardless of shipment dates inside the document.
- Required courier columns are `datum_slanja`, `primaoc`, `primaoc_mjesto`, `iznos_otk`, and `Ref1`.
- Customers are sorted by `datum_slanja` from oldest to newest, with original Excel row order used as the tie-breaker.
- Phone numbers are matched from full `Orders` sheet history and can be refreshed after Google Sheets is edited.
- PDF uploads require exactly one document per customer. Files are naturally sorted by filename (`1.pdf`, `2.pdf`, and so on) and paired with the displayed customer position.
- Receipt batches and PDF pairing metadata are kept in SQLite; PDF files use the persistent Hostinger `STORAGE_DIR`.
- Relative storage/database paths are anchored outside Hostinger's versioned `hbuilds` release folders so redeploys cannot erase receipt state.
- Each connected PDF has a signed 90-day customer link under `/r/<signed-token>.pdf`; PDFs remain private in storage and invalid, expired, replaced, or deleted links return 404.
- Receipt link signatures use `RECEIPT_LINK_SECRET` when configured, otherwise a random secret is created once in persistent storage.
- Receipt rows provide a manual Viber workflow without a Business Messages subscription: copy the normalized customer number and open Viber, then copy the personalized message with its signed PDF link.
- Staff explicitly mark the receipt as sent after sending it in Viber. Manual sends use provider `manual_viber` and can be returned to `ready` when marked by mistake.
- Fully automated delivery by phone number would still require Viber Business Messages through an approved provider. A normal Viber bot only reaches subscribed Viber user IDs and must not be used as a fake substitute.
- An unsent receipt list can be removed from the app with inline confirmation; deleting it also removes its uploaded PDFs but never changes Google Sheets.

### Daily courier export workflow
- `Nove narudžbe` has an Excel download action for the displayed latest workday.
- The export reads fresh active rows from `Orders`, so delivered and returned orders are excluded even if the page was opened earlier.
- Row 1 contains the ten operational Google Sheets headers; customer rows begin immediately on row 2 with no date row or blank spacer rows.
- Phone and ZIP values remain text, while valid quantity and amount fields are exported as numbers for Brza pošta upload.
- Exported customers preserve the exact top-to-bottom order currently arranged in the `Orders` sheet. The app filters the 08:00 cycle but never re-sorts those rows by intake time, customer, or product.

### Duplicate and return-risk workflow
- `Nove narudžbe` scans the permanent `Orders` history for repeat customers during the previous 14 days.
- Exact normalized phone matches are high-confidence warnings. Exact normalized full-name matches (including reversed name order and ignored diacritics) are warnings when phone matching is unavailable or different.
- Any active earlier order with the same phone is a critical warning regardless of age. Previous returns are critical warnings across the full available history.
- Each warning shows the prior-order age and counts for delivered, returned, and still-active shipments.
- Staff explicitly choose `Provjereno, pošalji` or `Ne šalji – duplikat`. Decisions persist in hidden `Orders` column `O` (`Risk review`).
- `Provjereno, pošalji sve (N)` approves all unresolved warnings in the displayed workday block, including orders beyond the current search/page. It does not restore excluded orders or approve delivered/returned ones. The server validates the complete selection against a fresh sheet snapshot before one batch write; changed orders require refreshing/reviewing again.
- Single and bulk risk decisions reuse the freshly read snapshot after saving, avoiding a second full sheet reload and unnecessary metadata/style requests. The buttons show a pending state while saving.
- `Ne šalji – duplikat` keeps the row permanently in `Orders`, writes a `duplicate:` status in hidden column `L`, and excludes only that order from `Na dostavi`, totals, and courier exports. The decision can be reversed from `Nove narudžbe`.
- Courier export is blocked while any order in the export window has an unresolved duplicate/return warning; direct export URLs enforce the same check server-side.
- The `Excel do 08:00` button always remains visible in the orders header, including on mobile and when warnings exist. Warnings must never replace or hide the export button; the export endpoint still enforces the review check.
- Blocked exports redirect to `/orders?view=export` inside the admin UI, not a plain-text error page. This review lists the exact active 08:00 export selection (including rows from older date blocks), rather than only the newest workday block. Single/bulk decisions and refresh preserve this view; bulk approval can cover multiple dates in this view. The Excel link uses native browser navigation for file downloads.

### Customer reklamacije workflow
- `Reklamacije` is an authenticated operational panel backed by persistent SQLite storage.
- The panel lists customer claim references, request type, order number, contact details, address, description, uploaded evidence, and processing status.
- Claim cards are collapsed by default and show a compact operational summary; opening a card reveals full details, files, status controls, and deletion.
- Staff can search by customer, phone, email, order number, or claim reference.
- Supported statuses are `new`, `in_review`, `approved`, `rejected`, and `resolved`.
- Every authenticated panel polls the open-claim count and shows a persistent red navigation alert for claims that are not `resolved` or `rejected`.
- Claims can be deleted with inline confirmation. Deletion removes both the SQLite record and its persistent uploaded evidence directory.
- Uploaded evidence remains under the persistent `storage/return-claims` directory and is only served through an authenticated app route.
- The claims tables and files predate the GitHub implementation; preserving them across deploys is required.

### Retired Fakture workflow
- The user no longer uses the manual `Fakture` panel. Its routes, upload actions, and navigation links were removed.
- Existing invoice files and SQLite rows are deliberately left in persistent storage; removing the app feature must not delete historical data.
- Ananas marketplace invoice synchronization is separate and remains active.

### Desktop layout
The authenticated app uses a compact mobile top bar with a hamburger menu for all panels and a persistent desktop sidebar on larger screens. Dashboard summaries expand to three columns, dashboard panels can sit side by side, and order lists use a wrapped desktop table that exposes all operational fields without truncating long names, addresses, products, or phone numbers.
Admin order lists enrich ZIP-only `Grad` values with the local Bosnia postal directory for display (for example, `75000 - Tuzla`). This is presentation-only: Google Sheets and courier exports continue to contain the ZIP value alone.

## Current app architecture state

Connected / active:
- Google Sheets reads
- Hostinger deployment
- homepage dashboard
- mobile-friendly `Na dostavi` flow
- clickable dashboard pages
- Shopify import path
- Telegram webhook intake route (`/api/telegram/orders`)
- Telegram text/image order drafts with Confirm/Cancel before saving
- Telegram text/image order extraction uses OpenAI vision/text (`gpt-5.6-luna` by default, with reasoning disabled)
- Telegram order extraction requires `OPENAI_API_KEY` on Hostinger
- Telegram order extraction populates Primalac, Broj telefona, Grad, Adresa, Artikal, Otkupnina, Vrijednost posiljke, DOP, and Zamjena
- Telegram Artikal and total can be supplied together in the image caption (for example `Komoda serena` followed by `SDS 139`); `SDS` is an amount marker, the text before it is stored as Artikal, and the trailing price is written to both amount columns
- Telegram orders always write DOP as `1` and Zamjena as `0`
- Telegram Grad is accepted only as a five-digit ZIP; known Bosnia city names are normalized locally, and unresolved cities reject the draft instead of writing city text into Sheets
- Telegram webhook secret mismatches are logged but not hard-failed, to avoid Hostinger env drift breaking intake
- Telegram webhook updates are acknowledged before OpenAI/Sheets processing finishes, preventing slow external calls from making Telegram retry the same order or mark the webhook unhealthy.
- Confirmed Telegram orders store a stable hidden `telegram:<chat>:<message>` ID in Orders column `K`, making callback retries idempotent.
- Replying `delete`, `obriši`, or `obrisi` directly to a bot-confirmed order clears only that exact Orders row while preserving sheet layout. Repeated deletion is harmless, and standalone delete messages cannot select arbitrary orders.
- Reply-to-delete mappings are kept in persistent SQLite and apply to orders confirmed after the feature deployment.

Not fully mature yet:
- stronger Shopify dedupe stability
- Telegram allowed chat restriction needs production env hardening
- Telegram API extraction quality depends on prompt/schema tuning for messy screenshots
- deeper performance optimization

### Daily profitability workflow
- The main `Statistika` page provides a whole-year overview with a year selector, all 12 monthly totals, and a compact daily breakdown for the selected month. Annual and monthly sales exclude duplicate, returned, and replacement rows using the same inclusion rule as daily profitability.
- The top `Danas` block in `Statistika` opens a dedicated daily sales and profitability view.
- Opening `Danas` requires the separate statistics password. The compact modal intentionally contains only a masked input and `OK`; invalid submissions return to `Statistika`, and direct access to `/stats/today` is also guarded.
- Daily profitability uses the same latest `Orders` workday block as `Nove narudžbe`. Weekend orders remain grouped in the upcoming Monday block, so the count and revenue stay aligned across both panels.
- The daily profitability header shows the exact operational cycle from 08:00 to 08:00. A Monday block is one weekend cycle from Friday 08:00 through Monday 08:00, and its Meta Ads cost combines Friday, Saturday, and Sunday spend.
- Staff can periodically upload an `.xls`, `.xlsx`, or `.csv` inventory export containing product name, purchase price, and quantity. The latest import becomes the active catalog; imports and manual aliases persist in SQLite.
- Sold item labels are matched against the catalog by saved alias, exact normalized name, and conservative fuzzy matching. Unmatched labels are listed for explicit manual mapping.
- Saved manual aliases are checked before quantity markers are stripped, so a full label ending in `2x`, `3x`, and similar notation remains linked after refresh while retaining the stated quantity.
- Operational product matching understands quantity notation such as `2x Tunda` and `Usiku 2 komada`, ignores `SDS`/`KM` price suffixes and dispatch notes, and can split clear multi-product labels such as `Zuri sto Lulu stolica` without treating descriptive wording (`sa vratima i policama`) as another item.
- `Mara set` is a known bundle: one set records one `Komoda MARA` and one `Komoda NORA` in the same color. Explicit set multipliers apply to both components, while a redundant textual `i Nora` does not double-count the Nora component.
- A zero purchase price is treated as missing cost, not as a free product. Daily purchase cost and profit remain hidden whenever a sold inventory item has a zero/missing purchase price.
- New inventory imports are rejected when every purchase price is zero or when most quantities are unrealistically large, which usually means a weight/other field was selected instead of the intended stock column.
- Final profit is intentionally hidden until every sold label has a known purchase cost and Meta spend is available; this prevents an incomplete cost list from appearing as inflated profit.
- The daily formula is revenue minus 14.5% VAT, 8.50 KM per order, matched purchase costs, and combined Meta Ads spend.

### Inventory overview workflow
- `Lager` is a dedicated authenticated operational page backed by the latest imported inventory catalog in persistent SQLite storage.
- Uploaded lager documents remain the source for product names, SKUs, aliases, and purchase prices.
- Quantities are refreshed automatically from the configured Galago Shopify Admin API every 10 minutes, on relevant Shopify webhooks, and manually from the `Lager` page. Only confidently matched tracked variants update local quantities; unmatched or ambiguous Shopify products never overwrite imported stock.
- The page displays product name, optional SKU, and the latest safely matched Shopify quantity. Purchase prices remain confined to the password-protected profitability view.
- The page includes search, stock-status filters, totals, and clear warnings for zero stock and quantities from one through five.
- `Lager` is available in the mobile menu, desktop sidebar, and as a dashboard summary card.
- Product ranking uses sold units and order count for the selected actual calendar date.
- Meta Ads is read server-side from configured ad accounts with `META_ADS_ACCESS_TOKEN` and comma-separated `META_AD_ACCOUNT_IDS`; the token is never sent to the browser. EUR is converted to BAM at the fixed rate. Other currencies are converted through the free daily Frankfurter reference rate, while `META_ADS_TO_BAM_RATES_JSON` can override any rate when needed.

### Google Ads dashboard
- `Reklame` (`/reklame`) is available from both the mobile menu and desktop sidebar.
- Google Ads is the first channel; Meta is a future addition to this panel.
- Hourly campaign data supports the existing Sarajevo 08:00 workday/weekend cycles, plus calendar ranges.
- The panel displays impressions, clicks/CTR, spend in EUR/KM, primary PURCHASE conversions, attributed revenue, and ROAS. ROAS is revenue divided by spend, not net profit or all store revenue.
- Individual-ad recommendations use a separate mature 14-day window, business-configured target ROAS and minimum evidence. Missing/old data prevents confident keep/pause advice; the application never changes ads automatically.
- Google Ads API credentials stay on the server. Reuse of the existing Sheets service account still requires Read-only permission on the Ads account and production access for its Cloud project. See `DEPLOY_HOSTINGER.md`.
- `ads_snapshots` and `ads_settings` live in the existing persistent SQLite database. Sync runs hourly, preserves the last full snapshot on failure, and refreshes the latest 90 days for delayed conversions.
- Tests: `npm run test:ads`.
- On 2026-10-16 the service account was granted Read-only access to Ads account `3221742913` and Google Ads API was enabled in its existing Cloud project. Google's Explorer production-access application was rejected; the production panel correctly reports this external blocker. No payment was made.
- Purchase action `7760086787` was corrected from fixed USD 1 to dynamic transaction values with EUR 0 fallback. Shopify's existing Checkout completed mapping points to Purchase. Set `GOOGLE_ADS_REVENUE_VALID_FROM=2026-10-17` to exclude historical fixed-value data from revenue/ROAS and recommendations. A real conversion's value/currency still needs verification after tracking starts producing data.

### Admin session security
- Admin login issues an HMAC-signed, expiring 30-day session; plain `store-admin-session=ok` cookies are rejected.
- Signing uses a domain-separated key derived from the existing `APP_PASSWORD`; missing password fails closed. Password changes invalidate sessions. Cookies are HttpOnly, SameSite=Lax and Secure in production.
- Deploying this migration requires one fresh login. The separate statistics password gate remains unchanged.
- All protected routes/actions must use `isAuthenticated()` or the shared session validator. Test with `npm run test:session` and `npm run test:order-export-flow`.

## Performance notes

- The courier Excel button uses one guarded browser fetch with a visible busy state. Success keeps a download link to the same in-memory file; that link never re-reads or re-marks Sheets. JSON responses keep validation/upstream errors in the panel and send unresolved risks to the existing exact-cycle review view. Direct `/orders/export` navigation remains supported. Do not replace this control with a prefetched Next Link.
- Concurrent fresh Sheets reads share their in-flight request. Mutations must still call `invalidateSheetCache` to discard older in-flight snapshots. Export retains fresh validation and waits for its final-row marker before returning the workbook; failures never silently skip that marker.
- Export regressions: `npm run test:order-export-flow`, `npm run test:sheet-cache`; optional local-only Playwright checks are in `scripts/test-order-export-browser.cjs`.

Hostinger shared hosting was noticeably slower than local.
Known reasons:
- live Google Sheets requests
- homepage loading multiple summaries
- shared hosting coldness/slowness

Optimizations already attempted:
- Google Sheets caching
- longer cache TTL
- lighter Undelivered page behavior
- reduced unnecessary sheet access

If more performance work is needed, likely next wins are:
- lighter homepage data strategy
- more aggressive caching
- maybe a VPS later for better runtime performance

## Important model behavior notes

If you are a coding model reading this:
- do not assume older PDF flows are still the priority
- do not reintroduce unnecessary manual intake UI unless explicitly wanted
- preserve mobile-first decisions
- preserve Google Sheets-centric workflow
- keep changes practical and operational, not academic

## Current practical defaults

- User likes fast execution and concise communication.
- If changing app code, pushing to GitHub after meaningful app changes became the default expectation.
- Be careful with deployment quirks on Hostinger.
