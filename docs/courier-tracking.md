# Express One delivery reconciliation

`/in-transit` and the dashboard now count only orders whose linked parcels have
fresh, confirmed physical courier events. Other open Orders rows remain visible
under Najavljene, Djelimicne or Za provjeru; they are never silently dropped.
Known delivered/returned source rows have their own outcome views.

The tracking client uses the same public JSON tracking endpoint as Express One's
Track & Trace page: `POST https://expressone.ba/api/track` with `shipmentNumber`.
There are no courier passwords or browser cookies on the server. Responses are
schema-checked, tied to the requested parcel number and sorted by scan date/time.
This website endpoint is not a contracted integration and can change. An error,
unknown response or data older than 36 hours is shown as unconfirmed, not active.

Every parcel must be known before an order can be archived as delivered or
returned. `RETS` takes precedence over a later sender-delivery or invoice scan.
`DELY`/confirmed delivery and COD payment identify completed customer delivery.
Invoice/cash-collection events alone do not establish physical delivery.
Data-definition/label-printing events alone mean registered, not dispatched.
A mixture of delivered and unscanned parcels remains partial. Completed parcels
are not included in the remaining-package counter for an active order.

SQLite stores explicit order-to-parcel links, parcel histories and a leased sync
job. The stable order key contains product/contact identity, date block, source
ID and received timestamp, never customer name alone. Copied or edited orders
do not inherit a previous shipment's outcome. Identical ambiguous rows stay for
review. Manually restoring a return clears the source delivery checkbox and
suppresses the old tracking link until a new parcel number is linked.

The worker runs daily at 07:15 Europe/Sarajevo, after the existing 07:00 carrier
email scan. It also runs when an administrator clicks Provjeri statuse or links
parcel numbers. New sender-verified carrier emails can discover unique links;
orders with no courier evidence stay unconfirmed until all tracking numbers are
linked. Existing audited links are not overwritten by email matching. There is
no claim that every newly registered courier shipment produces an email.

Requests are sequential, spaced 500 ms, timeout after 20 seconds and use the
fixed vendor endpoint. A failing service retries after one hour. A DB lease and
heartbeat prevent concurrent runs. Existing queued Sheets transitions archive
completed rows, preserve original Orders data, revalidate current identity and
invalidate caches. A verified completion is persisted on the link. A restored
or copied row cannot automatically reapply that old completion.

`COURIER_TRACKING_SCHEDULER_ENABLED=false` disables this worker. The separate
Gmail return scanner continues daily, but defers multi-parcel or explicitly
linked orders until all parcel statuses confirm the return. Public tracking
needs no AI/API credits.

The 28 October 2026 audit supplies the initial explicit links and all parcel
histories, including secondary parcels, only when the live order identity still
matches the reviewed snapshot. Back up SQLite and Orders/Povrati/Delivered orders
before seeding. Seed with `next_run_at=0` to refresh vendor histories and apply
confirmed outcomes on the first deployed run. No customer data belongs in Git.
