import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Download, Upload } from "lucide-react";
import { request } from "./firebase";
import { useDebounced, usePagedList } from "./paging";
import { can, type Actor } from "../shared/schema";
import { canOpenWorkspace } from "../shared/role-fields";
import {
  departmentColumns,
  type DepartmentCatalog,
  type DepartmentRow,
} from "../shared/department-records";

export default function DepartmentRecords({ actor }: { actor: Actor }) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [catalog, setCatalog] = useState<DepartmentCatalog | null>(null);
  const [department, setDepartment] = useState("");
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  function applyCatalog(value: DepartmentCatalog) {
    setCatalog(value);
    setDepartment(value.departments[0]?.name || "");
  }
  useEffect(() => {
    let active = true;
    request<DepartmentCatalog>("/department-records")
      .then((value) => {
        if (active) applyCatalog(value);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  async function upload(file: File) {
    setUploading(true);
    setError("");
    try {
      const form = new FormData();
      form.set("file", file);
      applyCatalog(
        await request<DepartmentCatalog>("/imports/department-source", {
          method: "POST",
          body: form,
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  return (
    <section
      className="panel department-records-page"
      aria-label="Department records workspace"
    >
      <div className="panel-heading">
        <div>
          <h2>Authors by department</h2>
          <p>
            Authors and their records, grouped by the Excel Discipline column
          </p>
        </div>
      </div>
      <p className="inline-note">
        Excel source records are read-only. They include incomplete
        registrations and may differ from current participant registrations.
      </p>
      {error && (
        <p className="message" role="alert">
          {error}
        </p>
      )}
      <div className="department-controls">
        <label>
          Department / Discipline
          <select
            aria-label="Department / Discipline"
            value={department}
            disabled={uploading || !catalog?.departments.length}
            onChange={(e) => setDepartment(e.target.value)}
          >
            {!catalog?.departments.length && (
              <option value="">No workbook loaded</option>
            )}
            {catalog?.departments.map((item) => (
              <option key={item.name} value={item.name}>
                {item.name} ({item.count})
              </option>
            ))}
          </select>
        </label>
        {canOpenWorkspace(actor, "imports") &&
          can(actor, "imports", "write") &&
          can(actor, "participants", "write") &&
          can(actor, "fees", "write") && (
            <div>
              <input
                ref={fileInput}
                hidden
                type="file"
                accept=".xlsx"
                aria-label="Department source workbook"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void upload(file);
                }}
              />
              <button
                className="secondary"
                disabled={uploading}
                onClick={() => fileInput.current?.click()}
              >
                <Upload size={16} />
                {uploading ? "Loading workbook…" : "Choose Excel"}
              </button>
            </div>
          )}
      </div>
      {catalog && (
        <p className="department-source">
          Source: {catalog.fileName || "No workbook loaded"} ·{" "}
          {catalog.departments.length} departments · {catalog.total} author
          records
        </p>
      )}
      {!catalog && !error && <p className="loading">Loading departments…</p>}
      {catalog && !department && (
        <p className="empty">
          Choose the registration Excel workbook to see each department's author
          records.
        </p>
      )}
      {catalog && department && (
        <DepartmentAuthors
          key={`${catalog.revision}:${department}`}
          actor={actor}
          catalog={catalog}
          department={department}
        />
      )}
    </section>
  );
}

function DepartmentAuthors({
  actor,
  catalog,
  department,
}: {
  actor: Actor;
  catalog: DepartmentCatalog;
  department: string;
}) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<DepartmentRow | null>(null);
  const [downloadError, setDownloadError] = useState("");
  const [downloading, setDownloading] = useState(false);
  const q = useDebounced(search.trim());
  const list = usePagedList<DepartmentRow>(
    "/department-records/rows",
    { department, revision: catalog.revision, limit: "50", q: q || undefined },
    "pages",
  );
  const count =
    catalog.departments.find((item) => item.name === department)?.count || 0;
  async function download() {
    setDownloading(true);
    setDownloadError("");
    try {
      const query = new URLSearchParams({
        department,
        revision: catalog.revision,
      });
      const blob = await request<Blob>(`/reports/department-records?${query}`);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${department.replace(/[^a-z0-9]+/gi, "-").slice(0, 80)}-records.xlsx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setDownloadError((e as Error).message);
    } finally {
      setDownloading(false);
    }
  }
  return (
    <section
      className="department-authors"
      aria-label="Selected department authors"
    >
      <div className="panel-heading">
        <div>
          <h3>{department}</h3>
          <p>{count} author records in this department</p>
        </div>
        {can(actor, "reports", "read") && (
          <button
            className="secondary"
            disabled={downloading}
            onClick={() => void download()}
          >
            <Download size={16} />
            {downloading ? "Downloading…" : "Download department"}
          </button>
        )}
      </div>
      {(list.error || downloadError) && (
        <p className="message" role="alert">
          {list.error || downloadError}
        </p>
      )}
      {selected ? (
        <article aria-label="Author record">
          <button className="text-button" onClick={() => setSelected(null)}>
            <ArrowLeft size={16} />
            Back to authors
          </button>
          <h3>{selected.fullName || "Author name not recorded"}</h3>
          <dl className="record-details department-author-details">
            {departmentColumns
              .filter(([key]) => key in selected)
              .map(([key, label]) => (
                <div key={key}>
                  <dt>{label}</dt>
                  <dd>{selected[key] || "Not recorded"}</dd>
                </div>
              ))}
          </dl>
        </article>
      ) : (
        <>
          <label className="department-author-search">
            Find author
            <input
              type="search"
              aria-label="Find author in department"
              placeholder="Name, email, affiliation or abstract title"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          {list.loading ? (
            <p className="loading">Loading author records…</p>
          ) : list.rows.length ? (
            <div
              className="table-wrap department-author-table"
              tabIndex={0}
              role="region"
              aria-label="Department author table"
            >
              <table>
                <thead>
                  <tr>
                    <th>Sr. No.</th>
                    <th>Name of Author(s)</th>
                    <th>Affiliation</th>
                    <th>Abstract title</th>
                    <th>Record</th>
                  </tr>
                </thead>
                <tbody>
                  {list.rows.map((row) => (
                    <tr key={row.id}>
                      <td>{row.srNo || "—"}</td>
                      <td>{row.fullName || "Not recorded"}</td>
                      <td>
                        <span
                          className="department-cell-preview"
                          title={row.affiliation}
                        >
                          {row.affiliation || "Not recorded"}
                        </span>
                      </td>
                      <td>
                        <span
                          className="department-cell-preview"
                          title={row.abstractTitle}
                        >
                          {row.abstractTitle || "Not recorded"}
                        </span>
                      </td>
                      <td>
                        <button
                          className="text-button"
                          aria-label={`View record for ${row.fullName || `row ${row.sourceRow}`}`}
                          onClick={() => setSelected(row)}
                        >
                          View record
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="empty">No matching authors in this department.</p>
          )}
          <nav
            className="record-pagination"
            aria-label="Department author pagination"
          >
            <span>Page {list.pageNumber} · Up to 50 rows per page</span>
            <div>
              <button
                className="secondary"
                disabled={list.loading || list.pageNumber === 1}
                onClick={list.previousPage}
              >
                <ArrowLeft size={16} />
                Previous
              </button>
              <button
                className="secondary"
                disabled={list.loading || !list.next}
                onClick={list.loadMore}
              >
                Next
                <ArrowRight size={16} />
              </button>
            </div>
          </nav>
        </>
      )}
    </section>
  );
}
