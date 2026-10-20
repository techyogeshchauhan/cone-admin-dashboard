import { useState, useEffect } from "react";
import { Mail } from "lucide-react";
import { accessRoles } from "../shared/schema";
import { request } from "./firebase";
export default function InviteUser() {
  const [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false);
  const [roles, setRoles] = useState<string[]>([...accessRoles]);
  useEffect(() => {
    request<{ id: string; active: boolean }[]>("/control/roles")
      .then((items) =>
        setRoles(items.filter((role) => role.active).map((role) => role.id)),
      )
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>Invite someone to your workspace</h2>
          <p>
            Create a Firebase account and queue verification/password setup
            instructions.
          </p>
        </div>
        <Mail size={20} />
      </div>
      {error && (
        <div className="message" role="alert">
          {error}
        </div>
      )}
      {note && <p className="success">{note}</p>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          setBusy(true);
          setError("");
          try {
            await request("/users/invite", {
              method: "POST",
              body: JSON.stringify({
                ...Object.fromEntries(new FormData(form)),
                conferenceId: "main",
                status: "active",
              }),
            });
            setNote(
              "Invitation queued. The email worker will deliver account setup instructions.",
            );
            form.reset();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="form-grid">
          <label>
            Full name *<input name="fullName" required minLength={2} />
          </label>
          <label>
            Email *<input name="email" type="email" required />
          </label>
          <label>
            Mobile *<input name="mobile" type="tel" required />
          </label>
          <label>
            Dashboard role
            <select name="accessRole" defaultValue="organizer">
              {roles.map((role) => (
                <option key={role}>{role}</option>
              ))}
            </select>
          </label>
        </div>
        <button className="primary" disabled={busy}>
          <Mail size={16} />
          Queue invitation
        </button>
      </form>
    </section>
  );
}
