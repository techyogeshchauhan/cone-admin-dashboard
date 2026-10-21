// The audit trail and code-check reports are append-only history, so they are
// kept in local log files instead of Firestore, where every entry was a billed
// document write and every look at them billed reads. Each kind has one file
// per day (logs/audit-2026-10-21.log), one JSON object per line.
import { randomUUID } from "node:crypto";
import { appendFile, mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

export type LogKind = "audit" | "analysis";
type Entry = Record<string, unknown> & { id: string };

const directory = () => path.resolve(process.env.LOG_DIR || "logs");
const fileFor = (kind: LogKind, at: string) =>
  path.join(directory(), `${kind}-${at.slice(0, 10)}.log`);

export async function appendLog(
  kind: LogKind,
  entry: Record<string, unknown>,
  timeField = "createdAt",
) {
  const at = String(entry[timeField] || new Date().toISOString());
  const record = { id: randomUUID(), ...entry, [timeField]: at };
  await mkdir(directory(), { recursive: true });
  // One write per line in append mode, so concurrent writers do not mix lines.
  await appendFile(fileFor(kind, at), `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

export type AuditEntry = {
  actorUid: string;
  actorName?: string;
  action: string;
  target: string;
  [field: string]: unknown;
};
// Called after a change has committed: a log that cannot be written is
// reported on the server console, never turned into a failed request.
export async function recordAudit(entry: AuditEntry) {
  try {
    return await appendLog("audit", { conferenceId: "main", ...entry });
  } catch (error) {
    console.error("Audit log could not be written", entry, error);
    return null;
  }
}

// Newest first, a page at a time; the cursor is the id of the last entry of
// the previous page.
export async function readLog(
  kind: LogKind,
  options: { limit: number; after?: string },
) {
  let files: string[];
  try {
    files = (await readdir(directory()))
      .filter((f) => f.startsWith(`${kind}-`) && f.endsWith(".log"))
      .sort()
      .reverse();
  } catch {
    return { rows: [] as Entry[], next: null };
  }
  const rows: Entry[] = [];
  let reached = !options.after;
  for (const file of files) {
    const lines = (await readFile(path.join(directory(), file), "utf8"))
      .split("\n")
      .filter(Boolean);
    for (const line of lines.reverse()) {
      let entry: Entry;
      try {
        entry = JSON.parse(line);
      } catch {
        continue; // A line cut short by a crash is skipped.
      }
      if (!reached) {
        reached = entry.id === options.after;
        continue;
      }
      if (rows.length === options.limit)
        return { rows, next: rows.at(-1)!.id };
      rows.push(entry);
    }
  }
  return { rows, next: null };
}
