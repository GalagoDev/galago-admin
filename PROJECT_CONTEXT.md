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
- `Orders`
- `Undelivered orders`
- `Delivered orders` (created on first confirmed courier import)
- `Povrati` (created when the first return is recorded)

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
  - `Računi`
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
- `Na dostavi` reads the existing `Undelivered orders` sheet.
- Courier `.xls` and `.xlsx` reports are uploaded on `Na dostavi`, previewed, and confirmed before any Sheet mutation.
- Matching is conservative: normalized exact names (including reversed first/last name order), with amount/product/city only used to resolve duplicates.
- Confirmed deliveries move from `Undelivered orders` to `Delivered orders`.
- `Povrati` has an autocomplete over active `Na dostavi` customers; selecting a customer moves that exact order to the return history.
- Return actions do not use confirmation popups. A recorded return can be restored to `Na dostavi`; the source row is reactivated and the `Povrati` copy is kept in Sheets with a hidden `restored` status.
- Source rows remain permanently in `Undelivered orders`; a hidden `App status` column removes delivered/returned rows only from the app.
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
- Direct Viber delivery by phone number requires Viber Business Messages through an approved provider. A normal Viber bot only reaches subscribed Viber user IDs and must not be used as a fake substitute.
- Viber sending remains locked until a Business Messages provider, approved sender/template, and credentials are configured.
- An unsent receipt list can be removed from the app with inline confirmation; deleting it also removes its uploaded PDFs but never changes Google Sheets.

### Desktop layout
The authenticated app now keeps the mobile bottom navigation below the large-screen breakpoint and switches to a persistent desktop sidebar on larger screens. Dashboard summaries expand to three columns, dashboard panels can sit side by side, and order lists use a wrapped desktop table that exposes all operational fields without truncating long names, addresses, products, or phone numbers.

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
- Telegram text/image order extraction uses OpenAI vision/text (`gpt-4.1-mini` by default)
- Telegram order extraction requires `OPENAI_API_KEY` on Hostinger
- Telegram order extraction only populates Primalac, Broj telefona, Grad, Adresa, Artikal
- Telegram Artikal comes from the image caption/text below the image when present; otherwise the last meaningful text line
- Telegram webhook secret mismatches are logged but not hard-failed, to avoid Hostinger env drift breaking intake

Not fully mature yet:
- true stats page logic
- stronger Shopify dedupe stability
- Telegram allowed chat restriction needs production env hardening
- Telegram API extraction quality depends on prompt/schema tuning for messy screenshots
- deeper performance optimization

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
