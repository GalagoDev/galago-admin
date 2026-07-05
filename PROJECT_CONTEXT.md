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
- Shopify duplicate-order behavior still needs proper hardening / verification.

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
- sleek dark design
- minimal clutter

### Home page decisions
Remembered current direction:
- label: `Galago control panel`
- live indicator text: `Live and listening`
- bottom nav with custom icons
- bottom nav labels:
  - `Narudzbe`
  - `Nedostavljene`
  - `Statistika`
- four top dashboard blocks:
  - `Nove narudžbe`
  - `Nedostavljene`
  - `Na dostavi`
  - `Povrati`
- these blocks were made clickable and open dedicated pages

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

## Current app architecture state

Connected / active:
- Google Sheets reads
- Hostinger deployment
- homepage dashboard
- mobile-friendly undelivered flow
- clickable dashboard pages
- Shopify import path
- Telegram webhook intake route (`/api/telegram/orders`)
- Telegram text/image order drafts with Confirm/Cancel before saving

Not fully mature yet:
- true stats page logic
- returns (`Povrati`) operational logic
- stronger Shopify dedupe stability
- Telegram allowed chat restriction needs production env hardening
- Telegram image extraction needs `OPENAI_API_KEY` in production env
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
