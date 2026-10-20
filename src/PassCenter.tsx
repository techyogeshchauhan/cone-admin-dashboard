import { useState, type FormEvent } from "react";
import { Ticket, ShieldCheck } from "lucide-react";
import { request } from "./firebase";
export default function PassCenter() {
  const [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [token, setToken] = useState(""),
    [busy, setBusy] = useState(false);
  async function issue(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const form = new FormData(e.currentTarget);
      const action = form.get("action") === "revoke" ? "revoke" : "issue";
      const result = await request<{ token?: string }>(`/passes/${action}`, {
        method: "POST",
        body: JSON.stringify({ email: form.get("email") }),
      });
      setToken(result.token || "");
      setNote(
        action === "revoke"
          ? "Pass revoked. Entry checks will reject this pass."
          : "A signed pass has been issued. The participant must refresh their profile in the mobile app.",
      );
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
            <Ticket size={26} />
          </span>
          <h2>A pass with a purpose.</h2>
          <p className="subtitle">
            Issue a signed entry pass to a confirmed participant, or revoke it.
            Reissuing automatically revokes the previous managed pass.
          </p>
          <form onSubmit={issue}>
            <label>
              Participant email
              <input type="email" name="email" required />
            </label>
            <label>
              Action
              <select name="action">
                <option value="issue">Issue / reissue a signed pass</option>
                <option value="revoke">Revoke the current pass</option>
              </select>
            </label>
            <button className="primary" disabled={busy}>
              Apply pass action
            </button>
          </form>
          {token && (
            <label>
              New signed pass token
              <textarea readOnly value={token} rows={5} />
            </label>
          )}
          <p className="inline-note">
            Requires the server's PASS_SIGNING_SECRET. Legacy plain-ID passes do
            not pass the signed entry check.
          </p>
        </section>
        <section className="panel">
          <span className="feature-icon">
            <ShieldCheck size={26} />
          </span>
          <h2>Entry verification</h2>
          <p className="subtitle">
            Paste the content scanned from the participant's pass QR code.
          </p>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              setError("");
              try {
                const result = await request<{
                  fullName: string;
                  registrationId: string;
                }>("/passes/verify", {
                  method: "POST",
                  body: JSON.stringify({
                    token: new FormData(e.currentTarget).get("token"),
                  }),
                });
                setNote(
                  `Valid entry pass: ${result.fullName} · ${result.registrationId}`,
                );
              } catch (e) {
                setError((e as Error).message);
              } finally {
                setBusy(false);
              }
            }}
          >
            <label>
              QR token
              <textarea name="token" required rows={6} />
            </label>
            <button className="primary" disabled={busy}>
              Verify entry pass
            </button>
          </form>
        </section>
      </div>
    </>
  );
}
