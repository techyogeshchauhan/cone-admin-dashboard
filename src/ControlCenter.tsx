import { useEffect, useState, type FormEvent } from "react";
import {
  Activity,
  ShieldCheck,
  Users,
  Settings,
  RefreshCw,
  Plus,
  ArrowUpRight,
  Mail,
  FileSpreadsheet,
  Image,
  type LucideIcon,
} from "lucide-react";
import { request } from "./firebase";
import SearchBox, { matchesSearch, NoMatches } from "./SearchBox";
import "./ControlCenter.css";
import {
  managedResources,
  permissionActions,
  runtimeDefaults,
  type RoleDefinition,
} from "../shared/control";
type User = {
  uid: string;
  email: string;
  fullName: string;
  mobile: string;
  accessRole: string;
  status: string;
  version: number;
  disabled: boolean;
  emailVerified: boolean;
  mfaFactors: number;
  lastSignIn: string | null;
  authSyncPending: boolean;
  isTestAccount: boolean;
};
type Job = {
  id: string;
  status: string;
  recipient?: string;
  fileName?: string;
  attempts?: number;
  error?: string;
  createdAt: string;
};
const human = (value: string) =>
  value.replaceAll("_", " ").replace(/\b\w/g, (v) => v.toUpperCase());
// Tab targets reuse data already loaded by this page; only "media" opens
// another page.
const kpiTargets: Record<
  string,
  { icon: LucideIcon; color: string; note: string; tab?: string; page?: string }
> = {
  dashboardUsers: {
    icon: Users,
    color: "green",
    note: "Users & sessions",
    tab: "users",
  },
  emailJobs: {
    icon: Mail,
    color: "blue",
    note: "Jobs & recovery",
    tab: "jobs",
  },
  importJobs: {
    icon: FileSpreadsheet,
    color: "purple",
    note: "Jobs & recovery",
    tab: "jobs",
  },
  mediaAssets: {
    icon: Image,
    color: "orange",
    note: "Image storage",
    page: "media",
  },
};
export default function ControlCenter({
  navigate,
}: {
  navigate: (page: string) => void;
}) {
  const [tab, setTab] = useState("system"),
    [revision, setRevision] = useState(0),
    [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [loadedAt, setLoadedAt] = useState<Date | null>(null),
    [query, setQuery] = useState("");
  const [system, setSystem] = useState<Record<string, unknown> | null>(null),
    [roles, setRoles] = useState<RoleDefinition[]>([]),
    [users, setUsers] = useState<User[]>([]),
    [next, setNext] = useState<string | null>(null),
    [runtime, setRuntime] = useState<typeof runtimeDefaults | null>(null),
    [jobs, setJobs] = useState<{ email: Job[]; imports: Job[] }>({
      email: [],
      imports: [],
    }),
    [editing, setEditing] = useState<User | null>(null),
    [selectedRole, setSelectedRole] = useState<RoleDefinition | null>(null),
    [newId, setNewId] = useState("");
  useEffect(() => {
    let active = true;
    setError("");
    setLoading(true);
    Promise.all([
      request<Record<string, unknown>>("/control/system"),
      request<RoleDefinition[]>("/control/roles"),
      request<{ users: User[]; next: string | null }>("/control/users"),
      request<typeof runtimeDefaults>("/control/runtime"),
      request<typeof jobs>("/control/jobs"),
    ])
      .then(([s, r, u, config, j]) => {
        if (!active) return;
        setSystem(s);
        setRoles(r);
        setUsers(u.users);
        setNext(u.next);
        setRuntime(config);
        setJobs(j);
        setLoadedAt(new Date());
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [revision]);
  async function mutate(endpoint: string, body: unknown, method = "POST") {
    setBusy(true);
    setError("");
    setNote("");
    try {
      await request(endpoint, { method, body: JSON.stringify(body) });
      setRevision((r) => r + 1);
      setNote("Change completed and recorded in the audit log.");
      return true;
    } catch (e) {
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function action(user: User, action: string) {
    if (!window.confirm(`${human(action)} for ${user.email}?`)) return;
    await mutate(`/control/users/${encodeURIComponent(user.uid)}/action`, {
      action,
    });
  }
  function newRole() {
    setSelectedRole({
      id: "",
      name: "",
      description: "",
      active: true,
      permissions: [],
      version: 0,
      builtIn: false,
    });
    setNewId("");
  }
  async function saveRole(e: FormEvent) {
    e.preventDefault();
    if (!selectedRole) return;
    const id = selectedRole.id || newId;
    const { id: _id, builtIn: _builtIn, ...value } = selectedRole;
    if (await mutate(`/control/roles/${encodeURIComponent(id)}`, value, "PUT"))
      setSelectedRole(null);
  }
  // Search filters only data this page already loaded; it makes no API calls.
  const needle = query.trim();
  const matches = (...values: unknown[]) => matchesSearch(query, ...values);
  const shownUsers = users.filter((u) =>
    matches(
      u.fullName,
      u.email,
      u.mobile,
      u.accessRole,
      u.accessRole && human(u.accessRole),
      u.disabled ? "Firebase disabled" : u.status,
    ),
  );
  const shownRoles = roles.filter((r) => matches(r.name, r.id, r.description));
  const shownEmailJobs = jobs.email.filter((j) =>
    matches(j.recipient, j.status, j.error, j.id),
  );
  const shownImportJobs = jobs.imports.filter((j) =>
    matches(j.fileName, j.status, j.createdAt, j.id),
  );
  const search: Record<
    string,
    { label: string; shown: number; total: number }
  > = {
    users: {
      label: "users by name, email, mobile, role or status",
      shown: shownUsers.length,
      total: users.length,
    },
    roles: {
      label: "roles by name, identifier or description",
      shown: shownRoles.length,
      total: roles.length,
    },
    jobs: {
      label: "jobs by recipient, workbook, status or error",
      shown: shownEmailJobs.length + shownImportJobs.length,
      total: jobs.email.length + jobs.imports.length,
    },
  };
  const noMatches = (what: string) => <NoMatches what={what} query={query} />;
  const tabs = [
    ["system", "System overview"],
    ["users", "Users & sessions"],
    ["roles", "Roles & permissions"],
    ["runtime", "Runtime configuration"],
    ["jobs", "Jobs & recovery"],
  ];
  return (
    <>
      <div className="control-banner">
        <ShieldCheck size={25} />
        <div>
          <strong>Super Admin Control Center</strong>
          <p>
            Manage application access, configuration, and operations from one
            place.
          </p>
        </div>
        <div className="control-refresh">
          {loadedAt && (
            <span aria-live="polite">
              Updated {loadedAt.toLocaleTimeString()}
            </span>
          )}
          <button
            className="secondary"
            onClick={() => {
              setNote("");
              setRevision((r) => r + 1);
            }}
            disabled={busy || loading}
          >
            <RefreshCw size={15} className={loading ? "spin" : undefined} />
            {loading ? "Refreshing..." : "Refresh"}
          </button>
        </div>
      </div>
      <div
        className="control-tabs"
        role="tablist"
        aria-label="Control Center sections"
      >
        {tabs.map(([id, name]) => (
          <button
            role="tab"
            aria-selected={tab === id}
            key={id}
            className={tab === id ? "selected" : ""}
            onClick={() => {
              setTab(id);
              setQuery("");
            }}
          >
            {name}
          </button>
        ))}
      </div>
      {search[tab] && (
        <SearchBox
          value={query}
          onChange={setQuery}
          label={search[tab].label}
          shown={search[tab].shown}
          total={search[tab].total}
        />
      )}
      {error && (
        <div className="message" role="alert">
          {error}
        </div>
      )}
      {note && <p className="success">{note}</p>}
      {tab === "system" && (
        <>
          <section className="panel">
            <div className="panel-heading">
              <div>
                <h2>Application control at a glance</h2>
                <p>
                  Live server status. Secrets are represented by configuration
                  status only.
                </p>
              </div>
              <Activity size={22} />
            </div>
            {system ? (
              <>
                <div className="metrics control-kpis">
                  {Object.entries(system.counts as Record<string, number>).map(
                    ([key, value]) => {
                      const name = human(key.replace(/([A-Z])/g, " $1"));
                      const target = kpiTargets[key];
                      const Icon = target?.icon ?? Activity;
                      return (
                        <button
                          type="button"
                          className="metric overview-link control-kpi"
                          key={key}
                          disabled={!target}
                          aria-label={`${name}: ${value}. Open ${target?.note ?? name}`}
                          onClick={() => {
                            setQuery("");
                            if (target?.tab) setTab(target.tab);
                            else if (target?.page) navigate(target.page);
                          }}
                        >
                          <div className="metric-copy">
                            <div className="metric-top">
                              <span
                                className={`metric-icon ${target?.color ?? ""}`}
                              >
                                <Icon size={15} />
                              </span>
                              <span>{name}</span>
                            </div>
                            {target && (
                              <small>
                                {target.note} <ArrowUpRight size={11} />
                              </small>
                            )}
                          </div>
                          <strong>{value}</strong>
                        </button>
                      );
                    },
                  )}
                </div>
                <div className="health-grid">
                  {[
                    ["Environment", system.environment],
                    ["Firebase project", system.firebaseProject],
                    ["Server runtime", system.node],
                    [
                      "Free storage",
                      `${Math.round(Number(system.diskFreeBytes) / 1024 / 1024)} MB`,
                    ],
                  ].map(([name, value]) => (
                    <div className="health-item" key={String(name)}>
                      <strong>{String(name)}</strong>
                      <span>{String(value)}</span>
                    </div>
                  ))}
                </div>
                <h3 className="control-subheading">
                  Security and infrastructure
                </h3>
                <pre>
                  {JSON.stringify(
                    {
                      security: system.security,
                      storageRoot: system.storageRoot,
                      uptimeSeconds: system.uptimeSeconds,
                      checkedAt: system.checkedAt,
                    },
                    null,
                    2,
                  )}
                </pre>
              </>
            ) : (
              <p className="loading">Loading system status…</p>
            )}
          </section>
          <section className="panel">
            <h2>Operational management</h2>
            <div className="control-links">
              {[
                ["users", "Users & access"],
                ["participants", "Participants"],
                ["conference", "Conference details"],
                ["sessions", "Programme"],
                ["staff", "Staff & VIP hosts"],
                ["fees", "Fee records"],
                ["imports", "Excel imports"],
                ["media", "Image storage"],
                ["passes", "Passes & entry"],
                ["email", "Email & SMTP"],
                ["analysis", "Code analysis & health"],
                ["audit", "Audit history"],
                ["settings", "Maintenance settings"],
              ].map(([key, title]) => (
                <button
                  className="secondary"
                  key={key}
                  onClick={() => navigate(key)}
                >
                  {title}
                  <ArrowUpRight size={15} />
                </button>
              ))}
            </div>
          </section>
        </>
      )}
      {tab === "users" && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Firebase users and dashboard access</h2>
              <p>
                Disable access, restore accounts, assign roles, revoke sessions,
                and queue recovery emails.
              </p>
            </div>
            <button className="secondary" onClick={() => navigate("users")}>
              <Plus size={16} />
              Create / invite user
            </button>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>User</th>
                  <th>Role / access</th>
                  <th>Security</th>
                  <th>Last sign-in</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {shownUsers.map((user) => (
                  <tr key={user.uid}>
                    <td>
                      <strong>{user.fullName || "Unnamed user"}</strong>
                      <br />
                      {user.email}
                      {user.isTestAccount && (
                        <small className="control-test-tag">
                          Testing account
                        </small>
                      )}
                    </td>
                    <td>
                      {user.accessRole
                        ? human(user.accessRole)
                        : "No dashboard role"}
                      <br />
                      <span
                        className={`badge ${user.status === "active" && !user.disabled ? "positive" : ""}`}
                      >
                        {user.disabled ? "Firebase disabled" : user.status}
                      </span>
                      {user.authSyncPending && (
                        <p>Auth sync pending — retry Enable/Disable</p>
                      )}
                    </td>
                    <td>
                      {user.emailVerified
                        ? "Email verified"
                        : "Email unverified"}
                      <br />
                      {user.mfaFactors} MFA factor(s)
                    </td>
                    <td>{user.lastSignIn || "Never"}</td>
                    <td>
                      <div className="control-user-actions">
                        <button
                          className="text-button"
                          onClick={() => setEditing(user)}
                        >
                          Manage access
                        </button>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() =>
                            void action(
                              user,
                              user.disabled || user.status === "disabled"
                                ? "enable"
                                : "disable",
                            )
                          }
                        >
                          {user.disabled || user.status === "disabled"
                            ? "Enable account"
                            : "Disable account"}
                        </button>
                        <button
                          className="text-button"
                          disabled={busy}
                          onClick={() => void action(user, "revoke_sessions")}
                        >
                          Revoke sessions
                        </button>
                        <button
                          className="text-button"
                          disabled={busy || user.isTestAccount}
                          onClick={() => void action(user, "password_reset")}
                        >
                          Send password reset
                        </button>
                        {!user.emailVerified && (
                          <button
                            className="text-button"
                            disabled={busy}
                            onClick={() =>
                              void action(user, "verification_email")
                            }
                          >
                            Send verification
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {needle && !shownUsers.length && noMatches("loaded users")}
          </div>
          {next && (
            <button
              className="secondary load-more"
              onClick={async () => {
                try {
                  const page = await request<{
                    users: User[];
                    next: string | null;
                  }>(`/control/users?page=${encodeURIComponent(next)}`);
                  setUsers((old) => [...old, ...page.users]);
                  setNext(page.next);
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              Load more Firebase users
            </button>
          )}
          <p className="inline-note">
            Session revocation affects existing logins; it does not reveal
            passwords. API access checks the current account and role on every
            request. Direct mobile Firebase clients can retain already-issued
            tokens until they expire unless their Firestore rules also enforce
            revocation/account status.
          </p>
        </section>
      )}
      {tab === "roles" && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Roles & permission policies</h2>
              <p>
                Change existing presets or create a custom role without editing
                code or Firestore manually.
              </p>
            </div>
            <button className="primary" onClick={newRole}>
              <Plus size={16} />
              Create custom role
            </button>
          </div>
          <div className="control-role-grid">
            {shownRoles.map((role) => (
              <button
                className="control-role-card"
                key={role.id}
                onClick={() => {
                  setSelectedRole({ ...role });
                  setNewId("");
                }}
              >
                <ShieldCheck size={20} />
                <strong>{role.name}</strong>
                <span>{role.description || "Custom access policy"}</span>
                <small>
                  {role.id === "superadmin"
                    ? "Protected · full access"
                    : `${role.permissions.length} grants · ${role.active ? "Active" : "Inactive"}`}
                </small>
              </button>
            ))}
          </div>
          {needle && !shownRoles.length && noMatches("roles")}
          <p className="inline-note">
            Super Admin stays protected and cannot be restricted by a role
            policy. Global account, policy, system-setting, and technical
            controls cannot be delegated through ordinary module permissions.
          </p>
        </section>
      )}
      {tab === "runtime" && runtime && (
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Runtime application configuration</h2>
              <p>
                These switches are enforced by this API as soon as they are
                saved.
              </p>
            </div>
            <Settings size={21} />
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const data = new FormData(e.currentTarget);
              const value = {
                ...runtime,
                applicationName: String(data.get("applicationName")),
                announcement: String(data.get("announcement")),
                sessionMaxAgeMinutes: Number(data.get("sessionMaxAgeMinutes")),
                maxUploadMb: Number(data.get("maxUploadMb")),
                ...Object.fromEntries(
                  [
                    "writesPaused",
                    "importsEnabled",
                    "mediaUploadsEnabled",
                    "emailEnabled",
                    "redemptionsEnabled",
                    "exportsEnabled",
                  ].map((key) => [key, data.has(key)]),
                ),
              };
              await mutate("/control/runtime", value, "PUT");
            }}
            key={runtime.version}
          >
            <div className="form-grid">
              <label>
                Application display name
                <input
                  name="applicationName"
                  required
                  defaultValue={runtime.applicationName}
                />
              </label>
              <label>
                Maximum session age (minutes)
                <input
                  name="sessionMaxAgeMinutes"
                  type="number"
                  min={15}
                  max={1440}
                  required
                  defaultValue={runtime.sessionMaxAgeMinutes}
                />
              </label>
              <label>
                Maximum image upload size (MB)
                <input
                  name="maxUploadMb"
                  type="number"
                  min={1}
                  max={5}
                  required
                  defaultValue={runtime.maxUploadMb}
                />
              </label>
              <label>
                Workspace announcement
                <textarea
                  name="announcement"
                  defaultValue={runtime.announcement}
                />
              </label>
            </div>
            {[
              ["writesPaused", "Pause non-Super-Admin writes"],
              ["importsEnabled", "Enable Excel imports"],
              ["mediaUploadsEnabled", "Enable image uploads"],
              ["emailEnabled", "Enable email operations and worker delivery"],
              ["redemptionsEnabled", "Enable meal redemption"],
              ["exportsEnabled", "Allow delegated roles to export reports"],
            ].map(([key, title]) => (
              <label className="checkbox" key={key}>
                <input
                  type="checkbox"
                  name={key}
                  defaultChecked={Boolean(runtime[key as keyof typeof runtime])}
                />
                {title}
              </label>
            ))}
            <button className="primary" disabled={busy}>
              Save runtime configuration
            </button>
          </form>
          <p className="inline-note">
            Super Admin remains able to manage the Control Center during write
            pauses. Environment URLs, encryption/signing keys, Firebase
            credentials, deployments, and database rules stay in protected
            infrastructure configuration.
          </p>
        </section>
      )}
      {tab === "jobs" && (
        <>
          <section className="panel">
            <div className="panel-heading">
              <h2>Email delivery and recovery</h2>
              <button className="text-button" onClick={() => navigate("email")}>
                Open Email / SMTP
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Recipient</th>
                    <th>Status</th>
                    <th>Attempts</th>
                    <th>Last error</th>
                    <th>Recovery</th>
                  </tr>
                </thead>
                <tbody>
                  {shownEmailJobs.map((job) => (
                    <tr key={job.id}>
                      <td>{job.recipient}</td>
                      <td>{job.status}</td>
                      <td>{job.attempts}</td>
                      <td>{job.error || "—"}</td>
                      <td>
                        {["queued", "retry", "failed", "cancelled"].includes(
                          job.status,
                        ) && (
                          <>
                            <button
                              className="text-button"
                              disabled={busy}
                              onClick={() =>
                                void mutate(
                                  `/control/jobs/email/${job.id}/action`,
                                  { action: "retry" },
                                )
                              }
                            >
                              Retry
                            </button>
                            {job.status !== "cancelled" && (
                              <button
                                className="text-button"
                                disabled={busy}
                                onClick={() =>
                                  void mutate(
                                    `/control/jobs/email/${job.id}/action`,
                                    { action: "cancel" },
                                  )
                                }
                              >
                                Cancel
                              </button>
                            )}
                          </>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!jobs.email.length && (
                <p className="inline-note">No email jobs yet.</p>
              )}
              {needle &&
                jobs.email.length > 0 &&
                !shownEmailJobs.length &&
                noMatches("email jobs")}
            </div>
          </section>
          <section className="panel">
            <div className="panel-heading">
              <h2>Import operations</h2>
              <button className="secondary" onClick={() => navigate("imports")}>
                Open imports & recovery
              </button>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Workbook</th>
                    <th>Status</th>
                    <th>Created</th>
                  </tr>
                </thead>
                <tbody>
                  {shownImportJobs.map((job) => (
                    <tr key={job.id}>
                      <td>{job.fileName}</td>
                      <td>{job.status}</td>
                      <td>{job.createdAt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!jobs.imports.length && (
                <p className="inline-note">No import jobs yet.</p>
              )}
              {needle &&
                jobs.imports.length > 0 &&
                !shownImportJobs.length &&
                noMatches("import jobs")}
            </div>
          </section>
        </>
      )}
      {selectedRole && (
        <div className="modal-backdrop">
          <section
            className="modal control-role-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Edit role permissions"
          >
            <h2>
              {selectedRole.id === "superadmin"
                ? "Protected Super Admin policy"
                : selectedRole.id
                  ? "Edit role permissions"
                  : "Create a custom role"}
            </h2>
            {error && (
              <div className="message" role="alert">
                {error}
              </div>
            )}
            <form onSubmit={saveRole}>
              <label>
                Role identifier
                <input
                  value={selectedRole.id || newId}
                  readOnly={!!selectedRole.id}
                  onChange={(e) => setNewId(e.target.value)}
                  required
                  pattern="[a-z][a-z0-9_]{2,40}"
                  placeholder="support_agent"
                />
              </label>
              <label>
                Role name
                <input
                  value={selectedRole.name}
                  readOnly={selectedRole.id === "superadmin"}
                  required
                  onChange={(e) =>
                    setSelectedRole({ ...selectedRole, name: e.target.value })
                  }
                />
              </label>
              <label>
                Description
                <textarea
                  value={selectedRole.description}
                  readOnly={selectedRole.id === "superadmin"}
                  onChange={(e) =>
                    setSelectedRole({
                      ...selectedRole,
                      description: e.target.value,
                    })
                  }
                />
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={selectedRole.active}
                  disabled={selectedRole.id === "superadmin"}
                  onChange={(e) =>
                    setSelectedRole({
                      ...selectedRole,
                      active: e.target.checked,
                    })
                  }
                />
                Role active
              </label>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Module</th>
                      {permissionActions.map((action) => (
                        <th key={action}>{human(action)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {managedResources.map((resource) => (
                      <tr key={resource}>
                        <td>{human(resource)}</td>
                        {permissionActions.map((action) => {
                          const key = `${resource}:${action}`;
                          return (
                            <td key={key}>
                              <input
                                type="checkbox"
                                className="permission-checkbox"
                                aria-label={`${resource} ${action}`}
                                checked={
                                  selectedRole.id === "superadmin" ||
                                  selectedRole.permissions.includes(key)
                                }
                                disabled={selectedRole.id === "superadmin"}
                                onChange={(e) =>
                                  setSelectedRole({
                                    ...selectedRole,
                                    permissions: e.target.checked
                                      ? [...selectedRole.permissions, key]
                                      : selectedRole.permissions.filter(
                                          (p) => p !== key,
                                        ),
                                  })
                                }
                              />
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="form-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setSelectedRole(null)}
                >
                  Close
                </button>
                {selectedRole.id !== "superadmin" && (
                  <button className="primary" disabled={busy}>
                    Save policy
                  </button>
                )}
              </div>
            </form>
          </section>
        </div>
      )}
      {editing && (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-label="Manage user access"
          >
            <h2>Manage account access</h2>
            {error && (
              <div className="message" role="alert">
                {error}
              </div>
            )}
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const values = new FormData(e.currentTarget);
                const data = {
                  ...Object.fromEntries(values),
                  conferenceId: "main",
                };
                const success = await mutate(
                  `/control/users/${encodeURIComponent(editing.uid)}/access`,
                  { version: editing.version, data },
                  "PUT",
                );
                if (success) setEditing(null);
              }}
            >
              <label>
                Email
                <input
                  name="email"
                  type="email"
                  required
                  readOnly
                  value={editing.email}
                />
              </label>
              <label>
                Full name
                <input
                  name="fullName"
                  required
                  minLength={2}
                  defaultValue={editing.fullName}
                />
              </label>
              <label>
                Mobile
                <input
                  name="mobile"
                  required
                  type="tel"
                  defaultValue={editing.mobile}
                />
              </label>
              <label>
                Dashboard role
                <select
                  name="accessRole"
                  defaultValue={editing.accessRole || "participant"}
                >
                  {roles
                    .filter((r) => r.active)
                    .map((role) => (
                      <option key={role.id} value={role.id}>
                        {role.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Dashboard account status
                <select
                  name="status"
                  defaultValue={
                    editing.status === "disabled" ? "disabled" : "active"
                  }
                >
                  <option value="active">Active</option>
                  <option value="disabled">Disabled</option>
                </select>
              </label>
              <div className="form-actions">
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setEditing(null)}
                >
                  Cancel
                </button>
                <button className="primary" disabled={busy}>
                  Save access
                </button>
              </div>
            </form>
            <p className="inline-note">
              Requires a recent sign-in. Your own Super Admin access and the
              last active Super Admin are protected.
            </p>
          </section>
        </div>
      )}
    </>
  );
}
