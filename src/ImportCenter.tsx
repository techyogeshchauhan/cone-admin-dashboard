import { useEffect, useState } from "react";
import { Download, FileSpreadsheet, Upload, CheckCircle2 } from "lucide-react";
import { conferenceRoles } from "../shared/schema";
import { request } from "./firebase";
import SearchBox, { matchesSearch, NoMatches } from "./SearchBox";
import WorkbookImport from "./WorkbookImport";
import { LoadMore, usePagedList } from "./paging";
type Sheet = { name: string; rows: number; headers: string[] };
type Preview = {
  id: string;
  rows: {
    row: number;
    data: Record<string, unknown> | null;
    errors: string[];
  }[];
};
type Job = {
  id: string;
  kind?: string;
  fileName: string;
  status: string;
  total: number;
  createdAt: string;
};
const known: Record<string, string> = {
  "Name of Author(S)": "fullName",
  "Email Address": "email",
  Mobile: "mobile",
  "Organizational Affiliation": "affiliation",
  Discipline: "discipline",
  "CT.": "category",
  "O/P": "presentationType",
  "Registration Fee": "registrationFee",
  ACCO: "accommodation",
  "Soft Copy": "softCopy",
  "Earlier Awarded": "earlierAwardee",
};
const targets = [
  "fullName",
  "email",
  "mobile",
  "affiliation",
  "role",
  "registrationStatus",
  "discipline",
  "category",
  "presentationType",
  "registrationFee",
  "accommodation",
  "softCopy",
  "earlierAwardee",
];
function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function ImportCenter() {
  const [tab, setTab] = useState<"workbook" | "sheet">("workbook"),
    [file, setFile] = useState<File | null>(null),
    [sheets, setSheets] = useState<Sheet[]>([]),
    [sheet, setSheet] = useState(""),
    [mapping, setMapping] = useState<Record<string, string>>({}),
    [mode, setMode] = useState("create"),
    [defaultRole, setDefaultRole] = useState("attendee"),
    [preview, setPreview] = useState<Preview | null>(null),
    [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [query, setQuery] = useState("");
  // Import history, newest first, a page at a time.
  const jobList = usePagedList<Job>("/imports");
  const jobs = jobList.rows;
  const shownJobs = jobs.filter((job) =>
    matchesSearch(query, job.fileName, job.status, job.createdAt),
  );
  // The most recently saved workbook import stays on screen for review.
  const latestWorkbook =
    jobs
      .filter(
        (job) =>
          job.kind === "registrationWorkbook" &&
          ["running", "completed", "failed"].includes(job.status),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]?.id || "";
  useEffect(() => {
    if (revision) void jobList.reload();
  }, [revision]);
  useEffect(() => {
    const selected = sheets.find((s) => s.name === sheet);
    setMapping(
      Object.fromEntries(
        (selected?.headers || []).map((header) => [
          header,
          known[header] || (targets.includes(header) ? header : ""),
        ]),
      ),
    );
  }, [sheet, sheets]);
  async function inspect() {
    if (!file) return;
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const result = await request<Sheet[]>("/imports/inspect", {
        method: "POST",
        body: form,
      });
      setSheets(result);
      setSheet(result.find((s) => s.name !== "MAIN")?.name || "");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function validate() {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("sheet", sheet);
      form.set("mapping", JSON.stringify(mapping));
      form.set("mode", mode);
      form.set("defaultRole", defaultRole);
      setPreview(
        await request<Preview>("/imports/preview", {
          method: "POST",
          body: form,
        }),
      );
      setRevision((r) => r + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function commit(id: string, kind?: string) {
    if (
      !window.confirm(
        "Publish these reviewed participant records? Existing records may change in update mode.",
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      // A workbook import resumes in the background; its panel shows progress.
      if (kind === "registrationWorkbook") {
        await request(`/imports/workbook/${id}/commit`, { method: "POST" });
        setNote("Saving resumed. Progress is shown under Full workbook.");
        setTab("workbook");
        setRevision((r) => r + 1);
        return;
      }
      const result = await request<{
        created: number;
        updated: number;
        skipped?: number;
        existing?: number;
      }>(`/imports/${id}/commit`, { method: "POST" });
      setNote(
        `${result.created} created · ${result.updated} updated · ${result.skipped ?? result.existing ?? 0} preserved or already processed.`,
      );
      setPreview(null);
      setRevision((r) => r + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      {error && (
        <div className="message" role="alert">
          {error}
        </div>
      )}
      {note && <p className="success">{note}</p>}
      <div className="import-tabs" role="tablist" aria-label="Import type">
        {(
          [
            ["workbook", "Full workbook (all sheets)"],
            ["sheet", "Single sheet with manual mapping"],
          ] as const
        ).map(([id, name]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            className={tab === id ? "selected" : ""}
            onClick={() => setTab(id)}
          >
            {name}
          </button>
        ))}
      </div>
      {tab === "workbook" && (
        <WorkbookImport
          latestId={latestWorkbook}
          onChanged={() => setRevision((r) => r + 1)}
        />
      )}
      {tab === "sheet" && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Bring your registrations together</h2>
              <p>Upload → map columns → validate → review → publish</p>
            </div>
            <button
              className="secondary"
              onClick={async () => {
                try {
                  save(
                    await request<Blob>("/import-template"),
                    "cone-participants-template.xlsx",
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <Download size={16} />
              Template
            </button>
          </div>
          <div className="upload-zone">
            <FileSpreadsheet size={36} />
            <h3>Your next conference starts with a sheet.</h3>
            <p>.xlsx · maximum 5 MB · 2,000 rows · participant records</p>
            <input
              type="file"
              accept=".xlsx"
              aria-label="Select workbook"
              onChange={(e) => {
                setFile(e.target.files?.[0] || null);
                setSheets([]);
                setPreview(null);
              }}
            />
            <button
              className="primary"
              disabled={busy || !file}
              onClick={() => void inspect()}
            >
              <Upload size={17} />
              {busy ? "Processing…" : "Inspect workbook"}
            </button>
          </div>
          {sheets.length > 0 && (
            <>
              <div className="form-grid">
                <label>
                  Participant sheet
                  <select
                    value={sheet}
                    onChange={(e) => {
                      setSheet(e.target.value);
                      setPreview(null);
                    }}
                  >
                    {sheets
                      .filter((s) => s.name !== "MAIN")
                      .map((s) => (
                        <option key={s.name}>{s.name}</option>
                      ))}
                  </select>
                </label>
                <label>
                  Default conference role
                  <select
                    value={defaultRole}
                    onChange={(e) => setDefaultRole(e.target.value)}
                  >
                    {conferenceRoles.map((role) => (
                      <option key={role}>{role}</option>
                    ))}
                  </select>
                </label>
                <label>
                  Import mode
                  <select
                    value={mode}
                    onChange={(e) => setMode(e.target.value)}
                  >
                    <option value="create">
                      Create only — preserve existing emails
                    </option>
                    <option value="update">
                      Create + update — match normalized email
                    </option>
                  </select>
                </label>
              </div>
              <h3>Match your columns</h3>
              <div className="form-grid">
                {Object.keys(mapping)
                  .filter(Boolean)
                  .map((header) => (
                    <label key={header}>
                      {header}
                      <select
                        value={mapping[header]}
                        onChange={(e) =>
                          setMapping((old) => ({
                            ...old,
                            [header]: e.target.value,
                          }))
                        }
                      >
                        <option value="">Ignore column</option>
                        {targets.map((target) => (
                          <option key={target}>{target}</option>
                        ))}
                      </select>
                    </label>
                  ))}
              </div>
              <button
                className="primary"
                disabled={busy || !sheet}
                onClick={() => void validate()}
              >
                <CheckCircle2 size={17} />
                Validate mapped rows
              </button>
            </>
          )}
          <p className="inline-note">
            Header row must be row 1. MAIN is treated as a summary, not
            participant data. Review multi-author cells before identifying an
            account holder. Update mode replaces mapped participant fields and
            normalized defaults; review the full preview before confirming.
          </p>
        </section>
      )}
      {tab === "sheet" && preview && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Review before publishing</h2>
              <p>
                {preview.rows.length} rows ·{" "}
                {preview.rows.filter((r) => r.errors.length).length} with errors
              </p>
            </div>
            <button
              className="primary"
              disabled={
                busy ||
                !preview.rows.length ||
                preview.rows.some((r) => r.errors.length)
              }
              onClick={() => void commit(preview.id)}
            >
              Confirm import
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Validation</th>
                </tr>
              </thead>
              <tbody>
                {preview.rows.map((row) => (
                  <tr key={row.row}>
                    <td>{row.row}</td>
                    <td>{String(row.data?.fullName || "—")}</td>
                    <td>{String(row.data?.email || "—")}</td>
                    <td>{row.errors.join("; ") || "Ready"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <button
            className="text-button"
            onClick={() =>
              save(
                new Blob([JSON.stringify(preview.rows, null, 2)], {
                  type: "application/json",
                }),
                "import-validation.json",
              )
            }
          >
            Download full row validation report
          </button>
        </section>
      )}
      <section className="panel">
        <div className="panel-heading">
          <h2>Import history</h2>
          <button
            className="text-button"
            onClick={() => setRevision((r) => r + 1)}
          >
            Refresh
          </button>
        </div>
        <SearchBox
          value={query}
          onChange={setQuery}
          label="imports by workbook or status"
          shown={shownJobs.length}
          total={jobs.length}
        />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Workbook</th>
                <th>Status</th>
                <th>Rows</th>
                <th>Created</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {shownJobs.map((job) => (
                <tr key={job.id}>
                  <td>{job.fileName}</td>
                  <td>
                    <span className="badge">{job.status}</span>
                  </td>
                  <td>{job.total}</td>
                  <td>{job.createdAt}</td>
                  <td>
                    {job.status === "failed" && (
                      <button
                        className="text-button"
                        disabled={busy}
                        onClick={() => void commit(job.id, job.kind)}
                      >
                        Retry failed import
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {jobList.loaded && !jobs.length && (
            <p className="inline-note">No imports yet.</p>
          )}
          {jobs.length > 0 && !shownJobs.length && (
            <NoMatches what="imports" query={query} />
          )}
          {jobList.error && <p className="message">{jobList.error}</p>}
          <LoadMore
            next={jobList.next}
            loading={jobList.loading}
            onLoad={jobList.loadMore}
          />
        </div>
      </section>
    </>
  );
}
