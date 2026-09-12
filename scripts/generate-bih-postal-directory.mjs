import fs from "node:fs/promises";

const SOURCE_URL = "https://www.post.ba/express-mail/where-do-we-deliver";

function decodeHtml(value) {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&Scaron;/g, "Š")
    .replace(/&scaron;/g, "š")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/\s+/g, " ")
    .trim();
}

const response = await fetch(SOURCE_URL);
if (!response.ok) throw new Error(`Postal directory download failed: ${response.status}`);

const html = await response.text();
const cells = [...html.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) => decodeHtml(match[1]));
const entries = [];

for (let index = 0; index < cells.length - 1; index += 1) {
  if (!/^\d{5}$/.test(cells[index])) continue;
  const place = cells[index + 1];
  if (!place || /^\d{5}$/.test(place)) continue;
  entries.push([place, cells[index]]);
}

const uniqueEntries = Array.from(new Map(entries.map(([place, postalCode]) => [`${place}\u001f${postalCode}`, [place, postalCode]])).values());
if (uniqueEntries.length < 400) throw new Error(`Postal directory is unexpectedly short: ${uniqueEntries.length}`);

const output = [
  `// Generated from ${SOURCE_URL}`,
  "// Run `node scripts/generate-bih-postal-directory.mjs` to refresh.",
  "export const OFFICIAL_BIH_POSTAL_DIRECTORY = [",
  ...uniqueEntries.map(([place, postalCode]) => `  [${JSON.stringify(place)}, ${JSON.stringify(postalCode)}],`),
  "] as const;",
  "",
].join("\n");

await fs.writeFile(new URL("../src/lib/bih-postal-directory.ts", import.meta.url), output, "utf8");
console.log(`Generated ${uniqueEntries.length} official postal place/code pairs.`);
