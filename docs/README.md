# CONE TypeScript Admin Dashboard

## Repository layout

This repository holds the admin dashboard and its API server (React + Vite frontend, Express API in `server/`). The Flutter mobile app is a separate repository (default sibling folder `../Cone`). The two share only the Firebase project `conferencemanagement-239a3`:

- The mobile app calls this API for email OTP login (`/api/auth/email-otp/*`), selfie upload and the branding logo. Build the app with `--dart-define=AUTH_API_URL=<this API's address>`.
- Both read and write the same Firestore data; registrations are written through this API (the app's seed tools write only the six demo fixtures).

### Setup

1. `npm install`
2. Copy `.env.example` to `.env` and fill in the secrets. `GOOGLE_APPLICATION_CREDENTIALS` points to a service-account key kept outside the repository, which also signs login tokens.
3. `npm run dev` starts the API (port 8080), email worker and dashboard (http://127.0.0.1:3000). Set `HOST=0.0.0.0` so phones on the same network can reach the API.

### Adding registrations in bulk

Put people in a JSON file under `storage/` (ignored by Git) and run `npm run provision:people -- storage/<file>.json` (add `--dry-run` first). It writes `people/{email}` with role-specific data, issues meal coupons and creates passwordless Auth accounts; each person then signs in to the app with an emailed OTP. See `ROLE_DATA.md` in the app repository for the data each role needs.

`npm run verify:test-accounts` reads the app's seed data from `APP_REPO_DIR` (default `../Cone`).

## Role-aware interface

The dashboard now uses a shared navy/teal design system with role accents, task-focused welcome cards, grouped navigation, and a feature finder. Home actions are generated from the signed-in user's actual permissions: Super Admin emphasizes system/access controls; conference administrators and organizers emphasize event coordination; registration staff see participant/import/fee work; programme staff see sessions/papers/venues; Meal Desk focuses on redemption; Participant sees only their own conference information.

The Participant page reads the authenticated user's own registration through `/api/profile`, including their schedule and issued meal arrangements. It does not expose a participant directory or another user's records. Manual and development one-click logins remain available.

Shared styling is in `src/dashboard-theme.css`; role-specific presentation and shortcuts are in `src/RoleWorkspace.tsx`. The mobile/tablet drawer supports navigation search, backdrop dismissal, Escape, focus trapping, and inactive off-screen content. Tables scroll within their panels on small screens; dialogs, forms, and cards adapt to the viewport. Motion follows the system's reduced-motion preference.

Browser checks cover all seven test roles at 1440px desktop, 834px tablet, and 390px mobile widths, in addition to existing login, participant editing, and Control Center workflows.

## Super Admin management

The new **Control Center** centralizes Firebase user/session operations, custom roles and permission matrices, runtime settings, job recovery, and system monitoring. See [Super Admin rights and operating guide](SUPERADMIN_CONTROL_CENTER.md) for the implemented capabilities, lockout safeguards, and mobile/infrastructure integration boundaries. Existing account credentials and developer role-login buttons remain available.

## Dashboard test logins

### Temporary one-click dashboard login

The existing dashboard login form also offers separate Login buttons for all seven software roles. These buttons use the already-provisioned dashboard test accounts; they do not create records or grant permissions. Manual email/password login remains available.

Both `APP_ENV=development` and `APP_ENV=test` support these explicitly enabled local shortcuts. `APP_ENV=production` or `NODE_ENV=production` disables them.

Enable all of these local settings and restart `npm run dev`:

```dotenv
APP_ENV=development
ENABLE_ADMIN_TEST_ACCOUNTS=true
ENABLE_DASHBOARD_ROLE_LOGIN=true
VITE_ENABLE_DASHBOARD_ROLE_LOGIN=true
```

To remove the buttons, set `VITE_ENABLE_DASHBOARD_ROLE_LOGIN=false`. To disable their API as well, set `ENABLE_DASHBOARD_ROLE_LOGIN=false`. Production frontend builds exclude the one-click component even if its flag is true. The API returns 404 in production or when either server flag is off. It additionally requires loopback host/socket/browser origin and rejects forwarded requests. Use `http://localhost:3000` or `http://127.0.0.1:3000` locally.

The endpoint reads the ignored `storage/admin-test-credentials.json` file and verifies Firebase test markers, signed test-account claims, active status, and the matching role before supplying credentials to the local development browser for a normal Firebase password sign-in. Passwords are not embedded in frontend assets or `VITE_*` settings. Keep this local testing option disabled on hosted infrastructure. This feature applies only to the web dashboard, not Flutter/mobile login.

Dedicated role-specific Firebase dashboard accounts have been provisioned separately from the mobile demo participants. Their generated credentials are saved locally in `storage/admin-test-credentials.json` (ignored by Git). The Super Admin test address is `superadmin@cone-admin.test`; other addresses and passwords are in that file. These are reserved test identities, not deliverable mailboxes, so password recovery by email is unavailable.

Use `APP_ENV=development` and `ENABLE_ADMIN_TEST_ACCOUNTS=true` for these accounts. The development-only MFA exemption requires the account marker, matching reserved email, and signed Firebase test claim together. Production rejects marked test accounts; real administrative accounts retain the normal MFA requirement. Never use these fixtures as production credentials.

Run `npm run setup:admin-test-accounts` to reapply this explicit development fixture setup with Firebase Admin credentials. It reuses the locally saved passwords, verifies Firebase sign-in, and does not modify unrelated participant or admin accounts. Restart the API after changing environment flags. Keep the generated credential file private.

> **Current testing login:** the APK connects directly to Firebase using the six
> fictional demo accounts. Enter the exact registered name, email and mobile and
> tap Continue. No testing API URL, custom-token signer, OTP, email or manual
> verification is required. Roles and dashboard data are read from live Firestore.
>
> Build: `flutter build apk --release` from the Flutter project root.
> First-time setup/refresh: `node tools/seed/setup_direct_demo_login.mjs` with ADC.
> The generated `assets/testing/demo_login.json` is ignored by Git and contains
> credentials only for the six fictional demo accounts, never admin credentials.
> These demo credentials are bundled into the testing APK and are extractable;
> this is deliberately a demo-only build. Disable it with
> `--dart-define=DIRECT_DEMO_LOGIN=false` before restoring other login modes.
> Previous API/verification setup sections below describe retained alternatives
> and are not required for the current direct-login testing flow.


React + TypeScript + Vite frontend, Express + TypeScript API, Firebase Authentication, and Cloud Firestore. Image bytes stay on the local VPS filesystem. This project lives independently from the Flutter application and preserves its `people`, `conference/main`, `couponIndex`, and `mealRedemptions` data contracts.

## Local setup

1. Install Node.js 20.19+ (Node 22 LTS recommended).
2. From this directory, run `npm install`.
3. Copy `.env.example` to `.env`. Use a separate Firebase development project first. Set both server project ID and Firebase **web app** configuration; do not use the Android app ID as the web app ID.
4. Provide Firebase Admin Application Default Credentials, or set `GOOGLE_APPLICATION_CREDENTIALS` to a private service-account JSON file outside the repository. The server account needs appropriate Firestore and Auth permissions.
5. Enable Email/Password sign-in in Firebase Authentication for dashboard accounts. Existing mobile email-link sign-in can remain enabled. Add `localhost` to authorized domains.
6. Create your first dashboard account in Firebase Authentication, set a password, and verify its email through Firebase's verification workflow. Do not mark unverified public users as verified to bypass authentication.
7. Bootstrap Super Admin access using that account's email:

   ```powershell
   npm run bootstrap -- admin@example.org "Your Full Name" "9876543210"
   ```

8. Super Admin MFA is required by default. Enable SMS MFA in Firebase Identity Platform. If the initial verified sign-in is rejected for a missing second factor, use the dashboard's SMS enrollment form and sign in again. For a local development project only, explicitly set `REQUIRE_ADMIN_MFA=false` if MFA is unavailable. Production startup rejects that bypass.
9. Run `npm run dev`. Open **http://localhost:3000**. The API listens on **http://127.0.0.1:8080**. No production data is seeded automatically.

The unconfigured UI shows setup instructions rather than fabricated live records. All management operations require a verified Firebase ID token and an active server-managed `adminUsers/{uid}` record. A conference `organiser` role alone never grants dashboard access.

## Implemented screens and operations

- Overview with live registrations, confirmed users, presenters, role breakdown, meals, and imports.
- Participant create/edit/search/pagination, required identity/affiliation validation, existing Flutter conference roles, status and fees.
- Super Admin account invitations, verification/password setup emails, access assignment, deactivation, token revocation, and self-demotion protection. Sensitive changes require a sign-in within the last five minutes.
- Programme sessions with venue overlap checking and publication to `conference/main.schedule`.
- Disciplines, venues, staff duties, VIP host assignments, fee records, and papers/authors. Papers and staff details publish into compatible participant objects.
- Meal slot configuration, coupon issuance to confirmed participants, and trusted single-use redemption with time-window checks.
- Signed pass issuance/reissue, revocation, and entry verification. Set `PASS_SIGNING_SECRET` to at least 32 random characters. Reissue invalidates the previous managed pass.
- Private VPS image uploads/archive, MIME/size/dimension validation, metadata stripping, authenticated previews, and persistent metadata.
- Excel sheet inspection, custom column mappings, participant template, USSTC headers, create/update modes, validation previews, downloadable row reports, job history, duplicate detection, and resumable failed imports with row idempotency.
- SMTP tests, saved plain-text templates, registered-recipient notification batches, persistent delivery jobs, and a separate retrying email worker. The Super Admin can configure SMTP in the panel; saved passwords are encrypted with AES-256-GCM using a server-only `CONFIG_ENCRYPTION_KEY`. Environment settings remain the fallback until an override is saved.
- Conference dates, venue/contact details, draft/published metadata, application feature settings, audit history, trusted analysis results, live backend health checks, and participant Excel exports.
- `npm run analyze` executes fixed build/test commands in trusted operations tooling and writes bounded, versioned analysis summaries to Firestore.
- Responsive desktop/mobile interface with separate software permissions and conference participation roles.

## Scope and remaining specification work

The local implementation covers the principal dashboard modules. The following boundaries need to be considered when integrating it with the existing app:

- One active event (`main`) is supported. Multi-conference management requires a Flutter/data migration.
- Dashboard authentication uses password + SMS MFA; the Flutter app retains Firebase email-link sign-in. Other MFA methods and administrative passwordless links are not included.
- Import validates every row before publication, then commits each participant transaction separately. A later server failure preserves successful rows; retry skips already-processed rows. It is not a transaction over the entire workbook. Existing email/role relationship migrations are intentionally restricted. Paper/author import and automated multi-author identity disambiguation are not included; manage papers in their own screen. Participant Auth accounts can be created by Firebase's existing email-link flow; dashboard account invitations explicitly create Auth accounts.
- Workbook intake limits compressed files, ZIP entries, expanded bytes, sheets, rows, macros, and external workbook links. Imports are restricted to authorized staff, not a public upload endpoint. Import execution runs in the API process; failed jobs can be retried. A server interruption leaves a ten-minute lease before recovery; automatic scheduling/recovery of imports is not included.
- Email delivery is at least once: stable message IDs and batch idempotency reduce duplicates, but SMTP cannot guarantee exactly-once delivery if the process fails after the server accepts a message and before status is persisted. Up to five attempts use backoff. Run the worker separately; queuing alone does not send messages.
- Fees are administrative whole-INR records, not a payment-gateway integration or accounting ledger. Participant exports are capped at 5,000 records per request.
- Discipline records are stored administratively; official workbook summary totals are not overwritten with live registration counts.
- Newly issued signed pass strings are compatible with the mobile QR payload field. The entry panel accepts pasted/scanned token text; a built-in camera scanner and rotating/expiring tokens are not included. Legacy plain-ID passes need reissue before signed verification can accept them. The mobile UI must refresh after issuance and does not yet display revoked status itself.
- Media is private; device-only selfies stay on the device. Public branding delivery, replacement versioning, retention cleanup, and automated backup/restore tooling are not included. VPS backups remain an operator responsibility.
- Analysis publication is available through `npm run analyze`; CI credentials, scheduling, and release deployment must be configured for your infrastructure.
- Archive is available for standalone records and participants/accounts. Linked paper/staff relationship migrations and participant email changes require a reviewed migration to avoid orphaned mobile data.
- Maintenance mode is enforced by this dashboard API for non-Super-Admin accounts. Registration-open and publication status are stored metadata for subsequent public/mobile integration; they do not currently gate the Flutter app. Conference data is cached in the current Flutter repository, so users may need to restart it to see new programme data.
- The existing root Firestore rules are unchanged and must be hardened/reviewed before production, especially the legacy direct-client redemption flow. Never assume server checks protect direct mobile writes. See the proposed rule file in `firebase/`.

## Firebase data and security

Administrative collections are accessed exclusively through the API using Firebase Admin SDK. **Admin SDK bypasses Firestore rules**, so the API checks account state, verified identity, permissions, and scope on every request. Do not add broad browser write permissions for admin collections.

`adminUsers/{uid}` stores `fullName`, `email`, `mobile`, `accessRole`, `conferenceId: "main"`, `status`, and a concurrency version. Super Admin is a software access role; it is deliberately absent from the Flutter `Role` enum.

The supplied `firebase/firestore.rules` is a proposed replacement for the root rules, not automatically deployed. It retains mobile reads, restricts new administrative collections, and strengthens coupon checks. Review and emulator-test it with the Flutter app before deploying it. Existing coupon-index data lacks new slot links and will need migration to use the stricter redemption rules.

## Commands

```powershell
npm run dev       # frontend + API
npm test          # validation and permission tests
npm run test:browser # mocked Firebase/API browser journey; Edge on Windows
npm run build    # strict TypeScript, frontend, and server builds
npm start        # compiled server + static frontend
npm run worker   # development email delivery worker (separate terminal)
npm run worker:production # compiled worker under a separate supervisor
npm run analyze  # run checks and publish trusted reports; needs Firebase credentials
```

## VPS deployment

1. Provision the supported Node runtime and install with `npm ci`. Run `npm run build`.
2. Set `APP_ENV=production`, HTTPS `ADMIN_BASE_URL`, exact `CORS_ALLOWED_ORIGINS`, Firebase web/server configuration, `REQUIRE_ADMIN_MFA=true`, persistent `STORAGE_ROOT=/srv/cone/storage`, and TLS SMTP settings.
3. Keep `VITE_API_BASE_URL=/api` for a same-origin reverse proxy. Public `VITE_*` settings are built into the browser bundle, so rebuild after changing them. Secrets must never use `VITE_*` names.
4. Run `npm start` under a process supervisor with the project as its working directory. Proxy HTTPS traffic to `127.0.0.1:8080`; the server serves the compiled web app as well as the API. Forward bearer headers. Do not expose `STORAGE_ROOT` as a public directory.
   Run `npm run worker:production` under a second supervisor to deliver queued invitations and notifications. Configure `PASS_SIGNING_SECRET` before issuing signed passes; retain the secret securely across restarts.
   Set `CONFIG_ENCRYPTION_KEY` to a base64-encoded random 32-byte key before saving SMTP passwords through the panel. Generate it with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Keep the key outside the database and retain it with secure recovery material; changing it makes existing encrypted credentials unreadable.
5. Back up Firestore and the VPS storage together, restrict file permissions, and configure monitoring and log retention. Do not run the application as root.
6. Complete the remaining scope above and run real Firebase/rules/SMTP integration checks before public production use.

Development uses relative API URLs. VPS images are requested through authenticated `/api/media/{assetId}/file` endpoints; database asset metadata stores only relative storage keys. On physical mobile devices, use a reachable LAN hostname rather than `localhost`.

## Verification

Local checks cover strict compilation, validation and permissions, HTTP authorization boundaries with mocked Firebase Admin, real XLSX encoding/decoding and limits, and a desktop/mobile browser journey using intercepted Firebase/API responses. Browser fixtures never write to a Firebase project. On non-Windows hosts, install Playwright Chromium with `npx playwright install chromium` before the browser check.

Live Firebase login/data writes, SMS enrollment/delivery, Firestore rule behavior, SMTP delivery, and VPS deployment require your credentials and infrastructure and have not been verified by these local checks. No production Firebase resources or existing root rules are changed automatically.

Dependency overrides pin compatible Firebase app packages for Node 20 and patch transitive gRPC/UUID advisories. The lockfile records the tested dependency graph; use `npm ci` to reproduce it.

## Source references

- [Dashboard specification](DASHBOARD_REQUIREMENTS.md)
- [Firebase ID-token verification](https://firebase.google.com/docs/auth/admin/verify-id-tokens)
- [Vite setup and runtime requirements](https://vite.dev/guide/)


## Mobile test accounts and verification

The six persisted mobile registrations are in the app repository's `tools/seed/seed_data.json`.
The Presenter, Attendee, Speaker, VIP, Organiser and Volunteer accounts use
`presenter@gmail.com`, `attendee@gmail.com`, `speaker@gmail.com`, `vip@gmail.com`,
`organizer@gmail.com` and `volunteer@gmail.com`. Existing names, mobile numbers,
Auth UIDs, registration IDs, passes and coupons are retained when updating them.

Enable the no-email verification routes only on a private testing API:

```dotenv
APP_ENV=test
TEST_IN_APP_EMAIL_VERIFICATION=true
```

`APP_ENV=development` is also supported. The testing flag is disabled by default;
if enabled with any other environment, startup is rejected. These routes generate
Firebase links without SMTP and save verified status only after Firebase sign-in.

Run `npm run verify:test-accounts` with Firebase Application Default Credentials
to upsert the six requested identity records in the actual Firebase project,
exercise both application verification routes and real Firebase sign-in, then
read back verification status. The command retains existing Auth users and
associated data. It writes to the live database and sends no email.

For a testing APK, point it at this API using a device-reachable HTTPS address:

```powershell
flutter build apk --release --dart-define=IN_APP_EMAIL_VERIFICATION=true --dart-define=TEST_VERIFICATION_API_URL=https://YOUR-TEST-API
```

Run Flutter commands from the separate app repository. The local integration
check runs the real Express routes against live Firebase, without deploying an
API or claiming that an installed APK has been exercised on a physical device.


### Temporary automatic verification on Continue

The mobile app now skips the manual verification page by default in testing.
`POST /api/testing/continue` matches the existing name, email and mobile, keeps the
existing Auth UID, sets `emailVerified: true` and `emailVerificationStatus: Verified`,
and returns a custom sign-in token. It never generates or sends an email link/OTP.
`npm run verify:test-accounts` now exercises this automatic route.

Custom-token creation requires Firebase Admin signing credentials. Use an existing
service-account credential, or specify `FIREBASE_SERVICE_ACCOUNT_ID` with an ADC
caller that already has `iam.serviceAccounts.signBlob` on it. Missing signing
permissions return a configuration error without falling back to email delivery.
The existing verification routes remain available for restoration using the mobile
build flag `AUTO_VERIFY_EMAIL=false`. The API remains limited to test/development.
### Building a connected testing APK

The installed APK must include the real testing API address; the admin `.env`
file is not automatically included in Flutter builds. The Android release
manifest includes INTERNET permission.

From the project root, use:

```powershell
.\tools\build_test_apk.ps1 -ApiUrl https://YOUR-ACTUAL-TEST-API
```

Replace the example with the real HTTPS API origin. The script rejects
placeholders and localhost, checks the API health and automatic Continue route
using the existing presenter account, then embeds the URL and builds the APK.
The preflight marks that test account Verified but does not send email. If the
server is unavailable or lacks signing credentials, no APK is built. Reinstall
the resulting `build/app/outputs/flutter-apk/app-release.apk` on the phone.
The presenter login name is exactly `Aarav Mehra` (not `Arav Mehra`).

### Dashboard-created credentials and development email delivery

Use **User Management ? Add user** to create a Firebase Authentication account, assign an active dashboard role, and create the linked mobile registration. Enter a password of at least 12 characters. **Add participant** creates the participant registration, Firebase login and participant dashboard access together. Passwords are stored only by Firebase Authentication; profiles, audit logs and email jobs do not contain them.

Existing identities can receive dashboard access through User Management without re-creating the Firebase account. Only Super Admin can change an existing identity's password. Editing a dashboard role preserves the user's separate conference role and existing programme/coupon data. Changing a role revokes existing sessions; sign in again to use the new permissions.

In development/test only, with `TEST_IN_APP_EMAIL_VERIFICATION=true`, newly provisioned identities are marked verified by the trusted API so password login works without an email-verification step. Production does not apply this bypass. Super Admin MFA remains required outside the dedicated development fixtures. Invitations in this development mode contain password setup instructions without a verification link.

The mobile login now accepts a password for dashboard-created accounts alongside the existing name/email/mobile fields. Leave it blank for the existing bundled demo accounts. Rebuild/reinstall the mobile app to see this field. Dashboard roles control the web dashboard; conference roles control the mobile interface.

`npm run dev` now starts the API, frontend **and email worker**. Restart an existing development command to load this change and environment values. Production still requires the separate `npm run worker:production` process. SMTP connection tests send immediately; invitations and template messages are queued. Saving a template or SMTP settings alone does not send email.

If provisioning reports that a participant was saved but login setup failed, edit that participant, supply the password and retry. For an older registration created without a login, use User Management to create its account and assign dashboard access. Security checks may require a fresh sign-in before changing credentials or roles.

### Overview navigation and recent activity

Super Admin overview KPI cards and all six People at the centre categories open existing management views without a page reload. Participant drill-downs apply server-side role/status filters, exclude demo and archived records, retain pagination, and show a Clear filters action. Meals served opens meal redemptions for authorized users; users with meal-management access can open that section instead. Links respect the current user's read permissions.

Recent activity uses the eight newest existing audit events, including action, actor, target and an India-time timestamp, with links to the appropriate management section. The audit query is permission-gated and runs concurrently with the existing overview queries. Users without audit access retain the recent-imports view. No new event store or frontend request is required.

### Login UI update — OTP plan awaiting approval

The mobile login password field has been removed. The mobile form now uses Name, Email ID, Mobile Number and Continue with the existing development flow. The earlier password-field instructions above are superseded for the mobile UI. The default demo login still supports its bundled fixtures; removing the field does not enable arbitrary new accounts through a name/email/mobile-only production login. Backend password provisioning and the separate React admin login have not been migrated in this step. See `EMAIL_OTP_IMPLEMENTATION_PLAN.md` for the proposed numeric email OTP flow and approval boundary. No OTP email sending has been enabled.


### Optional numeric email OTP implementation

The approved mobile-first OTP implementation is on the local `feature/email-otp-auth` branch. See [OTP_IMPLEMENTATION.md](OTP_IMPLEMENTATION.md) for configuration and staging steps. Current demo/no-email settings and separate admin MFA login are retained. OTP endpoints are disabled unless explicitly enabled; live rules and providers have not been changed.

### App Branding

Open **Application settings > App Branding** as Super Admin. Enter the application name and optionally choose a logo, inspect the preview, then save. JPEG, PNG and WebP are accepted up to 2 MB and 4096 pixels per side; animated images and SVG are rejected. The server validates image contents, strips metadata and stores an optimized WebP in `STORAGE_ROOT` on the VPS. Replacements get new URLs so cached images do not hide the update. Removing a logo falls back to the application initial.

The name reuses `applicationSettings/runtime.applicationName`. A transaction updates that document and the public `conference/branding` document, including the logo reference. Optimistic versions prevent conflicting saves, and an audit event records the change. The existing Control Center application-name setting also updates the same public document. Only an active Super Admin with recent authentication may save branding; browser visibility alone is not the security control.

The web login, sidebar, header, footer, document title, favicon and participant instructions use a shared branding provider. The saving browser updates immediately; other open browsers refresh on focus or within 30 seconds. Flutter listens to the public branding document and updates the in-app logo/name on login, dashboards, passes and app-information screens. Its existing logo widget handles image-load failures gracefully. Old installed mobile builds need one rebuild/install to acquire this capability; later branding updates require no code changes or rebuild.

Set `PUBLIC_API_BASE_URL` on the backend to the externally reachable API **origin**, for example `https://api.your-domain.example` (without `/api`). The default is `http://localhost:8080`, suitable for a browser on the development machine. A physical phone cannot use that localhost URL: use the VPS HTTPS origin or a reachable development host. Save branding again after changing this origin to publish the new logo URL to mobile clients. Keep `STORAGE_ROOT` persistent across API restarts/deployments. Only branding logo files are public; participant uploads retain their existing authentication requirements. The public document contains no SMTP credentials or private settings. Existing conference read rules already allow this document; no new rules deployment was necessary.

This feature controls runtime **in-app** branding. Operating-system launcher labels/icons, package identifiers, store listing names and historical generated documents are separate build/store assets and are not renamed by a dashboard setting.

Validation includes API role/size/content tests, the complete Firestore/Auth emulator upload/save/read/removal workflow, web preview/save/reload coverage, branding across all seven role dashboards, and Flutter live-branding updates. These checks use test data; existing production branding was not renamed during implementation.

### Participant selfie uploads

The mobile app sends the captured selfie to `POST /api/mobile/selfie` as `multipart/form-data`, with the image in the `selfie` field and the participant's Firebase ID token in the header `Authorization: Bearer <idToken>`. The token must have a verified email that matches an active `people/{email}` registration. JPEG, PNG, WebP and HEIC are accepted up to 8 MB. The server re-encodes each photo as a JPEG of at most 1024 px. Re-encoding applies orientation and removes EXIF data, including GPS. The file is saved privately at `STORAGE_ROOT/selfies/<uid>.jpg`, one per participant, and a new upload replaces the old one. `people/{email}.selfieKey` and `selfieUpdatedAt` are updated with it. Participants can call `GET` or `DELETE` on the same path for their own photo. Dashboard users with participant read access can fetch `GET /api/people/:email/selfie`. Back up `STORAGE_ROOT` and keep it persistent on the VPS. Never serve it as a public directory.
