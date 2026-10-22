import { useCallback, useEffect, useState, type FormEvent } from "react";
import { AlertCircle, Plus, RefreshCw } from "lucide-react";
import { request } from "./firebase";

type TestAccount = {
  id: string;
  email: string;
  fullName: string;
  mobile: string;
  role: string;
  addedAt: string;
  addedByName: string;
  lastLoginAt?: string;
};
const when = (value?: string) =>
  value
    ? new Date(value).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Kolkata",
      })
    : "Never";

// Registrations that sign in to the mobile app without an emailed code.
// Stored in the testAccounts collection; see TEST_ACCOUNT_LOGIN.md.
export default function TestAccounts() {
  const [rows, setRows] = useState<TestAccount[]>([]),
    [loginEnabled, setLoginEnabled] = useState(true),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(""),
    [email, setEmail] = useState(""),
    [error, setError] = useState(""),
    [success, setSuccess] = useState("");
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await request<{
        loginEnabled: boolean;
        rows: TestAccount[];
      }>("/test-accounts");
      setRows(data.rows);
      setLoginEnabled(data.loginEnabled);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => void load(), [load]);
  async function change(address: string, enabled: boolean) {
    setBusy(address);
    setError("");
    setSuccess("");
    try {
      await request(`/people/${encodeURIComponent(address)}/test-account`, {
        method: "PUT",
        body: JSON.stringify({ enabled }),
      });
      setSuccess(
        enabled
          ? `${address} can now sign in to the app without an email code.`
          : `${address} removed. Their app sessions were signed out; next login needs an email code.`,
      );
      if (enabled) setEmail("");
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  function add(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const address = email.trim().toLowerCase();
    if (address) void change(address, true);
  }
  return (
    <>
      {!loginEnabled && (
        <div className="message" role="alert">
          <AlertCircle size={18} />
          Test login is switched off on the server (ALLOW_TEST_ACCOUNT_LOGIN).
          Everyone, including these accounts, signs in with an email code.
        </div>
      )}
      {error && (
        <div className="message" role="alert">
          <AlertCircle size={18} />
          {error}
        </div>
      )}
      {success && (
        <p className="success" role="status">
          {success}
        </p>
      )}
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Test accounts</h2>
            <p>
              These people sign in to the mobile app with their name, email and
              mobile only, without an email code. Anyone who knows those three
              details can sign in, so add only test accounts, never real
              participants.
            </p>
          </div>
          <button
            className="secondary"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw size={16} />
            Refresh
          </button>
        </div>
        <form className="toolbar" onSubmit={add}>
          <input
            type="email"
            required
            aria-label="Participant email to add as a test account"
            placeholder="Participant email, e.g. presenter@gmail.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <button className="primary" disabled={Boolean(busy)}>
            <Plus size={17} />
            Add test account
          </button>
        </form>
        {loading && !rows.length ? (
          <p className="inline-note">Loading…</p>
        ) : rows.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Mobile</th>
                  <th>Role</th>
                  <th>Added</th>
                  <th>Last app login</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <span className="cell-name">{row.fullName}</span>
                    </td>
                    <td>{row.email}</td>
                    <td>{row.mobile}</td>
                    <td>
                      <span className="badge">{row.role}</span>
                    </td>
                    <td>
                      {when(row.addedAt)}
                      <br />
                      <small>by {row.addedByName}</small>
                    </td>
                    <td>{when(row.lastLoginAt)}</td>
                    <td>
                      <button
                        className="text-button delete-user-button"
                        disabled={Boolean(busy)}
                        aria-label={`Remove ${row.fullName} from test accounts`}
                        onClick={() => {
                          if (
                            window.confirm(
                              `Remove ${row.fullName}? Their next app login will need an email code.`,
                            )
                          )
                            void change(row.email, false);
                        }}
                      >
                        {busy === row.email ? "Removing…" : "Remove"}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="inline-note">
            No test accounts. Add a participant's email above.
          </p>
        )}
      </section>
    </>
  );
}
