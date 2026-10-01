# PROJECT_CONTEXT.md - Galago Admin

This file exists to quickly onboard a coding model (Codex, Claude Code, etc.) to the real state of the project.

## What this app is

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
- bottom nav with custom icons
- bottom nav labels:
  - `Narudzbe`
  - `Na dostavi`
  - `Reklamacije`
  - `Računi`
  - `Fakture`
  - `Statistika`
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
- `Ne šalji – duplikat` keeps the row permanently in `Orders`, writes a `duplicate:` status in hidden column `L`, and excludes only that order from `Na dostavi`, totals, and courier exports. The decision can be reversed from `Nove narudžbe`.
- Courier export is blocked while any order in the export window has an unresolved duplicate/return warning; direct export URLs enforce the same check server-side.

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

### Monthly invoice workflow
- `Fakture` is a separate authenticated panel for business invoices and monthly payment tracking. It does not change Google Sheets orders and is distinct from customer `Računi`.
- Invoices are grouped by a selected `YYYY-MM` month; staff can navigate backward or forward, jump directly to a month, and reopen any month with saved invoices.
- Each entry stores a supplier/title, optional KM amount, protected PDF or image document, paid/unpaid status, and payment timestamp.
- Paid status is reversible so mistakes can be corrected. Invoice deletion uses inline confirmation and removes both the register entry and its stored document.
- Duplicate document uploads are blocked within the same month using a file hash.
- Invoice metadata is stored in SQLite and files remain under persistent `storage/invoices`, outside Hostinger versioned build folders.
- Invoice documents are served only through the authenticated `/fakture/files/<id>` route.

### Desktop layout
The authenticated app now keeps the mobile bottom navigation below the large-screen breakpoint and switches to a persistent desktop sidebar on larger screens. Dashboard summaries expand to three columns, dashboard panels can sit side by side, and order lists use a wrapped desktop table that exposes all operational fields without truncating long names, addresses, products, or phone numbers.
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
- `Lager` is available in the desktop sidebar and as a dashboard summary card, keeping the six-item mobile bottom navigation touch-friendly.
- Product ranking uses sold units and order count for the selected actual calendar date.
- Meta Ads is read server-side from configured ad accounts with `META_ADS_ACCESS_TOKEN` and comma-separated `META_AD_ACCOUNT_IDS`; the token is never sent to the browser. EUR is converted to BAM at the fixed rate. Other currencies are converted through the free daily Frankfurter reference rate, while `META_ADS_TO_BAM_RATES_JSON` can override any rate when needed.

## Performance notes

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
