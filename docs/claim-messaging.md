# Telegram complaint notifications and Gmail replies

This integration uses a dedicated bot. Never reuse the orders bot token or replace its webhook.

## Private configuration

Store `claims-config.json` in the persistent `storage/data` directory, mode 0600, outside the deployed source tree. Back up this file securely: its encryption key is needed to decrypt the Gmail refresh token in SQLite.

Required keys: `enabled`, `botToken`, `webhookSecret` (32+ random URL-safe characters), `chatId` (private group ID), `allowedUserIds` (explicit staff Telegram IDs), `publicUrl` (HTTPS origin), `encryptionKey` (32 random bytes, base64). Optional until Gmail setup: `gmailClientId`, `gmailClientSecret`. The sender is fixed to `galagodoo@gmail.com`.

Register the dedicated webhook using `node scripts/configure-claim-telegram.cjs /absolute/private/claims-config.json`. Use `--drop-pending` only during initial setup. `--test` sends a connection-only message saying Gmail is not connected; do not use it after Gmail activation. Keep Telegram privacy mode enabled; replies to bot messages are delivered without giving the bot administrator rights.

The webhook rejects missing/wrong secret headers, other chats, unauthorized senders, bots, anonymous group identities and messages that are not replies to a stored complaint message. Adding somebody to the group does not automatically authorize them to email customers. Update the explicit allowlist separately.

## Gmail

Enable Gmail API on the Google Cloud project. Create a Web application OAuth client with this exact redirect URI:

`https://magenta-tarsier-949777.hostingersite.com/api/reklamacije/gmail/callback`

Configure the client ID/secret privately and open `/reklamacije/povezivanje`. The flow requests only `gmail.send`, `openid` and `email`, checks the verified account, uses PKCE and a single-use browser-bound state, and encrypts the refresh token with AES-256-GCM.

Google external apps left in Testing can have short-lived refresh grants. Complete the appropriate Google publishing/verification requirements before treating this as unattended production email. Do not broaden the scopes to read the inbox to work around setup issues.

Google requires public app information, privacy and terms links for production. The prepared static pages are `/galago-reklamacije.html`, `/galago-reklamacije-privatnost.html` and `/galago-reklamacije-uslovi.html`. Only these exact paths and their stylesheet bypass the login proxy. Obtain owner approval before publishing the policy pages or changing OAuth audience to Production. After switching, reconnect the same account with the same scopes to obtain a fresh offline grant; do not assume an existing Testing grant loses its expiry automatically.

Live verification on 2026-10-26: the owner approved publication of the information pages and the move to Production. All four static public paths returned HTTP 200 without login; the complaint and connection pages still redirected unauthenticated visitors to login. Google Audience showed In production. After a temporary Google consent-page HTTP 500, a fresh grant for the same account and scopes succeeded at 13:16 UTC and was stored encrypted. A second Reply to synthetic complaint `GAL-20261026-F69582` was accepted by Gmail for `galagodoo@gmail.com` and recorded as sent at 13:17 UTC. The synthetic complaint was marked finished, not deleted. No customer email was used for either test.

Production publishing is not Google app verification: branding and sensitive-scope verification remain incomplete, so Google shows the unverified-app warning and user cap. This integration accepts only the fixed owner Gmail account; currently only the owner's Telegram user ID is authorized to send replies. A fresh Production grant avoids relying on the earlier Testing grant, but normal Google revocation and token-expiry rules still apply.

## Delivery semantics

New complaints and notification jobs commit in one SQLite transaction. Existing complaints are not replayed on activation. Attachments stay private and are uploaded directly to Telegram as original documents. The worker runs every 15 seconds and immediately after incoming requests. It retries Telegram failures with backoff up to ten attempts. A lost Telegram response may create a duplicate notification; it cannot duplicate an email reply.

Email replies are deduplicated by both update ID and chat/message ID. Plain text Reply sends to the email stored on that complaint. Text edits, ordinary group messages, commands and attachments do not send emails. Replies received before Gmail connection are marked failed and will not silently send after connection.

Gmail send calls are not automatically retried. Network/5xx uncertainty or an interrupted in-flight send is marked `unknown`; staff must inspect Gmail Sent before submitting another reply. Explicit provider rejection is `failed`. Only a returned Gmail message ID produces `sent` and a success acknowledgement. Outcomes and reply bodies are visible inside each collapsed complaint card.

No inbound mailbox monitoring, automatic customer replies, historical replay or attachment email sending is enabled. Disable processing by setting `enabled: false`; this does not revoke OAuth access. Revoke access in the Google account when retiring the integration.

## Verification

`npm run test:claims` exercises real isolated SQLite with mocked external APIs, authorization, OAuth state/replay/account checks, encryption, MIME injection rejection, attachment notifications, retry behavior, concurrent delivery and no duplicate emails. Also run `npm run lint` and `npm run build`.
