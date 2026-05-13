import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const problemCsvPath = path.join(root, "source", "problem.csv");
const formulaCsvPath = path.join(root, "source", "fomula.csv");
const publicProblemsDir = path.join(root, "public", "problems");

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

function parseCsv(csv) {
  const lines = csv.trim().split(/\r?\n/);
  const headers = parseCsvLine(lines[0]);
  return lines
    .slice(1)
    .map((line) => parseCsvLine(line))
    .filter((row) => row.some((value) => value.trim()))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

const formulas = parseCsv(await readFile(formulaCsvPath, "utf8"));
const formulaById = new Map(
  formulas.map((formula) => [
    formula.ID,
    {
      majorCategory: formula["大分類"],
      minorCategory: formula["小分類"],
      formulaLatex: formula["数式（LaTeX）"]
    }
  ])
);

const problems = parseCsv(await readFile(problemCsvPath, "utf8")).map((record) => {
  const formula = formulaById.get(record["対象ID"]) || {};
  return {
    id: record["問題ID"],
    formulaId: record["対象ID"],
    majorCategory: formula.majorCategory || "未分類",
    minorCategory: formula.minorCategory || "未分類",
    formulaName: record["公式名"],
    formulaLatex: formula.formulaLatex || record["数式（LaTeX）"],
    question: record["問題"],
    latex: record["数式（LaTeX）"],
    answer: record["解答"]
  };
});

await mkdir(publicProblemsDir, { recursive: true });
await writeFile(
  path.join(publicProblemsDir, "problems.json"),
  `${JSON.stringify({ problems }, null, 2)}\n`
);
await writeFile(
  path.join(publicProblemsDir, "manifest.json"),
  `${JSON.stringify(
    {
      problems: problems.map((problem) => ({
        id: problem.id,
        title: problem.question,
        majorCategory: problem.majorCategory,
        minorCategory: problem.minorCategory,
        formulaId: problem.formulaId,
        formulaName: problem.formulaName
      }))
    },
    null,
    2
  )}\n`
);

console.log(`Synced ${problems.length} problem(s) to public/problems.`);
