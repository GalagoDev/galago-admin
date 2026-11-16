import fs from "node:fs/promises";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

async function readLines(file) {
  const task = getDocument({ data: new Uint8Array(await fs.readFile(file)), useSystemFonts: true, isEvalSupported: false, verbosity: 0 });
  const doc = await task.promise;
  if (doc.numPages > 20) throw new Error("Too many pages");
  const lines = [];
  let size = 0;
  for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
    const page = await doc.getPage(pageNo);
    const content = await page.getTextContent();
    const rows = [];
    for (const item of content.items) {
      if (!("str" in item) || !item.str.trim()) continue;
      size += item.str.length;
      if (size > 200_000) throw new Error("Too much text");
      const y = item.transform[5];
      let row = rows.find(r => Math.abs(r.y - y) < 2.5);
      if (!row) { row = { y, items: [] }; rows.push(row); }
      row.items.push({ x: item.transform[4], text: item.str });
    }
    for (const row of rows.sort((a, b) => b.y - a.y)) lines.push(row.items.sort((a, b) => a.x - b.x).map(i => i.text).join(" "));
    page.cleanup();
  }
  await doc.destroy();
  return lines;
}
try {
  if (process.argv[2] === "--batch") {
    const files = process.argv.slice(3);
    if (files.length > 40) throw new Error("Too many files");
    const result = [];
    for (const file of files) result.push(await readLines(file));
    process.stdout.write(JSON.stringify(result));
  } else process.stdout.write(JSON.stringify(await readLines(process.argv[2])));
} catch {
  process.stderr.write("PDF text could not be read.");
  process.exitCode = 1;
}
