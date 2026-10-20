import "dotenv/config";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile } from "node:fs/promises";
import { db } from "./firebase.js";
const run = promisify(execFile);
const pkg = JSON.parse(await readFile("package.json", "utf8"));
let buildId = `${pkg.version}-${new Date().toISOString()}`;
try {
  buildId = (await run("git", ["rev-parse", "HEAD"])).stdout.trim();
} catch {
  /* This workspace may not be a Git checkout. */
}
for (const check of ["build", "test"]) {
  let result = "passed";
  let output = "";
  try {
    const npm = process.env.npm_execpath;
    if (!npm) throw new Error("Run through npm run analyze");
    output = (
      await run(process.execPath, [npm, "run", check], {
        timeout: 180000,
        maxBuffer: 2 * 1024 * 1024,
      })
    ).stdout;
  } catch (error) {
    result = "failed";
    output = String(
      (error as { stdout?: string }).stdout || "Check could not run",
    );
  }
  // Persist a bounded check summary; do not publish arbitrary environment or logs.
  await db.collection("analysisReports").add({
    tool: `npm run ${check}`,
    result,
    buildId,
    summary: output
      .split("\n")
      .filter((line) =>
        /passed|failed|built in|error TS|Test Files|Tests /.test(line),
      )
      .slice(-15)
      .join("\n"),
    generatedAt: new Date().toISOString(),
  });
  console.log(`${check}: ${result}`);
}
