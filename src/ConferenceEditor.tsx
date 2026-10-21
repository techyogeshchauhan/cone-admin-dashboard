import { useEffect, useState } from "react";
import { ImagePlus, Trash2 } from "lucide-react";
import { request } from "./firebase";
type Logo = { src: string; label: string };
const fields = [
  { key: "name", label: "Conference name", required: true },
  { key: "shortName", label: "Short name", required: true },
  { key: "edition", label: "Edition (for example 21st)" },
  { key: "startDate", label: "Start date", type: "date" },
  { key: "endDate", label: "End date", type: "date" },
  { key: "venue", label: "Main venue" },
  { key: "organizer", label: "Organised by" },
  { key: "organizerAddress", label: "Organiser address" },
  { key: "website", label: "Website", type: "url" },
  { key: "contactEmail", label: "Organizer contact email", type: "email" },
  { key: "contactMobile", label: "Organizer contact mobile", type: "tel" },
];
export default function ConferenceEditor() {
  const [data, setData] = useState<Record<string, unknown> | null>(null),
    [logos, setLogos] = useState<Logo[]>([]),
    [logoLabel, setLogoLabel] = useState(""),
    [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    request("/conference")
      .then((value) => {
        setData(value);
        setLogos((value.logos as Logo[]) || []);
      })
      .catch((e) => setError(e.message));
  }, []);
  async function addLogo(file: File) {
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.set("logo", file);
      const { src } = await request<{ src: string }>("/conference/logos", {
        method: "POST",
        body: form,
      });
      setLogos((old) => [
        ...old,
        { src, label: logoLabel.trim() || file.name },
      ]);
      setLogoLabel("");
      setNote(
        "Logo added. Save the conference to show it on the sign-in screen.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel">
      <h2>Set the stage.</h2>
      <p className="subtitle">
        Publish official details when confirmed. Keep unconfirmed dates and
        locations empty. Published details appear on the dashboard sign-in
        screen.
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
            const values = Object.fromEntries(new FormData(e.currentTarget));
            try {
              await request("/conference", {
                method: "PUT",
                body: JSON.stringify({
                  ...values,
                  // One highlight per line.
                  highlights: String(values.highlights || "")
                    .split(/\r?\n/)
                    .map((line) => line.trim())
                    .filter(Boolean),
                  logos,
                }),
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
                <option value="draft">
                  Draft (hidden from sign-in screen)
                </option>
                <option value="published">Published</option>
              </select>
            </label>
          </div>
          <div className="form-grid">
            <label>
              Theme
              <textarea
                name="theme"
                rows={3}
                maxLength={300}
                defaultValue={String(data.theme || "")}
              />
            </label>
            <label>
              Highlights · one per line, up to 8
              <textarea
                name="highlights"
                rows={6}
                defaultValue={((data.highlights as string[]) || []).join("\n")}
              />
            </label>
            <label>
              Tagline
              <input
                name="tagline"
                maxLength={200}
                defaultValue={String(data.tagline || "")}
              />
            </label>
          </div>
          <h3>Organiser logos</h3>
          <p className="inline-note">
            Shown on the sign-in screen, up to four. JPEG, PNG or WebP.
          </p>
          <ul className="logo-list">
            {logos.map((logo, i) => (
              <li key={logo.src}>
                <img src={logo.src} alt="" />
                <input
                  aria-label={`Name of logo ${i + 1}`}
                  value={logo.label}
                  maxLength={80}
                  required
                  onChange={(e) =>
                    setLogos((old) =>
                      old.map((l, j) =>
                        j === i ? { ...l, label: e.target.value } : l,
                      ),
                    )
                  }
                />
                <button
                  type="button"
                  className="text-button"
                  aria-label={`Remove ${logo.label}`}
                  onClick={() =>
                    setLogos((old) => old.filter((_, j) => j !== i))
                  }
                >
                  <Trash2 size={16} />
                  Remove
                </button>
              </li>
            ))}
          </ul>
          {logos.length < 4 && (
            <div className="toolbar">
              <input
                aria-label="Name of the new logo"
                placeholder="Organisation name"
                value={logoLabel}
                maxLength={80}
                onChange={(e) => setLogoLabel(e.target.value)}
              />
              <label className="secondary file-button">
                <ImagePlus size={16} />
                Add logo
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  hidden
                  disabled={busy}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    e.target.value = "";
                    if (file) void addLogo(file);
                  }}
                />
              </label>
            </div>
          )}
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
