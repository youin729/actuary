import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const outputDir = path.join(root, "output");
const publicProblemsDir = path.join(root, "public", "problems");

async function collectJsonFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectJsonFiles(fullPath)));
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      files.push(fullPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b));
}

function safePublicName(filePath) {
  const relative = path.relative(outputDir, filePath);
  return relative.replace(/\\/g, "/").replace(/\//g, "__");
}

await rm(publicProblemsDir, { recursive: true, force: true });
await mkdir(publicProblemsDir, { recursive: true });

const jsonFiles = await collectJsonFiles(outputDir);
const manifest = [];

for (const filePath of jsonFiles) {
  const raw = await readFile(filePath, "utf8");
  const metadata = JSON.parse(raw);
  const publicName = safePublicName(filePath);
  await writeFile(path.join(publicProblemsDir, publicName), `${JSON.stringify(metadata, null, 2)}\n`);
  manifest.push({
    id: metadata.id,
    title: metadata.source?.problem_number
      ? `問題 ${metadata.source.problem_number}`
      : metadata.question?.slice(0, 28) || metadata.id,
    file: publicName,
    subject: metadata.subject,
    unit: metadata.unit,
    difficulty: metadata.difficulty
  });
}

await writeFile(
  path.join(publicProblemsDir, "manifest.json"),
  `${JSON.stringify({ problems: manifest }, null, 2)}\n`
);

console.log(`Synced ${manifest.length} problem JSON file(s) to public/problems.`);
