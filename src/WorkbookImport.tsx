import { useEffect, useState } from "react";
import { CheckCircle2, Download, FileSpreadsheet, Upload } from "lucide-react";
import { conferenceRoles } from "../shared/schema";
import { problemColumns, problemFields } from "../shared/registration-columns";
import { request } from "./firebase";
import { LoadMore, useIncremental } from "./paging";
type Status = "ready" | "needs_fix" | "duplicate";
type Row = {
  sheet: string;
  row: number;
  email: string;
  status: Status;
  original: Record<string, string>;
  person: Record<string, unknown> | null;
  errors: string[];
  warnings: string[];
};
type Sheet = {
  name: string;
  headerRow: number | null;
  rows: number;
  ready: number;
  needsFix: number;
  skipped: number;
  note?: string;
};
type Summary = {
  sheet: string;
  title: string;
  headerRows: number;
  rows: { cells: { text: string; colSpan?: number; rowSpan?: number }[] }[];
};
type Preview = {
  id: string;
  mode: string;
  sheets: Sheet[];
  rows: Row[];
  summaries: Summary[];
};
type ReportRow = {
  sheet: string;
  row: number;
  email: string;
  status: string;
  problems: string[];
  invalidFields: string[];
  invalidColumns: string[];
  original: Record<string, string>;
};
type Report = {
  job: {
    id: string;
    fileName: string;
    status: string;
    createdAt: string;
    completedAt?: string;
    total: number;
    created?: number;
    updated?: number;
    existing?: number;
    loginReady?: number;
    loginFailed?: number;
    processed?: number;
    rowErrors?: number;
    lastError?: string;
    stalled?: boolean;
  };
  summaries: Summary[];
  rowsToFix: ReportRow[];
};
const labels: Record<string, string> = {
  ready: "Ready",
  needs_fix: "Needs fix",
  duplicate: "Duplicate",
  login_failed: "Login failed",
};
const pick = (original: Record<string, string>, pattern: RegExp) =>
  Object.entries(original).find(([header]) => pattern.test(header))?.[1] || "";
const nameOf = (r: { original: Record<string, string> }) =>
  pick(r.original, /author|name/i);
const mobileOf = (r: { original: Record<string, string> }) =>
  pick(r.original, /mobile/i);

// A table cell that turns red when its value is missing or invalid.
function Checked({ value, invalid }: { value: string; invalid: boolean }) {
  if (!invalid) return <td>{value || "—"}</td>;
  return (
    <td className="cell-invalid" title={value ? "Invalid" : "Missing"}>
      {value || "Missing"}
    </td>
  );
}

async function downloadRowsToFix(id: string) {
  const blob = await request<Blob>(`/imports/workbook/${id}/rows-to-fix`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "rows-to-fix.xlsx";
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// A summary sheet such as MAIN, with Excel's merged cells as col/row spans.
function SummaryTable({ summary }: { summary: Summary }) {
  return (
    <>
      <h3>
        {summary.sheet} sheet{summary.title ? ` · ${summary.title}` : ""}
      </h3>
      <div className="table-wrap">
        <table className="summary-sheet">
          <tbody>
            {summary.rows.map((row, i) => (
              <tr key={i}>
                {row.cells.map((cell, j) => {
                  const Cell = i < summary.headerRows ? "th" : "td";
                  return (
                    <Cell key={j} colSpan={cell.colSpan} rowSpan={cell.rowSpan}>
                      {cell.text}
                    </Cell>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function OriginalData({
  original,
  invalid = [],
}: {
  original: Record<string, string>;
  invalid?: string[];
}) {
  return (
    <details>
      <summary>View</summary>
      <dl>
        {Object.entries(original).map(([k, v]) => (
          <div key={k} className={invalid.includes(k) ? "cell-invalid" : ""}>
            <dt>{k}</dt>
            <dd>{v || (invalid.includes(k) ? "Missing" : "—")}</dd>
          </div>
        ))}
      </dl>
    </details>
  );
}

function RowsToFix({
  id,
  rows,
  onError,
}: {
  id: string;
  rows: ReportRow[];
  onError: (message: string) => void;
}) {
  const { shown, more, showMore } = useIncremental(rows, id);
  return (
    <>
      <div className="panel-heading">
        <div>
          <h3>Rows to fix ({rows.length})</h3>
          <p>
            Their original data is saved, but they are not participants yet.
          </p>
        </div>
        {rows.length > 0 && (
          <button
            className="secondary"
            onClick={() =>
              void downloadRowsToFix(id).catch((e) =>
                onError((e as Error).message),
              )
            }
          >
            <Download size={16} />
            Download Excel
          </button>
        )}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Sheet · row</th>
              <th>Name</th>
              <th>Email</th>
              <th>Mobile</th>
              <th>Problem</th>
              <th>Original data</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((r, i) => (
              <tr key={`${r.sheet}-${r.row}`}>
                <td>{i + 1}</td>
                <td>
                  {r.sheet} · {r.row}
                </td>
                <Checked
                  value={nameOf(r)}
                  invalid={r.invalidFields.includes("fullName")}
                />
                <Checked
                  value={r.email}
                  invalid={r.invalidFields.includes("email")}
                />
                <Checked
                  value={mobileOf(r)}
                  invalid={r.invalidFields.includes("mobile")}
                />
                <td>
                  <span className="badge">{labels[r.status] || r.status}</span>{" "}
                  {r.problems.join("; ")}
                </td>
                <td>
                  <OriginalData
                    original={r.original}
                    invalid={r.invalidColumns}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <LoadMore next={more} loading={false} onLoad={showMore} />
        {!rows.length && (
          <p className="inline-note">Every row was imported. Nothing to fix.</p>
        )}
      </div>
    </>
  );
}

type Progress = {
  status: string;
  stalled: boolean;
  processed: number | null;
  total: number | null;
};
// The saved result of a workbook import, available any time after saving.
// While saving runs in the background it shows progress, then the result.
function WorkbookReport({ id, revision }: { id: string; revision: number }) {
  const [report, setReport] = useState<Report | null>(null),
    [progress, setProgress] = useState<Progress | null>(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [reload, setReload] = useState(0);
  useEffect(() => {
    request<Report>(`/imports/workbook/${id}/report`)
      .then((value) => {
        setReport(value);
        setProgress(null);
      })
      .catch((e) => setError(e.message));
  }, [id, revision, reload]);
  const running = report?.job.status === "running" && !report.job.stalled;
  useEffect(() => {
    if (!running) return;
    let stopped = false;
    (async () => {
      while (!stopped) {
        await new Promise((resolve) => setTimeout(resolve, 2500));
        const value = await request<Progress>(`/imports/workbook/${id}/status`);
        if (stopped) return;
        setProgress(value);
        if (value.status !== "running" || value.stalled)
          return setReload((r) => r + 1);
      }
    })().catch((e) => setError((e as Error).message));
    return () => {
      stopped = true;
    };
  }, [id, running]);
  async function retry() {
    setBusy(true);
    setError("");
    try {
      await request(`/imports/workbook/${id}/commit`, { method: "POST" });
      setReload((r) => r + 1);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!report)
    return error ? (
      <div className="message" role="alert">
        {error}
      </div>
    ) : (
      <p className="inline-note">Loading saved import…</p>
    );
  const { job } = report;
  const done = progress?.processed ?? job.processed ?? 0;
  return (
    <section className="panel">
      {error && (
        <div className="message" role="alert">
          {error}
        </div>
      )}
      <div className="panel-heading">
        <div>
          <h2>{running ? "Saving workbook…" : "Latest workbook import"}</h2>
          <p>
            {job.fileName} · {job.status}
            {job.completedAt
              ? ` · saved ${new Date(job.completedAt).toLocaleString()}`
              : ""}{" "}
            · {job.total} rows · {job.created ?? 0} created · {job.updated ?? 0}{" "}
            updated · {job.existing ?? 0} already existed · login ready for{" "}
            {job.loginReady ?? 0}
          </p>
        </div>
      </div>
      {running && (
        <div className="import-progress">
          <progress max={job.total} value={done} />
          <span>
            {done} / {job.total} rows saved. You can leave this page; saving
            continues on the server.
          </span>
        </div>
      )}
      {(job.status === "failed" || job.stalled) && (
        <div className="message" role="alert">
          {job.rowErrors
            ? `${job.rowErrors} rows could not be saved, usually because of a network interruption. `
            : ""}
          {job.loginFailed
            ? `Login setup failed for ${job.loginFailed} participants. `
            : ""}
          {job.stalled
            ? "Saving stopped before finishing, for example because the server restarted. "
            : !job.rowErrors && !job.loginFailed
              ? "Saving stopped before finishing. "
              : ""}
          {job.lastError ? `Last error: ${job.lastError}. ` : ""}
          Retry saves only what is missing.{" "}
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void retry()}
          >
            {busy ? "Retrying…" : "Retry"}
          </button>
        </div>
      )}
      {report.summaries.map((s) => (
        <SummaryTable key={s.sheet} summary={s} />
      ))}
      <RowsToFix id={id} rows={report.rowsToFix} onError={setError} />
    </section>
  );
}

export default function WorkbookImport({
  latestId,
  onChanged,
}: {
  latestId: string;
  onChanged: () => void;
}) {
  const [file, setFile] = useState<File | null>(null),
    [defaultRole, setDefaultRole] = useState("presenter"),
    [registrationStatus, setRegistrationStatus] = useState("pending"),
    [mode, setMode] = useState("create"),
    [preview, setPreview] = useState<Preview | null>(null),
    [filter, setFilter] = useState<"all" | Status>("all"),
    [sheetFilter, setSheetFilter] = useState(""),
    [savedId, setSavedId] = useState(""),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const reportId = savedId || latestId;
  const count = (status: Status) =>
    preview?.rows.filter((r) => r.status === status).length || 0;
  const matching = (preview?.rows || []).filter(
    (r) =>
      (filter === "all" || r.status === filter) &&
      (!sheetFilter || r.sheet === sheetFilter),
  );
  // A workbook can hold thousands of rows: render them a screenful at a time.
  const { shown, more, showMore } = useIncremental(
    matching,
    `${preview?.id}:${filter}:${sheetFilter}`,
  );
  async function read() {
    if (!file) return;
    setBusy(true);
    setError("");
    setPreview(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("defaultRole", defaultRole);
      form.set("registrationStatus", registrationStatus);
      form.set("mode", mode);
      setPreview(
        await request<Preview>("/imports/workbook/preview", {
          method: "POST",
          body: form,
        }),
      );
      setFilter("all");
      setSheetFilter("");
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function commit() {
    if (!preview) return;
    if (
      !window.confirm(
        `Save ${count("ready")} participants and the original data of all ${preview.rows.length} rows${preview.summaries.length ? " plus the summary sheet" : ""}? ${mode === "update" ? "Existing participants with the same email will be updated." : "Existing participants are kept as they are."}`,
      )
    )
      return;
    setBusy(true);
    setError("");
    try {
      await request(`/imports/workbook/${preview.id}/commit`, {
        method: "POST",
      });
      setSavedId(preview.id);
      setRevision((r) => r + 1);
      setPreview(null);
      onChanged();
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
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Import the full registration workbook</h2>
            <p>
              Upload → automatic column matching on every sheet → review → save
            </p>
          </div>
        </div>
        <div className="upload-zone">
          <FileSpreadsheet size={36} />
          <h3>Upload the Excel exactly as you received it.</h3>
          <p>
            .xlsx · maximum 5 MB · all discipline sheets are read together · the
            MAIN summary sheet is shown as a table · total rows are skipped
          </p>
          <input
            type="file"
            accept=".xlsx"
            aria-label="Select registration workbook"
            onChange={(e) => {
              setFile(e.target.files?.[0] || null);
              setPreview(null);
            }}
          />
        </div>
        <div className="form-grid">
          <label>
            Conference role for imported people
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
            Registration status
            <select
              value={registrationStatus}
              onChange={(e) => setRegistrationStatus(e.target.value)}
            >
              <option value="pending">pending</option>
              <option value="confirmed">confirmed</option>
            </select>
          </label>
          <label>
            If the email already exists
            <select value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="create">Keep the existing participant</option>
              <option value="update">Update it from the workbook</option>
            </select>
          </label>
        </div>
        <button
          className="primary"
          disabled={busy || !file}
          onClick={() => void read()}
        >
          <Upload size={17} />
          {busy && !preview ? "Reading…" : "Read workbook"}
        </button>
        <p className="inline-note">
          Every row's original cells are saved as they appear in Excel. Only
          rows with a valid name, email, ten-digit mobile and affiliation become
          participants who can sign in to the app with an email OTP. Fix the
          other rows in Excel and upload again with "Update it from the
          workbook".
        </p>
      </section>
      {preview && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Review before saving</h2>
              <p>
                {preview.rows.length} rows from{" "}
                {preview.sheets.filter((s) => s.headerRow).length} sheets
              </p>
            </div>
            <button
              className="primary"
              disabled={busy || !count("ready")}
              onClick={() => void commit()}
            >
              <CheckCircle2 size={17} />
              {busy ? "Saving…" : `Save ${count("ready")} participants`}
            </button>
          </div>
          <div className="metrics">
            {(
              [
                [
                  "Rows found",
                  preview.rows.length,
                  "all",
                  "Original data saved for each",
                ],
                [
                  "Ready",
                  count("ready"),
                  "ready",
                  "Become participants with login",
                ],
                [
                  "Needs fix",
                  count("needs_fix"),
                  "needs_fix",
                  "Saved as original rows only",
                ],
                [
                  "Duplicate",
                  count("duplicate"),
                  "duplicate",
                  "Same email appears earlier",
                ],
              ] as const
            ).map(([label, value, status, note]) => (
              <button
                type="button"
                className="metric overview-link"
                key={label}
                aria-pressed={filter === status}
                onClick={() => setFilter(status)}
              >
                <span className="metric-top">{label}</span>
                <strong>{value}</strong>
                <small>{note}</small>
              </button>
            ))}
          </div>
          {preview.summaries.map((s) => (
            <SummaryTable key={s.sheet} summary={s} />
          ))}
          <h3>Sheets</h3>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Sheet</th>
                  <th>Header row</th>
                  <th>Rows</th>
                  <th>Ready</th>
                  <th>Needs fix</th>
                  <th>Skipped</th>
                </tr>
              </thead>
              <tbody>
                {preview.sheets.map((s) => (
                  <tr key={s.name}>
                    <td>
                      {s.headerRow ? (
                        <button
                          className="text-button"
                          onClick={() =>
                            setSheetFilter(sheetFilter === s.name ? "" : s.name)
                          }
                        >
                          {s.name}
                        </button>
                      ) : (
                        s.name
                      )}
                    </td>
                    <td>{s.headerRow ?? "—"}</td>
                    <td>{s.rows}</td>
                    <td>{s.ready}</td>
                    <td>{s.needsFix}</td>
                    <td>{s.note || s.skipped}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="panel-heading">
            <h3>
              {filter === "all" ? "All rows" : labels[filter]}
              {sheetFilter ? ` · ${sheetFilter}` : ""} ({matching.length})
            </h3>
            <div>
              {(filter !== "all" || sheetFilter) && (
                <button
                  className="text-button"
                  onClick={() => {
                    setFilter("all");
                    setSheetFilter("");
                  }}
                >
                  Show all
                </button>
              )}
              {count("needs_fix") + count("duplicate") > 0 && (
                <button
                  className="secondary"
                  onClick={() =>
                    void downloadRowsToFix(preview.id).catch((e) =>
                      setError((e as Error).message),
                    )
                  }
                >
                  <Download size={16} />
                  Rows to fix (Excel)
                </button>
              )}
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Sheet · row</th>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Mobile</th>
                  <th>Status</th>
                  <th>Original data</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <tr key={`${r.sheet}-${r.row}`}>
                    <td>
                      {r.sheet} · {r.row}
                    </td>
                    <Checked
                      value={nameOf(r)}
                      invalid={problemFields(r.errors).includes("fullName")}
                    />
                    <Checked
                      value={r.email}
                      invalid={problemFields(r.errors).includes("email")}
                    />
                    <Checked
                      value={mobileOf(r)}
                      invalid={problemFields(r.errors).includes("mobile")}
                    />
                    <td>
                      <span
                        className={`badge${r.status === "ready" ? " positive" : ""}`}
                      >
                        {labels[r.status]}
                      </span>{" "}
                      {[...r.errors, ...r.warnings].join("; ")}
                    </td>
                    <td>
                      <OriginalData
                        original={r.original}
                        invalid={problemColumns(r.original, r.errors)}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <LoadMore next={more} loading={false} onLoad={showMore} />
          </div>
        </section>
      )}
      {!preview && reportId && (
        <WorkbookReport id={reportId} revision={revision} />
      )}
    </>
  );
}
