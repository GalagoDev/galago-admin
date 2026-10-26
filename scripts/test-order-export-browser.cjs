/* eslint-disable @typescript-eslint/no-require-imports -- Optional Playwright smoke test against a local production build. */
// Start locally with APP_PASSWORD=export-browser-test and all schedulers disabled.
// Requires Playwright on NODE_PATH; never runs against a production host or real Sheets.
const assert = require("node:assert/strict");
const { createHmac, randomBytes } = require("node:crypto");
const { chromium } = require("playwright");
const XLSX = require("xlsx");
const base = process.env.EXPORT_TEST_URL || "http://127.0.0.1:3107";
assert.ok(["127.0.0.1", "localhost"].includes(new URL(base).hostname), "local test server only");
const password = "export-browser-test";
const now = Math.floor(Date.now() / 1000);
const payload = `v1.${now}.${now + 60 * 60 * 24 * 30}.${randomBytes(16).toString("base64url")}`;
const key = createHmac("sha256", password).update("galago-admin/session-signing/v1").digest();
const cookie = `${payload}.${createHmac("sha256", key).update(payload).digest("base64url")}`;
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([["Naziv primaoca"], ["Test buyer"]]), "Sheet1");
const bytes = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" });
const mime = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE });
  try {
    for (const width of [1440, 390, 320]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, acceptDownloads: true });
      await context.addCookies([{ name: "store-admin-session", value: cookie, url: base }]);
      const page = await context.newPage();
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      let requests = 0;
      let mode = "success";
      let release;
      await page.route("**/orders/export", async (route) => {
        requests++;
        assert.match(route.request().headers().accept, /application\/json/);
        if (mode === "network") return route.abort();
        if (mode === "timeout") return; // Browser's AbortController must release the button.
        if (mode === "review") return route.fulfill({ status: 409, json: { redirect: "/orders?view=export&exportError=review&refresh=1#risk-alerts" } });
        if (mode === "login") return route.fulfill({ status: 303, headers: { location: "/login" } });
        if (mode === "html") return route.fulfill({ status: 502, contentType: "text/html", body: "<h1>Upstream unavailable</h1>" });
        if (mode === "error") return route.fulfill({ status: 422, json: { error: "Nedostaje ZIP za: Test buyer." } });
        if (mode === "empty") return route.fulfill({ status: 200, contentType: mime, body: "" });
        await new Promise((resolve) => { release = resolve; });
        return route.fulfill({ status: 200, contentType: mime, headers: { "Content-Disposition": 'attachment; filename="IMPORT-ELKO-test.xlsx"' }, body: bytes });
      });
      await page.goto(`${base}/orders`);
      const button = page.getByRole("button", { name: /^Preuzmi Excel:/ });
      await button.waitFor();
      assert.equal(requests, 0, "rendering must not prefetch a write-bearing export");
      await button.click();
      await page.getByRole("button", { name: "Pripremam Excel", exact: true }).waitFor();
      assert.ok(await page.getByRole("button", { name: "Pripremam Excel", exact: true }).isDisabled());
      await page.getByRole("button", { name: "Pripremam Excel", exact: true }).evaluate((element) => { element.click(); element.click(); });
      await page.waitForFunction(() => document.querySelector('[aria-busy="true"]') !== null);
      assert.equal(requests, 1, "repeated clicks must not create more export requests");
      assert.ok(release);
      assert.ok(await page.getByRole("button", { name: "Pripremam Excel", exact: true }).evaluate((element) => {
        const text = element.querySelector("span").getBoundingClientRect();
        const button = element.getBoundingClientRect();
        return text.height < 30 && text.right <= button.right && text.bottom <= button.bottom;
      }), "loading label must fit on one line inside the button");
      await page.screenshot({ path: `/tmp/galago-export-pending-${width}.png` });
      const downloaded = page.waitForEvent("download");
      release();
      assert.equal((await downloaded).suggestedFilename(), "IMPORT-ELKO-test.xlsx");
      await page.getByRole("link", { name: "Preuzmi ponovo" }).waitFor();
      const again = page.waitForEvent("download");
      await page.getByRole("link", { name: "Preuzmi ponovo" }).click();
      await again;
      assert.equal(requests, 1, "repeat download must reuse the same file without re-reading or marking Sheets");

      for (mode of ["error", "html", "network", "empty"]) {
        await button.click();
        await page.locator('p[role="alert"]').waitFor();
        assert.ok(await button.isEnabled());
        assert.equal(await page.getByRole("link", { name: "Preuzmi ponovo" }).count(), 0);
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal overflow");
      await page.screenshot({ path: `/tmp/galago-export-error-${width}.png` });
      mode = "timeout";
      await page.clock.install();
      await button.click();
      await page.clock.fastForward(120_001);
      await page.locator('p[role="alert"]').filter({ hasText: "Priprema traje predugo" }).waitFor();
      assert.ok(await button.isEnabled());

      mode = "review";
      await button.click();
      await page.waitForURL("**/orders?view=export&exportError=review&refresh=1#risk-alerts");
      mode = "login";
      await page.getByRole("button", { name: /^Preuzmi Excel:/ }).click();
      await page.waitForURL("**/login");
      assert.deepEqual(errors, []);
      console.log(`Export browser flow passed at ${width}px: one request, download, retry link, errors, timeout, review and expired session.`);
      await context.close();
    }
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
