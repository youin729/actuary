import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const csvPath = path.join(root, "fomula", "fomula.csv");
const publicFormulaDir = path.join(root, "public", "formulas");

function parseCsvLine(line) {
  const values = [];
  let current = "";
  let inQuote = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuote = !inQuote;
    } else if (char === "," && !inQuote) {
      values.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  values.push(current);
  return values;
}

const csv = await readFile(csvPath, "utf8");
const lines = csv.trim().split(/\r?\n/);
const headers = parseCsvLine(lines[0]);
const formulas = lines.slice(1).map((line) => {
  const row = parseCsvLine(line);
  const record = Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""]));
  return {
    id: record.ID,
    majorCategory: record["大分類"],
    minorCategory: record["小分類"],
    name: record["公式名"],
    latex: record["数式（LaTeX）"],
    importance: Number(record["重要度"] || 0)
  };
});

await mkdir(publicFormulaDir, { recursive: true });
await writeFile(
  path.join(publicFormulaDir, "formulas.json"),
  `${JSON.stringify({ formulas }, null, 2)}\n`
);

console.log(`Synced ${formulas.length} formula(s) to public/formulas.`);
