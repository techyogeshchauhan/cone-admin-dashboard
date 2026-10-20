import { useEffect, useState, type ReactNode, type FormEvent } from "react";
import { Mail, Plus, Send, Users, Wand2 } from "lucide-react";
import { request } from "./firebase";
import { conferenceRoles } from "../shared/schema";
import {
  personVariables,
  renderTemplate,
  templateVariables,
  type PersonRecord,
} from "../shared/email-templates";
import SearchBox, { matchesSearch, NoMatches } from "./SearchBox";
import SmtpSettings from "./SmtpSettings";
type Template = {
  id: string;
  name: string;
  subject: string;
  body: string;
  role?: string;
};
type Person = PersonRecord & {
  email: string;
  registrationStatus?: string;
  isDemo?: boolean;
};
const roleNames: Record<string, string> = {
  all: "All participants",
  presenter: "Presenters",
  attendee: "Attendees",
  speaker: "Speakers",
  vip: "VIP guests",
  organiser: "Organisers",
  volunteer: "Volunteers",
};
type Job = {
  id: string;
  recipient: string;
  status: string;
  attempts?: number;
  createdAt: string;
};
export default function EmailCenter({
  children,
  isSuperAdmin = false,
}: {
  children: ReactNode;
  isSuperAdmin?: boolean;
}) {
  const [templates, setTemplates] = useState<Template[]>([]),
    [jobs, setJobs] = useState<Job[]>([]),
    [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [revision, setRevision] = useState(0),
    [query, setQuery] = useState(""),
    [templateId, setTemplateId] = useState(""),
    [recipients, setRecipients] = useState(""),
    [audience, setAudience] = useState("all"),
    [loaded, setLoaded] = useState<Person[]>([]);
  const template = templates.find((t) => t.id === templateId);
  // Preview with the first loaded recipient, or sample fallbacks.
  const sample = personVariables(loaded[0] || {});
  async function addRoleTemplates() {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const { added } = await request<{ added: number }>(
        "/email/templates/defaults",
        { method: "POST" },
      );
      setRevision((r) => r + 1);
      setNote(
        added
          ? `Added ${added} role-based template${added === 1 ? "" : "s"}.`
          : "All role-based templates are already saved.",
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function loadAudience() {
    setBusy(true);
    setError("");
    setNote("");
    try {
      const query = new URLSearchParams({ excludeDemo: "true" });
      if (audience !== "all") query.set("role", audience);
      const page = await request<{ rows: Person[]; next: string | null }>(
        `/records/participants?${query}`,
      );
      // Demo accounts and inactive registrations are never added.
      const people = page.rows.filter(
        (p) =>
          !p.isDemo &&
          !["cancelled", "suspended"].includes(String(p.registrationStatus)),
      );
      setLoaded(people);
      setRecipients(people.map((p) => p.email).join("\n"));
      setNote(
        `${people.length} ${roleNames[audience].toLowerCase()} added as recipients${page.next ? " (first 50 only; queue the rest in another batch)" : ""}.`,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const shownJobs = jobs.filter((j) =>
    matchesSearch(query, j.recipient, j.status, j.createdAt),
  );
  useEffect(() => {
    Promise.all([
      request<Template[]>("/email/templates"),
      request<Job[]>("/email/jobs"),
    ])
      .then(([a, b]) => {
        setTemplates(a);
        setJobs(b);
      })
      .catch((e) => setError(e.message));
  }, [revision]);
  async function create(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError("");
    try {
      await request("/email/templates", {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      form.reset();
      setRevision((r) => r + 1);
      setNote("Template saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function queue(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    setBusy(true);
    setError("");
    try {
      const list = recipients
        .split(/[\n,;]/)
        .map((v) => v.trim())
        .filter(Boolean);
      await request("/email/queue", {
        method: "POST",
        body: JSON.stringify({
          templateId,
          recipients: list,
          requestId: crypto.randomUUID(),
        }),
      });
      form.reset();
      setRecipients("");
      setLoaded([]);
      setRevision((r) => r + 1);
      setNote("Messages queued. Run the email worker to deliver them.");
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
      <div className="overview-grid">
        <section className="panel">
          <span className="feature-icon">
            <Mail size={24} />
          </span>
          <h2>A message worth sending.</h2>
          <p className="subtitle">
            Save a plain-text template. Placeholders such as {"{{name}}"} or{" "}
            {"{{schedule}}"} are filled from each recipient's own registration.
          </p>
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => void addRoleTemplates()}
          >
            <Wand2 size={16} />
            Add role-based templates
          </button>
          <p className="inline-note">
            Adds ready-made emails for presenters, attendees, speakers, VIP
            guests, organisers, volunteers and everyone. Templates you already
            saved are kept.
          </p>
          <details className="placeholder-help">
            <summary>Available placeholders</summary>
            <dl>
              {templateVariables.map(([key, description]) => (
                <div key={key}>
                  <dt>
                    <code>{`{{${key}}}`}</code>
                  </dt>
                  <dd>{description}</dd>
                </div>
              ))}
            </dl>
          </details>
          <form onSubmit={create}>
            <label>
              Template name
              <input name="name" required maxLength={100} />
            </label>
            <label>
              Subject
              <input name="subject" required maxLength={150} />
            </label>
            <label>
              Message
              <textarea
                name="body"
                required
                rows={6}
                maxLength={10000}
                placeholder="Hello {{name}},"
              />
            </label>
            <button className="primary" disabled={busy}>
              <Plus size={16} />
              Save template
            </button>
          </form>
        </section>
        <section className="panel">
          <span className="feature-icon">
            <Send size={24} />
          </span>
          <h2>Keep your people in the loop.</h2>
          <p className="subtitle">
            Queue messages for up to 50 registered participants at a time.
          </p>
          <form onSubmit={queue}>
            <label>
              Template
              <select
                name="templateId"
                required
                value={templateId}
                onChange={(e) => {
                  setTemplateId(e.target.value);
                  const role = templates.find(
                    (t) => t.id === e.target.value,
                  )?.role;
                  if (role && role in roleNames) setAudience(role);
                }}
              >
                <option value="">Select a template</option>
                {templates.map((t) => (
                  <option value={t.id} key={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="audience-picker">
              <label>
                Recipients by role
                <select
                  value={audience}
                  onChange={(e) => setAudience(e.target.value)}
                >
                  {["all", ...conferenceRoles].map((role) => (
                    <option value={role} key={role}>
                      {roleNames[role] || role}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => void loadAudience()}
              >
                <Users size={16} />
                Add recipients
              </button>
            </div>
            <label>
              Recipient emails
              <textarea
                name="recipients"
                required
                rows={6}
                value={recipients}
                onChange={(e) => setRecipients(e.target.value)}
                placeholder="One email per line, or separated by commas"
              />
            </label>
            {template && (
              <details className="email-preview" open>
                <summary>
                  Preview{loaded[0] ? ` for ${loaded[0].fullName}` : ""}
                </summary>
                <strong>{renderTemplate(template.subject, sample)}</strong>
                <pre>{renderTemplate(template.body, sample)}</pre>
              </details>
            )}
            <button className="primary" disabled={busy || !templates.length}>
              <Send size={16} />
              Queue notifications
            </button>
          </form>
          <p className="inline-note">
            Messages are delivered by the separate server worker, with bounded
            retries and recorded delivery status.
          </p>
        </section>
      </div>
      {isSuperAdmin && <SmtpSettings />}
      {children}
      <section className="panel">
        <div className="panel-heading">
          <h2>Delivery activity</h2>
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
          label="deliveries by recipient or status"
          shown={shownJobs.length}
          total={jobs.length}
        />
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Recipient</th>
                <th>Status</th>
                <th>Attempts</th>
                <th>Created</th>
              </tr>
            </thead>
            <tbody>
              {shownJobs.map((j) => (
                <tr key={j.id}>
                  <td>{j.recipient}</td>
                  <td>
                    <span
                      className={`badge ${j.status === "sent" ? "positive" : ""}`}
                    >
                      {j.status}
                    </span>
                  </td>
                  <td>{j.attempts || 1}</td>
                  <td>{j.createdAt}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!jobs.length && (
            <p className="inline-note">No email delivery attempts yet.</p>
          )}
          {jobs.length > 0 && !shownJobs.length && (
            <NoMatches what="deliveries" query={query} />
          )}
        </div>
      </section>
    </>
  );
}
