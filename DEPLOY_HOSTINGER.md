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
the webhook.

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
