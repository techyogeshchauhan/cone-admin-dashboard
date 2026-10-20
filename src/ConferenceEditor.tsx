import { useEffect, useState } from "react";
import { request } from "./firebase";
export default function ConferenceEditor() {
  const [data, setData] = useState<Record<string, unknown> | null>(null),
    [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    request("/conference")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  const fields = [
    { key: "name", label: "Conference name", required: true },
    { key: "shortName", label: "Short name", required: true },
    { key: "startDate", label: "Start date", type: "date" },
    { key: "endDate", label: "End date", type: "date" },
    { key: "venue", label: "Main venue" },
    { key: "contactEmail", label: "Organizer contact email", type: "email" },
    { key: "contactMobile", label: "Organizer contact mobile", type: "tel" },
  ];
  return (
    <section className="panel">
      <h2>Set the stage.</h2>
      <p className="subtitle">
        Publish official details when confirmed. Keep unconfirmed dates and
        locations empty.
      </p>
      {error && (
        <p className="message" role="alert">
          {error}
        </p>
      )}
      {note && <p className="success">{note}</p>}
      {data ? (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            try {
              await request("/conference", {
                method: "PUT",
                body: JSON.stringify(
                  Object.fromEntries(new FormData(e.currentTarget)),
                ),
              });
              setNote(
                "Conference details saved. Existing schedules and summary data are preserved.",
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-grid">
            {fields.map((f) => (
              <label key={f.key}>
                {f.label}
                <input
                  name={f.key}
                  type={f.type || "text"}
                  required={f.required}
                  defaultValue={String(data[f.key] || "")}
                />
              </label>
            ))}
            <label>
              Timezone
              <select name="timezone">
                <option value="Asia/Kolkata">India · Asia/Kolkata</option>
              </select>
            </label>
            <label>
              Publication status
              <select
                name="publicationStatus"
                defaultValue={String(data.publicationStatus || "draft")}
              >
                <option value="draft">Draft</option>
                <option value="published">Published</option>
              </select>
            </label>
          </div>
          <div className="form-actions">
            <button className="primary" disabled={busy}>
              Save conference
            </button>
          </div>
        </form>
      ) : (
        !error && <p className="loading">Loading conference…</p>
      )}
    </section>
  );
}
