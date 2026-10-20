# Super Admin Control Center

Open the dashboard, sign in as Super Admin, and select **Control Center** in the sidebar. Existing test credentials and one-click development login still work. Other roles cannot access this area.

## Administrative rights available

| Area | Super Admin controls |
|---|---|
| Firebase users | View paginated Auth users, verified email status, MFA enrollment count, last sign-in, account status, and dashboard role |
| Access management | Assign an existing or custom role to a Firebase user, edit required identity fields, activate/deactivate dashboard access, and synchronize Firebase Auth account status |
| Sessions and recovery | Revoke a user's sessions; queue password-reset or verification emails without exposing passwords or recovery links in the browser |
| Roles | Create custom roles; rename and describe roles; modify built-in role presets; activate/deactivate eligible roles |
| Permissions | Set read, write, and archive permissions for supported conference modules; policies are validated on the server |
| Conference operations | Manage participants, programme, disciplines, papers, venues, staff/VIP assignments, fees, passes, and coupons through the existing management pages |
| Runtime settings | Pause delegated writes, enable/disable imports, uploads, email operations/delivery, meal redemption, and delegated exports |
| Session policy | Configure maximum API session age from 15 to 1,440 minutes; sensitive operations retain a separate five-minute recent-authentication requirement |
| Upload policy | Configure the image size limit within the server's existing hard cap of 5 MB |
| Workspace presentation | Set application display name and a workspace announcement; clients refresh these on navigation/focus and periodically |
| Jobs and recovery | Monitor email/import jobs, retry failed/queued email jobs, cancel eligible queued jobs, and open import recovery workflows |
| Monitoring | View environment, Firebase project, Node runtime, uptime, disk space, storage location, record/job counts, and security configuration status |
| Email and media | Configure encrypted SMTP credentials, templates, queued notifications, and private VPS-hosted images through linked operational pages |
| Evidence | View trusted code-analysis reports and append-only audit history |

## Role and permission behavior

The built-in roles remain `superadmin`, `conference_admin`, `organizer`, `registration_manager`, `programme_manager`, `meal_desk`, and `participant`. Until a policy is explicitly saved, existing built-in permissions remain unchanged.

Custom role identifiers use lowercase letters, digits, and underscores, for example `support_viewer`. A custom role granting only `participants:read` can inspect participant records but cannot create, edit, or archive them. Read/write/archive are separate grants; choose read as well when the role should inspect records through the dashboard UI.

`roleDefinitions/{roleId}` stores managed policies. Each authenticated API request resolves the current role policy from Firestore. Browser navigation is refreshed on focus/navigation and every minute, while the backend enforces changes immediately on subsequent requests. Unknown, disabled, or malformed custom roles cannot sign in to the dashboard.

Only implemented module permissions can be delegated. Global user administration, role policies, infrastructure/configuration controls, audit management, and technical administration stay reserved for Super Admin. Super Admin always retains full access; editing a document named `superadmin` cannot restrict or replace that protected policy.

## Account changes and recovery

Use **Users & sessions → Manage access** to grant an existing Firebase user dashboard access or change an assignment. Name, email, and mobile remain required. Use **Create / invite user** for new accounts and invitation delivery.

Disable/enable updates dashboard state and Firebase Auth. If the Auth call fails after the database change, the account is marked `authSyncPending`; the UI explains that the action needs retrying. Role/status changes revoke refresh tokens where appropriate. Existing participant identities and linked registration email keys are not silently renamed.

Password-reset and verification actions queue emails through the normal worker. Configure SMTP and run the email worker for delivery. Reserved `.test` accounts have no deliverable mailbox and cannot use these recovery-email actions.

## Operational switches

Runtime settings are stored in `applicationSettings/runtime` and enforced by the dashboard API. The email worker also observes the email-enabled flag before claiming new jobs. Turning a switch off cannot undo a request or SMTP delivery already in flight.

Super Admin can still use Control Center when delegated writes are paused. Emergency maintenance mode remains available through the linked Application Settings page. Registration-open/publication metadata and the existing mobile app require their own explicit integration; they are not presented as universal server-side restrictions.

Jobs already sent or being processed cannot be resent/cancelled through the recovery action. Retry/cancel updates are transactional, and the worker rechecks status before claiming a queued message.

## Security and consistency safeguards

- Firebase tokens are verified, including revocation checks, before access is granted.
- Control Center requires an active Super Admin. Mutations require authentication within the last five minutes; sign out and sign in again when prompted.
- The actor's current Super Admin status is revalidated within privileged configuration/account transactions.
- A security-lock document serializes privileged policy/account changes; version checks detect stale edits.
- Self-demotion/deactivation is blocked. The last active Super Admin is retained. Marked development accounts do not count as replacements for a real production Super Admin.
- Roles with active assigned users must be reassigned or their users disabled before the role can be deactivated.
- Privilege, policy, account, runtime-setting, and job-recovery changes create audit records. Recovery links, passwords, and infrastructure secrets are not returned in monitoring or job-list responses.
- No arbitrary shell execution, raw collection editor, password retrieval, or permanent audit/redemption deletion is exposed.

## Integration boundaries

These access policies govern the **dashboard and its API**. Flutter conference roles (`presenter`, `attendee`, `speaker`, `vip`, `organiser`, `volunteer`) remain separate from software administration roles. Direct mobile Firestore access is governed by the separately deployed Firestore rules. Revoking refresh tokens does not automatically invalidate every already-issued token at direct Firebase clients; those rules must enforce the desired account/revocation status.

Firebase credentials, encryption/signing keys, host paths/URLs, database-rule deployment, application releases, and full database/file backup/restore remain protected infrastructure operations. Control Center exposes configuration readiness and paths, but does not write arbitrary environment files or execute deployments from a browser. Changing these infrastructure values still requires the deployment configuration.

## Verification

Automated tests cover permission isolation, protected Super Admin access, custom and inactive policies, reserved-permission rejection, self/last-admin safeguards, recent authentication, write pauses, feature switches, configuration bounds, and browser management workflows. Browser mutation tests use intercepted Firebase/API responses, so they do not alter real user privileges or global settings.
