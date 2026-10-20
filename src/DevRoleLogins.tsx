import { ArrowUpRight, FlaskConical } from "lucide-react";
import { dashboardTestRoles } from "../shared/dashboard-test-roles";
import type { AccessRole } from "../shared/schema";
export default function DevRoleLogins({
  busy,
  onLogin,
}: {
  busy: boolean;
  onLogin: (role: AccessRole) => Promise<void>;
}) {
  return (
    <section className="dev-role-logins" aria-labelledby="dev-role-title">
      <div className="dev-role-heading">
        <FlaskConical size={17} />
        <span>DEVELOPMENT / TESTING ONLY</span>
      </div>
      <h2 id="dev-role-title">Choose a dashboard to test</h2>
      <p>Use an existing test account with one click.</p>
      <div className="dev-role-list">
        {dashboardTestRoles.map(({ role, label, description }) => (
          <div className="dev-role-row" key={role}>
            <div>
              <strong>{label}</strong>
              <small>{description}</small>
            </div>
            <button
              type="button"
              className="secondary"
              aria-label={`Login as ${label}`}
              disabled={busy}
              onClick={() => void onLogin(role)}
            >
              Login
              <ArrowUpRight size={14} />
            </button>
          </div>
        ))}
      </div>
      <p className="dev-role-footnote">
        Temporary local shortcuts. Normal login is available above.
      </p>
    </section>
  );
}
