# Daily Express One returns

The server checks `cs@expressone.ba` once daily at 07:00 Europe/Sarajevo,
including weekends and DST. Next.js instrumentation starts a lightweight minute
timer; Gmail requests only occur when the persisted daily job is due. A missed run
is picked up after restart. Failures retry after one hour without advancing the
last-success timestamp. `EXPRESSONE_RETURNS_SCHEDULER_ENABLED=false` disables it.

The existing encrypted Gmail readonly connection is reused. No additional token,
AI credits, Telegram messages or outgoing email are needed. The job lists only
this sender's message IDs (including archived mail) and downloads unseen messages.
After a completed scan, it searches from seven days before the last success,
so overlap covers delayed mail without repeatedly listing the whole history.
It spaces requests and backs off on Gmail quota errors. Processed IDs and latest
shipment events persist in SQLite. A database lease prevents parallel daily runs.
The claim-reply polling worker remains separate.

Only the exact status `Povrat pošiljaocu` qualifies. Refused, delayed and unanswered
shipments do not. A return needs a unique normalized full name + phone match;
known product families must agree. All historical orders participate, not just
active ones. Orders newer than the shipment's earliest known status are excluded.
Ambiguous orders, missing contacts, product conflicts and already-delivered orders
are listed for manual review in Povrati and retried on the next daily scan.

The existing queued Sheets transition preserves original Orders rows, appends to
Povrati idempotently, then marks source status/checkbox and invalidates caches.
The scanner re-reads Sheets to verify each transition. Multiple tracking numbers
for one order cause only one move. Applied tracking IDs never automatically
reapply a return after a manual restore. A copied/new order is not identified by
name alone. No source records are deleted or automatically created for unmatched
shipments; no delivered status is automatically overwritten.

Status and review details are visible inside Povrati. Public OAuth disclosures
describe both complaint-thread polling and the sender-limited carrier search.

Run `npm run test:expressone`, `npm run test:claims`, and
`npm run test:order-export-flow` before deployment. The one-time historical audit
on 26 October 2026 can seed processed message IDs, latest events and confirmed
tracking/status-ID mappings, so its verified results are not re-imported.
