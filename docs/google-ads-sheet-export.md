# Google Ads Script → private Sheet → Galago Admin

The exporter is `scripts/google-ads-sheet-export.js`. Install **one copy** in the
Google Ads client account `322-174-2913`, under Tools → Scripts. It only calls
`AdsApp.currentAccount()`, `AdsApp.getExecutionInfo()` and `AdsApp.search()`.
There are no campaign, budget, bid, status, conversion-setting, email or HTTP
callback writes. Its only writes are reporting tabs in a dedicated private Sheet.

## Install and verify

1. Create a dedicated private Google Sheet. Keep general access **Restricted**.
   Set `GALAGO_ADS_EXPORT.SPREADSHEET_ID` to its existing ID. The script never
   creates another spreadsheet or changes sharing permissions. It sets this
   dedicated Sheet's display timezone to the verified Ads account timezone;
   transport dates and timestamps remain explicit JSON strings.
2. Install the script on the expected client account. Review and authorize the
   actual Google permissions prompt before running. Preview can still write to
   Sheets; it is not a read-only preview of external services.
3. Run once. Verify the log reports `Galago Ads export complete`, the expected
   account/currency/date range, and plausible totals. Compare the same account
   calendar range in the Ads UI. `reportedPurchaseValue` in logs is Google's raw
   attributed value; it is not a claim that revenue is reliable.
4. Share the Sheet only with the server's existing Sheets service account as
   **Viewer**. Configure the server's Sheet reporting source as described in
   its deployment settings. Never place service-account credentials in this
   script or the Sheet. Ads Script authorization belongs to the signed-in Ads
   user; it is independent of a developer's Cloud Explorer application.
5. Schedule the one installed script hourly. Do not install parallel copies or
   schedule overlapping writers. The dashboard's refresh imports the most recent
   completed export; it does not run the Ads Script itself.

The default range is **35 account-local calendar dates including today**. Today
is incomplete and Google may revise prior conversions through attribution lag.
Each run rereads the full range. Campaigns are hourly; individual ads are daily.
The existing dashboard applies its Europe/Sarajevo workday/weekend boundaries.

## Exact transport contract — schemaVersion 1

`ads_manifest!A1` is one JSON string. It is replaced only after all three newly
created data tabs have been fully written and flushed:

```json
{
  "schemaVersion": 1,
  "complete": true,
  "runId": "1792224000000_00000000000000000000000000000001",
  "exportedAt": "2026-10-17T08:00:00.000Z",
  "customerId": "3221742913",
  "accountName": "Galago",
  "currency": "EUR",
  "timeZone": "Europe/Sarajevo",
  "fromDate": "2026-09-13",
  "toDate": "2026-10-17",
  "campaignsTab": "ads_campaigns_1792224000000_00000000000000000000000000000001",
  "adsTab": "ads_ads_1792224000000_00000000000000000000000000000001",
  "trackingTab": "ads_tracking_1792224000000_00000000000000000000000000000001",
  "campaignsCount": 2,
  "adsCount": 2,
  "trackingCount": 1,
  "previousRunIds": []
}
```

`exportedAt` records the beginning of data collection, conservatively measuring
freshness. Run ID is epoch milliseconds + underscore + a UUID without hyphens.
`previousRunIds` is optional retention bookkeeping, not part of report contents.

Each data tab has a JSON header in A1:

```json
{"schemaVersion":1,"runId":"1792224000000_00000000000000000000000000000001","kind":"campaigns","count":2}
```

The rows begin in A2, one complete JSON object per cell. The three `kind` values
are `campaigns`, `ads`, `tracking`. Campaign/ad rows exactly match `AdsCampaignHour`
and `AdsAdDay` in `src/lib/ads-types.ts`. IDs and dates are strings. Cost is in
account currency units, after dividing `cost_micros` by 1,000,000. Numeric fields
are JSON numbers. Counts in headers and manifest must exactly match populated
rows. An empty successful metric query yields zero data rows, not an error or
invented entity rows. Tracking always has one object:

```json
{"configured":true,"actions":["Purchase"],"valueSettingsChecked":true,"fixedValueActions":[],"revenueValidFrom":"2026-10-17"}
```

The reader must validate both manifest and table headers, account identity,
timestamps, row counts, field types and date coverage, then reread the manifest.
If it changed or any validation failed, retain the previously saved snapshot.
Never consume orphan tabs which a failed run may leave behind.

Published tabs are immutable. After a successful commit, the exporter retains
the current and previous two published run IDs. It deletes only tabs matching
its precise `ads_(campaigns|ads|tracking)_<epoch>_<uuid>` pattern from older runs;
`ads_manifest`, `Upute` and unrelated tabs are preserved. Cleanup failures are
logged without invalidating the published export. The next successful run retries.
Keep one writer: immutable tabs prevent mixed datasets, and a changed manifest
detected before publication aborts an overlapping run. This is not a general
cross-script transactional lock.

## Metric and revenue safeguards

- Cost/impressions/clicks queries are separate from conversion-action queries.
  Filtering cost by purchase category would distort spend. Merging adds only
  purchases and purchase value, retaining conversion-only rows without spend.
- Only `PURCHASE` category and `metrics.conversions` / `conversions_value` are used,
  preserving Google's primary/custom-goal reporting semantics. Other conversions
  never count as sales. All contributing purchase actions, including secondary
  actions used by custom goals, are audited alongside enabled primary purchases.
- Missing selected numeric fields, malformed numbers, duplicates in unsegmented
  cost rows, mismatched account/date or query errors abort publication. Zero is
  accepted only when returned explicitly, or for metrics that were deliberately
  not selected in that query. Missing boolean value settings remain unverified.
- Fixed default purchase-value actions are listed in `fixedValueActions`; unknown
  metadata keeps `valueSettingsChecked:false`. Existing dashboard rules suppress
  trusted sales/ROAS in these cases.
- `REVENUE_VALID_FROM="2026-10-17"` is the first eligible **Europe/Sarajevo** date
  following the known tracking fix. It does not validate earlier history or
  guarantee current tracking. Server policy also enforces its configured cutoff.
- Impressions/clicks are nonnegative integers; cost and purchase count are
  nonnegative. Signed finite purchase values are retained for adjustments.
- Limits: 200,000 raw rows across all queries, 100,000 final rows, 45,000 characters
  per JSON cell, 40 million total JSON characters, 20 minutes of script runtime,
  and at least 60 seconds of platform runtime remaining. Any limit aborts before
  manifest publication. Batches are 500 rows, with only one allocated column.

## Validation and official references

Run `node scripts/test-google-ads-sheet-export.cjs` for isolated VM tests with
strict Ads API mocks and in-memory Sheets. They make no network requests.
Production query compatibility and authorization still require the first live
run; a failed query must not be replaced with a fabricated zero report.

- [Ads Scripts reporting](https://developers.google.com/google-ads/scripts/docs/concepts/reports):
  GAQL reporting and lowerCamelCase `AdsApp.search()` rows.
- [AdsApp.search](https://developers.google.com/google-ads/scripts/docs/reference/adsapp/adsapp#search_2):
  `apiVersion` option and v26 query examples.
- [Conversion action fields](https://developers.google.com/google-ads/api/fields/v26/conversion_action):
  primary goal and value-setting metadata.
- [SpreadsheetApp examples](https://developers.google.com/google-ads/scripts/docs/examples/spreadsheetapp):
  supported Google Ads Script spreadsheet integration.
- [Ads Scripts limits](https://developers.google.com/google-ads/scripts/docs/limits):
  execution and reporting limits.
