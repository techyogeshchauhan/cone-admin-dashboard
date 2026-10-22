# Hardcoded Data Audit

Reviewed: **19 October 2026**. Branch: `feature/email-otp-auth`.

## Scope

Reviewed the Flutter app, React dashboard, Express/Firebase backend, shared schemas, Firestore rules, platform configuration, static Hosting page, seed tools and representative test fixtures. Findings are based on source searches and file inspection, not assumptions about current live database contents.

**This request changes documentation only.** No code, environment values, credentials, database records, authentication settings or deployments were changed. No seed/provisioning tools were run and nothing was pushed to GitHub.

Related literals are grouped below rather than listing every repeated label, color or spacing value. Dependencies, generated builds, logs and IDE metadata are outside the business-data inventory. Passwords, tokens, signing/encryption secrets and private contact records are intentionally not reproduced.

## Interpretation

- **Business data:** fixed event names, edition/year, organizer identity or product assumptions that may become stale.
- **Default:** a fallback literal whose effective value may already be configurable.
- **Contract/policy:** deliberate schema, security, platform or protocol constants. These should not automatically become unrestricted administrator settings.
- **Fixture:** intentionally static test/demo data; production isolation is the relevant concern.

The presence of a literal is not automatically a defect. In particular, the recently added in-app name/logo feature is database-driven; its fallback values do not negate that functionality.

## 1. Event identity and branding remnants

| ID | Hardcoded item | Location | Impact / later review |
| --- | --- | --- | --- |
| B01 | Sidebar event label `USSTC 2026–27` | [src/App.tsx](src/App.tsx), sidebar workspace | Not read from editable conference metadata. |
| B02 | Workspace summary repeats `USSTC 2026–27` | [src/RoleWorkspace.tsx](src/RoleWorkspace.tsx) | Another event/year string to update separately. |
| B03 | Login footer names the 21st Uttarakhand State Science & Technology Congress | [src/App.tsx](src/App.tsx), login view | Event-specific copy appears before login. |
| B04 | Footer abbreviation `USSTC` and supporting organization copy | [src/App.tsx](src/App.tsx), page footer | Application-name changes do not replace the event/organizer abbreviation. |
| B05 | Mobile `conferenceName = '21st Uttarakhand State Science & Technology Congress 2026-27'` | [common.dart:303](../lib/widgets/common.dart#L303), [login_screen.dart](../lib/screens/login_screen.dart) | Login uses this source constant even though conference data also exists in Firestore. Workbook-derived text is still static once compiled. |
| B06 | Expansion/tagline `Conference Operations & Networking Environment` | [common.dart:58](../lib/widgets/common.dart#L58), [src/App.tsx](src/App.tsx) | Used in mobile login/dashboard/pass/about and web footer. The branding editor changes the name/logo, not this expansion. |
| B07 | Initial dashboard HTML title contains `CONE`; fixed theme color | [index.html](index.html) | Runtime branding replaces the title after initialization; initial HTML/fallback metadata is static. |
| B08 | Separate Hosting landing-page title, heading and instructions contain `CONE` and its expansion | [hosting/public/index.html](../hosting/public/index.html) | This static page does not use the React or Flutter branding providers. |
| B09 | Android launcher label `CONE` and packaged launcher/splash assets | [AndroidManifest.xml:13](../android/app/src/main/AndroidManifest.xml#L13), [launcher icon](../android/app/src/main/res/mipmap-anydpi-v26/ic_launcher.xml), [launch background](../android/app/src/main/res/drawable/launch_background.xml) | Native launcher identity is a build asset; in-app branding does not modify it. |
| B10 | iOS display name `CONE`, bundle name `usstc_conference`, camera-permission text containing `CONE` and `demo selfie` | [ios/Runner/Info.plist](../ios/Runner/Info.plist) | Packaged OS-facing names and permission explanation. |
| B11 | Default name `CONE` and local `assets/images/cone_logo.png` fallback | [branding.dart](../lib/app/branding.dart), [common.dart](../lib/widgets/common.dart), [src/Branding.tsx](src/Branding.tsx), [shared/control.ts](shared/control.ts) | Intentional unconfigured/offline defaults. Effective in-app branding is already database-driven. |
| B12 | Sidebar `CONFERENCE OPERATIONS`, marketing headings and descriptive login copy | [src/App.tsx](src/App.tsx) | Supporting brand/marketing copy is English source text, independently of the configurable app name. |
| B13 | Generated identifier prefixes `CONE-` and `PASS-` | [server/accounts.ts:45](server/accounts.ts#L45), [server/index.ts](server/index.ts), participant/import creation | Identifier conventions are independent of branding. Do not rewrite existing identifiers without migration planning. |
| B14 | Automatic email subjects/bodies use `CONE`: SMTP test, dashboard invitation, password reset, email verification and OTP | [server/index.ts](server/index.ts), [server/control.ts:322](server/control.ts#L322), [server/email-otp.ts:160](server/email-otp.ts#L160) | In-app branding is not substituted into these automatically composed messages. User-editable notification templates are a different path. |
| B15 | SMTP sender-name fallback `CONE`, SMTP settings UI fallback, API/worker startup labels | [server/mail.ts:29](server/mail.ts#L29), [src/SmtpSettings.tsx:124](src/SmtpSettings.tsx#L124), [server/worker.ts](server/worker.ts), [server/index.ts](server/index.ts) | Sender name already supports saved SMTP/environment overrides. Startup messages are operational labels. |

## 2. Project, domain, platform and deployment configuration

| ID | Hardcoded item | Location | Impact / later review |
| --- | --- | --- | --- |
| D01 | Default Firebase project `conferencemanagement-239a3` | [.firebaserc](../.firebaserc) | Deployment target is fixed in this configuration file, outside application branding. |
| D02 | Retained email-link domain `conferencemanagement-239a3.firebaseapp.com`, `/finishSignIn`, Android package `com.usstc.usstc_conferenc`, minimum version `1` | [firebase_auth_service.dart:263](../lib/auth/firebase_auth_service.dart#L263) | Applies to the retained link flow. Project migrations require coordinated link/Auth/build changes. |
| D03 | Testing verification endpoint repeats the finish-sign-in domain/package | [server/testing-verification.ts:60](server/testing-verification.ts#L60) | Separate source copy can diverge from the mobile configuration. |
| D04 | Android verified-link Firebase hostname | [AndroidManifest.xml:44](../android/app/src/main/AndroidManifest.xml#L44) | Must remain aligned with generated links and Firebase configuration. |
| D05 | Android namespace/application ID `com.usstc.usstc_conferenc` | [android/app/build.gradle.kts](../android/app/build.gradle.kts) | Platform identity is not the application display name. |
| D06 | iOS bundle ID `com.usstc.usstcConference` and test variants | [project.pbxproj](../ios/Runner.xcodeproj/project.pbxproj) | Fixed build identities; different platform spellings need coordinated maintenance. |
| D07 | Firebase client configuration contains project/app/package identifiers and API-key entries | [Android google-services.json](../android/app/google-services.json), [root google-services.json](../google-services.json) | Values are not copied here. Client Firebase configuration is distinct from SMTP passwords and Admin service-account secrets, but remains environment-specific. These local files may be ignored by Git. |
| D08 | Seed/demo/migration/link helpers explicitly target the current Firebase project and/or fixed Android package | [setup_direct_demo_login.mjs](../tools/seed/setup_direct_demo_login.mjs), [sign_in_link.mjs](../tools/seed/sign_in_link.mjs), [migrate_role_emails.mjs](../tools/seed/migrate_role_emails.mjs), [server/verify-test-accounts.ts](server/verify-test-accounts.ts) | Review before executing tools in another environment. Project configuration is not centralized across all helper scripts. |
| D09 | Vite port `3000` and API proxy `http://127.0.0.1:8080` | [vite.config.ts](vite.config.ts) | Proxy target does not automatically follow a changed backend `PORT`. |
| D10 | Backend bind address `127.0.0.1`; port fallback `8080`; CORS fallback `http://localhost:3000` | [server/index.ts](server/index.ts) | Port and CORS already support environment overrides; bind address is source-defined. Loopback binding is an intentional reverse-proxy deployment choice. |
| D11 | Public branding origin fallback `http://localhost:8080`; invitation URL fallback `http://localhost:3000` | [server/branding.ts](server/branding.ts), [server/index.ts](server/index.ts) | Already overridable with `PUBLIC_API_BASE_URL` / `ADMIN_BASE_URL`. Phone localhost refers to the phone, not the development PC. |
| D12 | Frontend API fallback `/api`, branding route layout and local branding cache namespace | [src/firebase.ts](src/firebase.ts), [src/Branding.tsx](src/Branding.tsx) | API origin is already build-configurable through `VITE_API_BASE_URL`; route/cache conventions remain code-defined. |
| D13 | Storage/build paths `./storage`, `dist`, generated image/import filenames and development credential path | [server/index.ts](server/index.ts), [server/dev-role-login.ts](server/dev-role-login.ts) | Uploaded storage follows `STORAGE_ROOT`. The independent test credential location `storage/admin-test-credentials.json` is fixed. |
| D14 | Flutter package name `usstc_conference`, USSTC demo description and version `1.0.0+1` | [pubspec.yaml](../pubspec.yaml) | Build/package metadata; version also supports Flutter build overrides. |
| D15 | Android SDK floor `24`, Java/Kotlin target 17; iOS deployment target `13.0` | [build.gradle.kts](../android/app/build.gradle.kts), [project.pbxproj](../ios/Runner.xcodeproj/project.pbxproj) | Intentional platform/build support requirements, not ordinary business data. |
| D16 | Root Hosting directory `hosting/public` and Firestore rules path `firestore.rules` | [firebase.json](../firebase.json) | Root Hosting targets the static page; dashboard deployment assumptions should be reviewed separately. |

## 3. Roles, business rules and database assumptions

| ID | Hardcoded item | Location | Impact / later review |
| --- | --- | --- | --- |
| R01 | Six conference roles: presenter, attendee, speaker, vip, organiser, volunteer | [models.dart:92](../lib/data/models.dart#L92), [shared/schema.ts:2](shared/schema.ts#L2) | Fixed mobile enum, validators and rendering. Adding a custom dashboard role does not automatically create a new mobile category. |
| R02 | Seven built-in dashboard roles and default grants | [shared/schema.ts](shared/schema.ts), [shared/dashboard-test-roles.ts](shared/dashboard-test-roles.ts) | Built-in presets are static, but managed non-Super-Admin definitions can override/extend dashboard policy. |
| R03 | Per-mobile-role labels, icons, background/accent colors | [roles.dart](../lib/app/roles.dart) | Source-defined presentation, not configurable role-management fields. |
| R04 | Staff/organizer checks use fixed volunteer/organiser categories in database rules | [firestore.rules:38](../firestore.rules#L38), [OTP rules](firebase/firestore.email-otp.rules), [proposed dashboard rules](firebase/firestore.rules) | Database access does not automatically inherit custom web dashboard permission definitions. Preserve authorization when changing categories. |
| R05 | Single conference identifier `main` across records, API operations, accounts, passes and authorization | [shared/schema.ts:77](shared/schema.ts#L77), [firestore_repository.dart](../lib/data/firestore_repository.dart), [server/index.ts](server/index.ts) | Multi-conference support is a data/auth architecture change, not just a settings field. |
| R06 | Collection/document names and email-keyed person IDs | [shared/schema.ts](shared/schema.ts), [firestore_repository.dart](../lib/data/firestore_repository.dart), [server/control.ts](server/control.ts) | Includes people, adminUsers, conference/main, conference/branding, couponIndex, mealRedemptions and applicationSettings paths. These are schema contracts. |
| R07 | Indian mobile matching: +91/91/0 normalization, 10 digits, first digit 6–9 | [identity_matcher.dart](../lib/auth/identity_matcher.dart), [shared/schema.ts:30](shared/schema.ts#L30), [server/testing-verification.ts](server/testing-verification.ts) | Country-specific rules are duplicated in client/backend/testing paths. International support needs aligned changes. |
| R08 | `INR`, whole-number fee amounts and registration-fee maximum 10,000,000 | [shared/schema.ts](shared/schema.ts), [src/App.tsx](src/App.tsx) | Currency and amount constraints are fixed business assumptions. |
| R09 | `Asia/Kolkata`, `en-IN`, activity suffix `IST`; conference timezone selector offers only India | [src/App.tsx:657](src/App.tsx#L657), [src/ConferenceEditor.tsx:73](src/ConferenceEditor.tsx#L73) | Display formatting remains India-oriented even if other conference metadata is edited. |
| R10 | Categories I–IV, presentation codes O/P, Yes/No flags and finite registration/submission/fee/meal/session option sets | [shared/schema.ts](shared/schema.ts), [src/App.tsx](src/App.tsx), [models.dart](../lib/data/models.dart) | Grouped source-defined vocabularies. Built-in form options and backend validation must remain compatible. |
| R11 | New-profile defaults attendee, pending, Not specified, empty schedules/coupons/duties and isDemo=false | [server/accounts.ts:43](server/accounts.ts#L43) | Inserted defaults for new profiles; not fabricated live participant totals. |
| R12 | Protected Super Admin wildcard, self/last-admin safeguards and permission resource/action vocabulary | [shared/control.ts](shared/control.ts), [server/control.ts](server/control.ts) | Intentional security invariants. Making every guard freely configurable would not be a safe blanket replacement. |
| R13 | Dashboard sections, editor fields, KPI labels/destinations, activity navigation mapping and role-specific shortcut/home layouts | [src/App.tsx](src/App.tsx), [src/RoleWorkspace.tsx](src/RoleWorkspace.tsx) | Navigation/layout are code-defined; KPI values and management records are API-driven. |
| R14 | English button text, help text, validation/error messages and screen headings | [mobile screens](../lib/screens), [dashboard source](src) | Grouped localization finding. No centralized translation catalog was found in the inspected application sources; individual ordinary labels are not all enumerated here. |
| R15 | Theme palettes, fonts, role styling, spacing, radii and responsive breakpoints | [theme.dart](../lib/app/theme.dart), [styles.css](src/styles.css), [dashboard-theme.css](src/dashboard-theme.css) | Intentional design constants, separate from the configurable name/logo feature. |
| R16 | Portrait-only app orientation, high camera resolution, private `selfies` directory and `.jpg` naming | [main.dart:27](../lib/main.dart#L27), [selfie_screen.dart:101](../lib/screens/selfie_screen.dart#L101), [selfie_store.dart](../lib/app/selfie_store.dart) | Fixed device UX and private-storage conventions. |
| R17 | Two-word initials, fixed honorific-removal regex, last-four-digit mobile masking | [models.dart:338](../lib/data/models.dart#L338), [paper_screen.dart:108](../lib/screens/paper_screen.dart#L108) | Formatting policy includes a fixed vocabulary of name titles; review for broader name formats. |

## 4. Authentication, upload, import and operational policy

| ID | Hardcoded item | Location | Impact / later review |
| --- | --- | --- | --- |
| O01 | OTP: six digits, five-minute lifetime, five wrong guesses/challenge, 60-second resend cooldown | [server/email-otp.ts](server/email-otp.ts), [check_email_screen.dart](../lib/screens/check_email_screen.dart) | Backend policy, frontend input and explanatory text must stay consistent. |
| O02 | OTP rolling window 15 minutes: five sends/account, 30 sends/IP, 20 verification attempts/account, 60/IP; counter cleanup uses a 24-hour offset | [server/email-otp.ts](server/email-otp.ts) | Durable security-policy constants, not dashboard runtime controls. |
| O03 | OTP session age 86,400 seconds; claim strings email_otp/mobile/custom | [firebase_auth_service.dart](../lib/auth/firebase_auth_service.dart), [OTP rules](firebase/firestore.email-otp.rules), [server/email-otp.ts](server/email-otp.ts) | Shared session/protocol contract. Mobile OTP sessions are explicitly rejected by admin APIs. |
| O04 | Sensitive actions require authentication within 300 seconds | [server/index.ts](server/index.ts), [server/control.ts](server/control.ts), [server/branding.ts](server/branding.ts) | Intentional freshness window duplicated across sensitive operations. |
| O05 | API limit 180 requests/minute; JSON body limit 256 KB | [server/index.ts:82](server/index.ts#L82) | Operational safety bounds, separate from durable OTP limits. |
| O06 | Runtime defaults: 480-minute sessions, 5 MB uploads, enabled feature switches; schema-defined allowed ranges | [shared/control.ts:87](shared/control.ts#L87) | Effective settings already support persisted Control Center overrides; defaults and allowed bounds remain code-defined. |
| O07 | Branding: 2 MB, 4096px input cap, static JPEG/PNG/WebP, 1024px output box, WebP quality 90 and one-year immutable cache | [server/branding.ts](server/branding.ts), [src/Branding.tsx](src/Branding.tsx) | Intentional validation/optimization policy. Client, server and help text should remain aligned. |
| O08 | General media: JPEG/PNG/WebP, 4096px cap and WebP quality 85 | [server/index.ts](server/index.ts), media upload handler | General media and branding have different pipelines/limits. |
| O09 | Excel: 30 sheets, 2,000 data rows/sheet, 1,500 ZIP entries, 32 MB total uncompressed, 16 MB/entry; macro/external-link rejection | [server/workbook.ts](server/workbook.ts), [server/index.ts](server/index.ts) | Deliberate import/ZIP safety policy, not business record values. |
| O10 | Excel aliases, participant template/example row, sheet/report titles and filenames | [server/index.ts](server/index.ts), import/template/export handlers | Built-in mapping/template data is tailored to current workbook conventions, alongside user-selected mappings. |
| O11 | Query caps: records 50; several lists 100; recent imports five; recent audit eight; participant export 5,000; explicit control-query caps | [server/index.ts](server/index.ts), [server/control.ts](server/control.ts) | Can affect completeness at scale. Cursor pagination exists for record lists; other capped endpoints do not all share that behavior. |
| O12 | Notification batches up to 50 addresses, template field lengths, only `{{name}}` replacement and fallback name Participant | [server/index.ts](server/index.ts), [server/worker.ts](server/worker.ts) | Composition rules are static even though saved template content is editable. |
| O13 | Worker: three-second polling, 50-job query, two-minute lease, five attempts, retry backoff starting at 30 seconds with one-hour cap | [server/worker.ts](server/worker.ts) | Delivery timing is source-defined; the runtime emailEnabled switch is configurable. |
| O14 | SMTP fallbacks: port 587, security none, no-reply@example.test; timeouts 15/15/30 seconds; message IDs end `@cone.local` | [server/mail.ts](server/mail.ts), [server/worker.ts](server/worker.ts) | Effective SMTP values are configurable. Timeouts/message-ID domain are source choices; no actual credentials are copied here. |
| O15 | Mobile HTTP timeouts 15/30 seconds; email resend timer 60 seconds; web branding refresh every 30 seconds | [firebase_auth_service.dart](../lib/auth/firebase_auth_service.dart), [check_email_screen.dart](../lib/screens/check_email_screen.dart), [src/Branding.tsx](src/Branding.tsx) | Operational UX values; server expiry checks remain authoritative. |
| O16 | Field lengths, role-ID regex, content/capacity bounds, provisioned-password length 12–128 | [shared/schema.ts](shared/schema.ts), [shared/control.ts](shared/control.ts), [server/accounts.ts](server/accounts.ts) | Grouped validation constants. Most belong in controlled schemas rather than unrestricted settings. |
| O17 | Pass HMAC sha256, signing-secret minimum length 32, JSON/base64url format and conference key main | [server/index.ts](server/index.ts), pass handlers | The secret itself is environment-provided, not hardcoded. Format changes need compatibility planning. |

## 5. Demo data, test fixtures and build-time modes

| ID | Hardcoded item | Location | Impact / later review |
| --- | --- | --- | --- |
| T01 | Mobile defaults DIRECT_DEMO_LOGIN=true, IN_APP_EMAIL_VERIFICATION=true, AUTO_VERIFY_EMAIL=true | [main.dart](../lib/main.dart), [firebase_auth_service.dart](../lib/auth/firebase_auth_service.dart) | Build-time defaults, not database settings. EMAIL_OTP_LOGIN is explicit; the production APP_ENV guard requires OTP mode. |
| T02 | Bundled demo JSON contains six fixture identities, UIDs and password fields; the direct-demo flow accepts its listed accounts | [direct_demo_auth_service.dart](../lib/auth/direct_demo_auth_service.dart), `assets/testing/demo_login.json`, [pubspec.yaml](../pubspec.yaml) | Credential values are omitted. This is testing authentication material, not normal production conference data. The local file is ignored by Git. |
| T03 | Six fixture people plus static conference metadata/schedule/discipline data | [seed_data.json](../tools/seed/seed_data.json) | Seed input is static. Firestore records may have changed independently after import. |
| T04 | Separate verification dataset has 12 fixture people and verification fields | [verification_test_data.json](../tools/seed/verification_test_data.json) | Testing dataset, not a live-user census. Personal contact details are not reproduced. |
| T05 | Fixed seven-role demo list, reserved @cone-admin.test identities, CONE Test names and test affiliation/contact metadata | [shared/dashboard-test-roles.ts](shared/dashboard-test-roles.ts), [server/setup-admin-test-accounts.ts](server/setup-admin-test-accounts.ts), [server/admin-test-access.ts](server/admin-test-access.ts) | Explicit fixtures. Passwords are generated/stored locally, not a universal frontend password. |
| T06 | One-click development login has a fixed loopback allowlist, reserved account constraints and credential-file path | [server/dev-role-login.ts](server/dev-role-login.ts) | Intentional temporary-access restrictions; these should not simply be loosened for production. |
| T07 | Testing APK helper provisions direct-demo data and builds release with DIRECT_DEMO_LOGIN=true | [build_test_apk.ps1](../tools/build_test_apk.ps1) | A release APK built with this testing helper is not automatically a production OTP build. |
| T08 | Mock users/emails, dummy codes/tokens, browser ports and demo-cone-otp project in test fixtures | [firebase.otp-test.json](firebase.otp-test.json), [playwright.config.ts](playwright.config.ts), [tests](tests), [browser-tests](browser-tests), [Flutter tests](../test) | Expected test-only constants; not live credentials or universal production OTPs. |
| T09 | Google API endpoint hostnames and fixed package/version parameters in verification/link helpers | [sign_in_link.mjs](../tools/seed/sign_in_link.mjs), [verify_role_logins.mjs](../tools/seed/verify_role_logins.mjs), [setup_direct_demo_login.mjs](../tools/seed/setup_direct_demo_login.mjs) | Provider API hostnames are contracts; project/package portions are the environment-specific values to consolidate if needed. |

## 6. Already configurable or database-driven

These were distinguished from hardcoded business data to avoid false positives:

| Area | Effective source | Boundary |
| --- | --- | --- |
| In-app name/logo | applicationSettings/runtime and conference/branding, plus the VPS logo reference | Static emails, native labels, tagline/event copy and separate Hosting page remain outside that path. |
| Participants and dashboard access | Firestore people/adminUsers/roleDefinitions | Built-in mobile enums and database role checks still impose the contracts above. |
| KPI numbers and category counts | `/api/overview` reads Firestore records and redemption counts | Labels, grouping and navigation destinations are static; displayed totals are not dummy constants. |
| Recent Activity | Existing auditLogs, or import records where appropriate | Formatting, query caps and destination mappings remain source-defined. |
| Conference data, sessions, papers, venues, fees, meals and passes | Firestore/API-managed records | Fixed defaults/vocabularies and the mobile login conference-title constant remain separate findings. |
| Email notification templates | Dashboard-managed emailTemplates documents | System-generated account/OTP/test emails have separate literal subjects/bodies. |
| SMTP configuration | Saved encrypted settings or server environment | Fallback literals are not exposed passwords; no secrets were copied. |
| Feature switches, session/upload settings | Persisted Control Center runtime settings | Defaults and allowed schema boundaries remain code-defined. |
| Web/backend Firebase settings, API/public-file origins | Environment/build configuration | Mobile link constants, native metadata and some maintenance tools do not all share the same configuration path. |

## 7. Suggested review order - no changes implemented

1. Decide which event name, edition/year, organizer abbreviation, tagline and email-branding fields should become configurable alongside existing branding/conference fields.
2. Centralize environment-specific Firebase/deep-link/package choices in deployment and maintenance tooling, preserving platform compatibility.
3. Review production/demo build separation and bundled fixture credentials before publication.
4. Confirm whether the product remains single-conference/India-focused or needs broader conference, category, locale, currency and phone support.
5. Review report/list caps and upload/import/delivery limits against expected scale while preserving sensible security safeguards.
6. Consider translations and theme configuration separately. Do not move every literal into Firestore simply because it is hardcoded.

## Review limitations

- This is a targeted grouped inventory, not an exhaustive count of every source literal.
- No live-user census, production configuration validation, binary asset/OCR inspection or external website review was performed.
- Secret-bearing environment/service-account files were not copied into the report. Their actual current values are not classified as code literals here.
- Existing database values may differ from checked-in seed input. A seed entry does not prove that the running application still uses that entry unchanged.
- Existing identifiers, already sent messages, printed passes and historical generated documents are not automatically renamed by branding changes.
- Native launcher names/icons and store metadata require build/store work; this audit documents that boundary without treating it as broken in-app branding.
- No tests/builds were executed for this documentation-only request. Previous implementation checks are not new runtime evidence for this audit.
- Follow-up implementation is deferred until you review the inventory and choose the updates.
