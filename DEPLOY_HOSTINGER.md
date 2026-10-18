# Hostinger VPS deploy - store-admin

## Stack
- Node.js 22
- Next.js app on port 3000
- PM2 for process management
- optional Nginx reverse proxy

## 1. Server packages
```bash
sudo apt update
sudo apt install -y nginx git curl build-essential
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
sudo npm install -g pm2
```

## 2. App directory
```bash
sudo mkdir -p /var/www/store-admin
sudo chown -R $USER:$USER /var/www/store-admin
```

## 3. Upload code
Use git clone or rsync your local `store-admin/` folder into:
```bash
/var/www/store-admin
```

## 4. Production env
Create:
```bash
/var/www/store-admin/.env.local
```
with values from `.env.production.example`.

Use `GOOGLE_SERVICE_ACCOUNT_JSON` for Google auth on Hostinger. Do not rely on
runtime files under `secrets/`; Hostinger redeploys can wipe them.

Keep `GOOGLE_SERVICE_ACCOUNT_PATH` only as a local/fallback option.

## 5. Install and build
```bash
cd /var/www/store-admin
npm install
npm run build
```

## 6. Start with PM2
```bash
cd /var/www/store-admin
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup
```

## 7. Nginx reverse proxy
Create:
```bash
sudo nano /etc/nginx/sites-available/store-admin
```

Paste:
```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

Enable:
```bash
sudo ln -s /etc/nginx/sites-available/store-admin /etc/nginx/sites-enabled/store-admin
sudo nginx -t
sudo systemctl reload nginx
```

## 8. HTTPS
If domain is pointed already:
```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d your-domain.com
```

## 9. Telegram order webhook

Telegram intake is handled by the Next.js route:

```text
/api/telegram/orders
```

Register it with Telegram after deployment:

```bash
curl -X POST "https://api.telegram.org/bot$TELEGRAM_ORDERS_BOT_TOKEN/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url":"https://magenta-tarsier-949777.hostingersite.com/api/telegram/orders"}'
```

Use `TELEGRAM_ORDERS_ALLOWED_CHAT_ID` to restrict which chat can submit orders.
If `TELEGRAM_ORDERS_WEBHOOK_SECRET` is set, pass it as `secret_token` when registering
the webhook. The app logs secret mismatches but does not hard-fail Telegram intake,
because Hostinger env redeploy/restart drift previously caused valid orders to get
stuck with `401 Unauthorized`.

Telegram text/image/photo order extraction uses the OpenAI API. Set:

```bash
OPENAI_API_KEY=your_openai_api_key
OPENAI_ORDER_MODEL=gpt-5.6-luna
```

`OPENAI_ORDER_MODEL` is optional and defaults to `gpt-5.6-luna` with reasoning
disabled for low-latency structured order extraction.

Confirmed Telegram orders receive a stable hidden ID in column `K`. Reply with
`delete`, `obriši`, or `obrisi` directly to the bot's confirmed order message to
clear that exact order from `Orders` without deleting or shifting the styled row.
This is supported only for orders confirmed after this feature was deployed.

## 10. PM2 useful commands
```bash
pm2 status
pm2 logs store-admin
pm2 logs store-admin-orders-bot
pm2 restart store-admin
pm2 restart store-admin-orders-bot
```

## Notes
- The admin app does not need to be running for Shopify -> Apps Script -> Google Sheets to work.
- Telegram orders use the app webhook route; no separate polling bot process is required.
- Keep Google auth configured with `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` on Hostinger.

## Google Ads reporting

The authenticated `/reklame` page reads Google Ads reporting data only. Configure
`GOOGLE_ADS_CUSTOMER_ID` (Galago: `3221742913`). The existing Sheets service account
can be reused without copying its private key; add its email to that Ads account
with **Read-only** access. Enable Google Ads API and obtain Explorer or higher
production access in the Cloud project that owns the credentials. As of
September 9, 2026, a developer token is no longer required. See Google's
[service account setup](https://developers.google.com/google-ads/api/docs/oauth/service-accounts)
and [Cloud project setup](https://developers.google.com/google-ads/api/docs/oauth/cloud-project).

Optional dedicated credentials use `GOOGLE_ADS_SERVICE_ACCOUNT_JSON` (JSON or
base64), or all three OAuth values in `.env.production.example`. A manager login
ID is optional; direct account access does not require a manager account. Never
put credentials in public Next.js environment variables or client-side code.

The internal scheduler refreshes the latest 90 account-calendar days hourly,
including older conversions that arrive late. Set `GOOGLE_ADS_SYNC_ENABLED=false`
to disable it. Manual refresh is limited to once per five minutes. An optional
external scheduler can POST `/api/ads/sync` with `x-integration-secret` matching
`GOOGLE_ADS_SYNC_SECRET`; no secret is accepted in the URL. SQLite stores the last
complete snapshot and settings in the existing persistent storage. Failed
downloads preserve that snapshot. Read requests never call Google directly.

Campaign summaries use hourly reporting for Sarajevo 08:00–08:00 workdays and
Friday 08:00–Monday 08:00 weekends. Individual ads use a separately labelled
14-day calendar window, excluding today and the configured conversion lag
(default three complete days), because Google does not offer hourly ad rows.
Revenue is primary PURCHASE conversion value attributed by Google to interaction
date; it is not all Shopify/Sheets revenue, courier-confirmed sales, or net profit.
ROAS divides attributed revenue by ad cost in the same currency. EUR/BAM uses
1.95583; unsupported currencies cannot produce BAM totals.

Purchase value settings are audited separately from purchase counts. Fixed values
and snapshots without that audit cannot produce sales totals or ROAS. Changing a
Google conversion action from fixed to dynamic values does not repair historical
conversions. After such a correction, set `GOOGLE_ADS_REVENUE_VALID_FROM` to the
first complete eligible Sarajevo calendar date (YYYY-MM-DD). Periods beginning
before that date, including the independent recommendation window, keep revenue
and ROAS unknown. This cutoff is a safeguard, not proof that purchase events fire
or carry the correct value; verify a real purchase's amount and currency too.

For Galago, Purchase was changed on 2026-10-16 from a fixed USD 1 to transaction
values, with EUR 0 as fallback. Shopify Google & YouTube already maps Checkout
completed to this action. Production cutoff is 2026-10-17. Google's integration
sends discounted merchandise value excluding shipping and taxes; see its
[Shopify event parameters](https://developers.google.com/tag-platform/gtagjs/reference/shopify-event-parameters#purchase).

Set a business-specific target ROAS in the panel before performance verdicts
are enabled. Missing tracking, insufficient history/sample, or a snapshot older
than six hours blocks actionable recommendations. Recommendations never change
ads or campaign budgets. Performance Max spend remains included in campaign
totals, while individual-ad coverage is limited by Google's reporting resources.

Validate with `npm run test:ads`, targeted ESLint, and `npm run build`. API tests
mock Google requests and use SQLite in memory; they never access live accounts.

## Meta advertising reports

The Meta tab on `/reklame` reads hourly ad-level Insights through the existing
server-only `META_ADS_ACCESS_TOKEN` with `ads_read`. Set
`META_REPORT_AD_ACCOUNT_IDS` to the account IDs intended for this advertising
dashboard. It overrides `META_AD_ACCOUNT_IDS` only for this report; existing daily
statistics keep their original account scope. Galago's reporting account is
`1270654995072639` (USD, Europe/Sarajevo). The other existing account must not be
included in Galago advertising totals by accident.

The authenticated `/api/ads/meta` route accepts the same period filters as Google.
Account IDs come exclusively from server configuration. Hourly ad rows are
filtered to the Sarajevo 08:00 workday/weekend boundaries; totals, campaigns and
individual ads all use those same rows. The client explicitly requests
`action_report_time=conversion` and `use_unified_attribution_setting=true`.

Purchase revenue uses `offsite_conversion.fb_pixel_purchase` only. Meta's
`omni_purchase`, `purchase` and other purchase aliases are not added together.
The UI labels these metrics as web purchases and web revenue. Messaging purchase
events without monetary values are not invented as revenue. Values are whatever
the Meta purchase integration reports; this adapter does not add shipping or
attempt to infer Shopify order totals. It does not combine attribution with
Google, whose model can credit some of the same purchases.

EUR/BAM uses the fixed 1.95583 rate. Other account currencies use the date's
reference conversion through the same Frankfurter service as daily statistics,
or `META_ADS_TO_BAM_RATES_JSON` overrides. Unavailable rates or purchase values
keep affected totals unknown. Requests are bounded and paginated; incomplete
downloads do not become zero activity. Refresh uses a five-minute cache, with a
one-minute minimum between manual reloads. Credentials stay on the server.

Validate with `npm run test:meta-ads`, `npm run test:ads`, targeted ESLint and
`npm run build`. Meta API tests use isolated fixtures and do not need live tokens.
Live verification must compare the same account, dates and attribution in Meta.

## Shopify multi-store webhooks
Shopify orders are handled by `shopify-webhook.gs` in Google Apps Script, not by the Hostinger Node app.

For each Shopify store, create an `orders/create` webhook that points to the deployed Apps Script web app URL. Add a stable `store` query parameter so duplicate detection stays separate per store:

```text
https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec?store=galago
https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID/exec?store=second-store
```

The script stores the hidden duplicate marker in column `K` as `store:shopifyOrderId`. Existing Galago imports that stored only the raw Shopify order id are still recognized when `store` is omitted or set to `galago`.

## Ananas.ba product integration

The app exposes the authenticated endpoint `/api/integrations/ananas/run` and
Shopify webhook endpoints below `/api/integrations/ananas/shopify`. Configure the
Ananas and Shopify variables from `.env.production.example`; keep
`ANANAS_UNTRACKED_STOCK_LEVEL=0` until Shopify inventory tracking or another real
stock source is enabled.

The production cron schedule uses Europe/Sarajevo time:

On Hostinger Web Apps, set `ANANAS_INTERNAL_SCHEDULER_ENABLED=true`; the app runs
the same schedule internally and records one successful run per action/day in
SQLite. On VPS plans with system cron, use the equivalent commands below instead.

```cron
5 0 * * * cd /var/www/store-admin && /usr/bin/node scripts/run-ananas-cron.mjs refresh-ids >> storage/logs/ananas-cron.log 2>&1
15 0 * * * cd /var/www/store-admin && /usr/bin/node scripts/run-ananas-cron.mjs prices-stock >> storage/logs/ananas-cron.log 2>&1
15 2 * * * cd /var/www/store-admin && /usr/bin/node scripts/run-ananas-cron.mjs discounts >> storage/logs/ananas-cron.log 2>&1
0 4 1,15 * * cd /var/www/store-admin && /usr/bin/node scripts/run-ananas-cron.mjs import-catalog >> storage/logs/ananas-cron.log 2>&1
0 5 * * * cd /var/www/store-admin && /usr/bin/node scripts/run-ananas-cron.mjs invoices >> storage/logs/ananas-cron.log 2>&1
```

Shopify `products/create`, `products/update`, and `inventory_levels/update`
webhooks may point to the corresponding public integration routes. The routes
verify Shopify HMAC signatures and record idempotent receipts, while actual
Ananas writes remain restricted to the required daily windows.
