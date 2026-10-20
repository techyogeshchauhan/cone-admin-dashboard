import { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { request } from "./firebase";
export default function SmtpSettings() {
  const [config, setConfig] = useState<Record<string, unknown> | null>(null),
    [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    request("/settings/smtp")
      .then(setConfig)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="panel">
      <div className="panel-heading">
        <div>
          <h2>SMTP server settings</h2>
          <p>
            Super Admin only · password values are never returned to the
            browser.
          </p>
        </div>
        <Settings size={20} />
      </div>
      {error && (
        <p className="message" role="alert">
          {error}
        </p>
      )}
      {note && <p className="success">{note}</p>}
      {config && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const form = new FormData(e.currentTarget);
            const data = Object.fromEntries(form);
            if (!data.password) delete data.password;
            try {
              setConfig(
                await request("/settings/smtp", {
                  method: "PUT",
                  body: JSON.stringify(data),
                }),
              );
              setNote(
                "SMTP configuration saved securely. Use the test below to verify delivery.",
              );
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <div className="form-grid">
            <label>
              SMTP hostname
              <input
                name="host"
                required
                defaultValue={String(config.host || "")}
              />
            </label>
            <label>
              Port
              <input
                name="port"
                type="number"
                min={1}
                max={65535}
                required
                defaultValue={Number(config.port || 587)}
              />
            </label>
            <label>
              Transport security
              <select
                name="security"
                defaultValue={String(config.security || "starttls")}
              >
                <option value="starttls">STARTTLS</option>
                <option value="tls">TLS</option>
                <option value="none">None (development only)</option>
              </select>
            </label>
            <label>
              Username
              <input
                name="username"
                autoComplete="off"
                defaultValue={String(config.username || "")}
              />
            </label>
            <label>
              Password
              <input
                name="password"
                type="password"
                autoComplete="new-password"
                placeholder={
                  config.passwordConfigured
                    ? "Configured — leave blank to retain"
                    : "Not configured"
                }
              />
            </label>
            <label>
              From email
              <input
                name="fromEmail"
                type="email"
                required
                defaultValue={String(config.fromEmail || "")}
              />
            </label>
            <label>
              Sender name
              <input
                name="fromName"
                required
                defaultValue={String(config.fromName || "CONE")}
              />
            </label>
          </div>
          <button className="primary" disabled={busy}>
            Save SMTP configuration
          </button>
          <p className="inline-note">
            Set CONFIG_ENCRYPTION_KEY on the server before saving passwords. The
            server encrypts saved credentials with AES-256-GCM. Environment SMTP
            settings are used until you save a dashboard override.
          </p>
        </form>
      )}
    </section>
  );
}
