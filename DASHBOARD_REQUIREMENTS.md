# CONE Admin Dashboard Requirements and Data Management Schema

Status: proposed implementation specification based on the existing application.  
Application: CONE — Conference Operations & Networking Environment.  
Conference: 21st Uttarakhand State Science & Technology Congress 2026-27.  
Prepared: 18 October 2026.

Implementation update: the TypeScript dashboard now includes a [Super Admin Control Center](admin-dashboard/SUPERADMIN_CONTROL_CENTER.md) with user/session controls, managed role policies, runtime feature settings, job recovery, and monitoring. The linked guide distinguishes implemented rights from mobile/infrastructure integration boundaries.

## 1. Purpose and scope

Build a responsive web dashboard for managing the conference application, its users, organizers, registrations, scientific programme, passes, meal coupons, images, email delivery, and spreadsheet imports. The Super Admin controls both conference operations and software configuration.

This document describes requirements; it does not indicate that the dashboard or its backend has already been implemented. Keep the existing Flutter participant experience compatible while adding an authenticated administrative API and dashboard.

## 2. Existing app and code analysis

| Area | Existing implementation | Dashboard requirement or gap |
|---|---|---|
| Client | Flutter/Dart; screens under `lib/screens/` | Add a responsive web administration interface |
| Authentication | Firebase email-link authentication in `lib/auth/firebase_auth_service.dart` | Retain verified identity; add administrative permissions, account status checks, session revocation, and MFA for privileged accounts |
| Identity validation | `lib/auth/identity_matcher.dart` normalizes name, email, and Indian mobile numbers | Apply equivalent validation on forms, imports, and server writes |
| Data models | Typed JSON parsing in `lib/data/models.dart` | Add server-side validation, field constraints, administrative metadata, and compatible writes |
| Conference and people | `lib/data/firestore_repository.dart` reads Firestore | Add authorized create/update/archive workflows through a backend |
| Organizer overview | Existing counts by role, people directory, meals served | Expand into searchable management pages and operational reports |
| Meal redemption | Firestore transaction in `lib/coupons/firestore_coupon_service.dart` | Preserve single-use behavior; strengthen validation against issued coupon and owner data |
| Access rules | `firestore.rules` permits limited reads and staff redemption; denies client edits to master records | Define and test new administrative permissions; server SDK writes require their own authorization |
| Images | `lib/app/selfie_store.dart` keeps selfies in private device files; no upload | Add VPS filesystem storage for managed images; retain device-only selfies unless an explicit upload feature is introduced |
| Data loading | `tools/seed/seed.mjs` loads predefined JSON using Firebase Admin SDK | Build a validated Excel import workflow; the seed script is not an Excel importer |
| Email | Firebase currently sends sign-in links | Add server-side SMTP for notifications; custom sign-in delivery requires a separate integration |
| Configuration | Auth domain/package constants and seed project ID are embedded in code | Centralize environment configuration and distinguish public settings from secrets |
| Sample content | Seed file is marked `isDemo: true` | Clearly label sample data; exclude it from official totals and imports by default |

Existing roles are `presenter`, `attendee`, `speaker`, `vip`, `organiser`, and `volunteer`. There is currently no `superadmin` enum value or standalone admin dashboard. Conference dates, venues, and some programme details are sample/unconfirmed values; the dashboard must support draft information rather than treating it as official.

## 3. Roles and permissions

Separate software access permissions from the person's conference role. A participant type must never grant administrative access automatically. Preserve the existing spelling `organiser` in application data; the UI may display “Organizer.”

| Access role | Scope and responsibilities |
|---|---|
| Super Admin (`superadmin`) | Application-wide control: organizers, users, permissions, conferences, all operational records, imports, images, email settings, audit reports, and software settings |
| Conference Admin (`conference_admin`) | Manage all operational modules within assigned conferences; cannot grant Super Admin or change global infrastructure/secrets |
| Organizer (`organizer`) | Manage assigned conference participants, programme, duties, coupons, permitted imports, and communications |
| Registration Manager (`registration_manager`) | Optional delegated role: registrations, identity corrections, registration status, fees, participant imports and exports |
| Programme Manager (`programme_manager`) | Optional delegated role: disciplines, papers, authors, talks, venues, and schedules |
| Meal Desk / Volunteer (`meal_desk`) | Resolve and redeem issued coupons; view only the identity information needed to serve meals |
| Participant (`participant`) | View own profile, pass, coupons, paper/talk where applicable, and programme; request corrections |

Participant conference types remain presenter, attendee, speaker, and VIP. Organizer and volunteer conference types also retain their existing participant-facing passes, schedules, and duties.

- Create Super Admin, Participant, and Organizer access in the initial release. Other delegated roles can be enabled as permission presets.
- Store assignments by authenticated UID and conference scope; check them on every API operation, file download, import, and export.
- Only a Super Admin can grant global privileges or appoint/remove Conference Admins. Organizers cannot elevate their own permissions.
- Bootstrap the first Super Admin with a controlled server-side process. Protect the last active Super Admin from removal or deactivation.
- Record privileged changes in audit logs. Require recent authentication for privilege and credential changes.
- The Super Admin can manage all operational modules, but redemption history and audit records remain append-only. Corrections use separately recorded actions.

## 4. Dashboard pages and features

| Page | Required functions |
|---|---|
| Overview | Active registrations by role/status/discipline, oral/poster totals, issued/used meals by day, import failures, email failures, and storage health |
| User Management | Create/invite, search, filter, edit, activate/deactivate, revoke sessions, assign permitted roles, and view account history |
| Organizers & Staff | Conference assignments, delegated permissions, volunteer duties, and VIP liaison assignments |
| Participants | Required name/email/mobile, affiliation, registration details, paper/talk, fees, accommodation, pass, and coupons |
| Conference Settings | Name, short name, confirmed dates, timezone, venue, contact details, branding, draft/published state |
| Disciplines & Categories | Manage discipline names/codes, category codes I–IV, and oral/poster types; do not invent category meanings |
| Papers & Authors | Abstracts, submission IDs, ordered authors, affiliations, presenting author, discipline, category, and presentation type |
| Programme | Shared sessions, speaker talks, personal presentations, venues, VIP programme items, and staff duties; detect conflicts |
| Passes | Issue/revoke/reissue passes; show entry-system integration status |
| Meal Management | Configure meal slots/windows, issue coupons, scan/redeem, and report usage; preserve single-use records |
| Media Library | Upload, preview, replace, archive, and authorize access to VPS-hosted images |
| Excel Imports | Select workbook/sheet, map columns, validate, preview, confirm, track progress, and download error reports |
| Email / SMTP | Templates, permitted recipients, test delivery, queues, retries, and delivery history |
| Reports | Filtered registration, programme, fee, accommodation, and meal reports; permission-controlled exports |
| Code Analysis & System Health | Read-only build/check results, release/version details, backend health, and actionable findings |
| Application Settings | Environment URLs, upload limits, feature switches, maintenance mode, and backup status; sensitive settings restricted to Super Admin |
| Audit Log | Search actor, action, module, record, date, and result; redact secrets and minimize personal data |

Lists require pagination, search, useful filters, loading/empty/error states, and clear success/error messages. Bulk operations show affected records before execution. Support desktop and mobile layouts with keyboard-accessible controls.

## 5. Main requirement: application data management schema

### 5.1 Existing Firestore contract to preserve

| Collection/document | Current fields and behavior | Administrative management |
|---|---|---|
| `conference/main` | `name`, `shortName`, `notInWorkbook`, `categories[]`, `presentationTypes`, `totals`, `disciplines[]`, `schedule[]` | Publish validated conference configuration; public document must contain public information only |
| `people/{normalizedEmail}` | Identity, role, registration, paper/talk/host, duties, personal schedule, and coupons | Manage through validated server endpoints; preserve required model fields |
| `couponIndex/{couponId}` | `couponId`, `day`, `meal`, `window`, `email`, `fullName`, `registrationId`, `role` | Issue/update projections consistently with the owner's embedded coupons |
| `mealRedemptions/{couponId}` | `couponId`, `registrationId`, `participantEmail`, `meal`, `day`, `redeemedAt`, `redeemedBy` | Create once; do not edit/delete to make a used coupon usable again |

`conference/main` is currently a single-conference design. Supporting multiple conferences requires conference-scoped queries, unique identifiers, rules, and Flutter reader changes; adding a `conferenceId` field alone is insufficient.

### 5.2 Participant record field specification

| Fields | Type / requirement | Validation and management |
|---|---|---|
| `fullName`, `email`, `mobile` | Required text for every user | Trim input; valid normalized email and mobile; never import an incomplete identity |
| `role` | Required existing conference-role enum | Only one of the six supported model values until the Flutter model is explicitly extended |
| `registrationId`, `passId` | Required text | Server-issued, unique within the conference; never reuse a revoked identifier |
| `registrationStatus` | Required text | Proposed controlled values: pending, confirmed, cancelled, suspended; define eligible transitions |
| `affiliation` | Required nonempty text in the current Flutter model | Require it for records published to the app; drafts can remain unpublished until complete |
| `designation`, `workingAs`, `district` | Optional text | Length limits and approved codes where applicable |
| `discipline`, `disciplineShort`, `category` | Optional generally; required as applicable to presenter | Validate against configured disciplines and categories |
| `presentationType` | Optional `O` or `P` | Required for scheduled oral/poster presentations |
| `registrationFee` | Optional integer | Nonnegative whole currency units under the current model; document currency and avoid floating-point calculations |
| `feesReceived` | Existing optional text | Preserve compatibility; use a separate structured fee record for totals/status |
| `softCopy`, `accommodation`, `earlierAwardee` | Optional values parsed from Yes/No strings | Current JSON parser expects strings `Yes`/`No`, not JSON booleans; convert normalized internal values when publishing |
| `paper` | Optional object | `submissionId`, `title`, optional `abstractText`, and `authors[]` |
| `paper.authors[]` | Ordered objects | `name`, optional `affiliation`, `role`, boolean `isParticipant` |
| `talk` | Optional object | `title`, `session`, `day`, `start`, `end`, `venue`, optional `abstract` |
| `host` | Optional object | VIP liaison `name`, `role`, optional `mobile`; link to staff internally |
| `duties[]` | Text list | Prefer structured assignments internally and render text for current app compatibility |
| `personalSchedule[]` | Schedule objects | `day`, `start`, `end`, `title`, optional `venue`, `kind`, boolean `isOwnPresentation` |
| `coupons[]` | Coupon objects | `couponId`, `day`, `meal`, `window`; must match `couponIndex` |

### 5.3 Proposed administrative entities

These are new logical collections/entities. Retain Firestore initially; do not introduce a second database without a specific migration decision. Required identities use stable UIDs internally rather than mutable email addresses.

| Entity / suggested collection | Core fields | Relationships and rules |
|---|---|---|
| `adminUsers/{uid}` | `fullName`, `email`, `mobile`, `status`, timestamps | Authentication UID; every admin has required identity fields |
| `roleAssignments/{id}` | `uid`, `accessRole`, `conferenceId` or global scope, `grantedBy`, timestamps | Unique assignment; only authorized grantors can write |
| `conferences/{id}` | Names, dates, timezone, public contacts, status, branding asset IDs | Future multi-conference source; publish current event to `conference/main` during compatibility phase |
| `registrations/{id}` | `uid`, `conferenceId`, current person fields, `version`, timestamps | One registration per user/event; project to existing `people/{email}` |
| `disciplines/{id}` | `conferenceId`, `code`, `name`, `sortOrder`, `active` | Referenced by submissions; unique code per conference |
| `submissions/{id}` | `conferenceId`, `registrationId`, title, abstract, category, type, ordered authors | Unique submission ID; linked to presenter and schedule |
| `sessions/{id}` | `conferenceId`, title, start/end timestamps, timezone, venue ID, kind, speaker/registration IDs | Shared and personal schedule projections generated from these records |
| `venues/{id}` | `conferenceId`, name, location, optional capacity | Prevent overlapping room reservations where applicable |
| `staffAssignments/{id}` | `conferenceId`, staff UID, duty, session/time range, VIP registration ID if applicable | Resolve organizer duties and VIP hosts |
| `feeRecords/{id}` | `registrationId`, amount integer, currency, status, reference, recordedBy | Administrative fee tracking; payment gateway is outside this scope |
| `mealSlots/{id}` | `conferenceId`, date, meal, opensAt, closesAt, eligible roles | Configure actual event meals; six sample coupons are not a permanent limit |
| `passes/{id}` | `conferenceId`, `registrationId`, issuedAt, status, token version | Reissue/revoke with history; signed/rotating entry tokens require scanner implementation |
| `mediaAssets/{id}` | storage key, MIME, size, checksum, visibility, owner UID, conference ID, timestamps | Metadata only; binary image bytes live on the VPS filesystem |
| `importJobs/{id}` | uploader, scope, file key/hash, sheet mapping, mode, counts, status, timestamps | Child row results store row number, action, validation errors, target ID |
| `emailJobs/{id}` | recipient reference, template/version, status, attempt count, timestamps, sanitized error | Retry safely; no SMTP credentials or reusable sign-in links in logs |
| `applicationSettings/{id}` | scope, nonsecret options, updatedBy, version | Secrets stored outside public collections and returned only as masked status |
| `analysisReports/{id}` | commit/build ID when available, tool, result, findings summary, artifact reference, generatedAt | Trusted CI/operations writes; dashboard reads only |
| `auditLogs/{id}` | actor UID, role/scope, action, target, redacted changes, result, timestamp, correlation ID | Append-only; configurable retention and restricted access |

All mutable administrative records need server timestamps, `createdBy`, `updatedBy`, and a version for concurrency checks. Use `archivedAt` for master records where history must be retained. Redemption documents keep the existing immutable schema; schema extensions require corresponding rule updates.

### 5.4 Consistency and publication

- Use server transactions for uniqueness reservations and changes that must commit together. For larger operations use staged, resumable jobs with visible publication status.
- Updating names, roles, or coupon ownership must update affected current-app projections consistently. Never change historical redemption attribution.
- An email correction currently changes a Firestore document key. Handle Auth identity, person document, coupon index, access rules, and dependent references through a controlled migration; retain an audit trail.
- Compute live operational totals from accepted records. Display workbook source totals separately from imported/live counts and exclude demo records by default.
- Paginate growing records and keep administrative histories outside the embedded person/conference arrays. Maintain required Firestore query indexes.

## 6. User management and validation

Validate on both client and server; the server is authoritative. Imports and manual forms use the same rules.

- **Name:** required after trimming, 2–150 characters; support Unicode names, initials, punctuation, and spaces.
- **Email:** required, trim/lowercase for lookup, check syntax, verify ownership through authentication. Enforce uniqueness within the existing email-keyed registration model. Preserve plus aliases and dots.
- **Mobile:** required. Preserve current Indian-number compatibility: accept common spacing/prefix formats and normalize to a ten-digit number beginning 6–9. Store as text to preserve formatting; a future international format needs explicit client/schema changes. Flag duplicate mobiles for review rather than treating a shared number as proof of duplicate identity.
- **Values:** whitelist roles, category codes, discipline codes, presentation types, meal types, and allowed status transitions. Reject unknown fields and invalid types.
- **Programme:** require end after start, valid event dates/timezone, resolvable participant/venue references, and conflict warnings before publishing.
- **Numbers:** reject negative fees/counts and fractional values where integers are required; never silently coerce invalid spreadsheet cells.
- **Accounts:** deactivation must deny backend access, revoke privileged sessions, and affect direct Firestore access where used. A status field alone does not enforce suspension.
- **Coupon redemption:** verify coupon existence, authoritative owner/registration/day/meal, active eligibility, configured window, and staff scope inside the trusted transaction/rules. Current rules do not verify all these relationships.
- **Errors:** return field-level messages and import row references without exposing stack traces or secrets.

## 7. Images on a local VPS

“Local storage” means persistent files on the VPS for dashboard-managed images, not browser `localStorage` and not image blobs in Firestore. Existing participant selfies remain in private phone storage unless a separately authorized upload workflow is added.

- Store image files under a configurable persistent directory, for example `/srv/cone/storage`; store relative keys such as `conferences/event-id/images/asset-id.jpg` in the database.
- Construct URLs from the configured media base URL and relative key. Never store deployment-specific absolute filesystem paths as asset identifiers.
- Separate public branding from private participant images. Serve private files through authenticated endpoints or short-lived authorized URLs; never expose the private directory as static content.
- Proposed defaults: JPEG, PNG, WebP; maximum 5 MB and 4096 × 4096 pixels. Validate decoded contents and MIME, use generated filenames, remove unnecessary metadata, and reject path traversal and executable uploads.
- Write uploads to staging, validate them, then finalize metadata/files. Track failed uploads and unused assets for cleanup.
- Back up both file storage and asset metadata; test restoring matching versions. Files must survive application restarts and deployments.

## 8. Configurable VPS and localhost paths

Use environment configuration with a committed example file and separate development/production values. The following is a proposed configuration contract, not settings already consumed by the app:

```dotenv
APP_ENV=development
ADMIN_BASE_URL=http://localhost:3000
API_BASE_URL=http://localhost:8080/api
MEDIA_BASE_URL=http://localhost:8080/media
STORAGE_ROOT=./storage
FIREBASE_PROJECT_ID=your-development-project
AUTH_CONTINUE_URL=http://localhost:3000/finish-sign-in
CORS_ALLOWED_ORIGINS=http://localhost:3000
MAX_UPLOAD_MB=5
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_SECURITY=none
SMTP_USERNAME=
SMTP_PASSWORD=
SMTP_FROM_EMAIL=no-reply@example.test
SMTP_FROM_NAME=CONE
```

Production uses HTTPS domain URLs, an absolute persistent `STORAGE_ROOT`, the production Firebase project, restricted origins, and TLS-enabled SMTP. Supply credentials through server environment/secrets; never ship them in Flutter builds, browser bundles, or source control.

Pass public API/media/auth configuration into Flutter build configuration and web runtime/build configuration. Remove embedded auth domain/project assumptions where appropriate. Firebase authorized domains, link handling, Android App Links, and platform configuration must also match each environment; changing one URL does not update those automatically.

On an Android emulator, the host machine is commonly reached at `10.0.2.2`; on a physical phone use the development machine's reachable LAN address. `localhost` on the phone refers to the phone. Validate configured origins and paths at startup; host/database changes require controlled deployment by the Super Admin rather than unrestricted URL editing.

## 9. SMTP integration

- Send server-side registration notices, organizer invitations, programme updates, and import completion/failure messages.
- Provide Super Admin settings for host, port, security mode, username, masked password, sender identity, and test recipient. Password changes replace the secret; reads never reveal it.
- Use a background queue with bounded retries/backoff, delivery status, deduplication keys, and sanitized failure logs. A retry must not create a new invitation or duplicate a successful notification.
- Maintain editable templates with allowed placeholders and escaped user content; preview before sending.
- Keep Firebase email-link sign-in initially. If authentication mail must use custom SMTP, generate Firebase sign-in links on the trusted backend and send them through SMTP, retaining Firebase verification, authorized redirect domains, expiry, and one-time semantics. Do not create a separate homemade login-token mechanism.
- Restrict test destinations and SMTP configuration access to privileged users; do not turn test-email functionality into an unrestricted mail relay.

## 10. Excel import workflow

Support `.xlsx` first, including the existing workbook `USSTC 21 Final116 (1).xlsx`. Provide downloadable templates. Legacy `.xls` and CSV can be separate enhancements.

1. Select conference, upload workbook, and choose import type: participants, programme, or master data.
2. Inspect sheets and explicitly select data sheets. Treat the `MAIN` summary separately from participant rows.
3. Detect headers and offer saved column mappings. Preserve original sheet and row references.
4. Normalize values and validate required name/email/mobile plus all fields needed by the published app.
5. Show proposed creates, updates, unchanged records, duplicates, warnings, and errors without writing live data.
6. Let an authorized operator confirm create-only or update-existing mode. Match existing records by stable registration ID, with normalized email as a reviewed fallback; conflicting matches require resolution.
7. Stage and publish valid records through a resumable job. Default to blocking publication on validation errors; explicitly selected partial import publishes only valid rows and reports rejected rows.
8. Create/update Auth registrations and app projections in tracked steps. Use job/row idempotency keys; never overwrite served meals, silently grant privileges, or duplicate coupons on retry.
9. Provide counts, job history, and a row-level downloadable error report. Retrying failed rows must preserve successful work.

### Existing workbook mapping

These source headers are documented in `tools/seed/seed_data.json`; inspect the uploaded workbook before assuming sheet/header layout.

| Source header | Destination |
|---|---|
| `Name of Author(S)` | `fullName`; ambiguous multi-author cells require review before selecting the account holder |
| `Email Address` | `email` |
| `Mobile` | `mobile` as text |
| `Organizational Affiliation` | `affiliation` |
| `Discipline` | `discipline` |
| `CT.` | `category` |
| `O/P` | `presentationType` |
| `Title of Abstract` | `paper.title` |
| `Registration Fee` | `registrationFee` |
| `Working as` | `workingAs` |
| `Soft Copy` | `softCopy` as compatible Yes/No value |
| `District` | `district` |
| `ACCO` | `accommodation` as compatible Yes/No value |
| `Fees Received` | Existing text plus reviewed structured fee status |
| `Earlier Awarded` | `earlierAwardee` as compatible Yes/No value |

Configure workbook size, row, sheet, and decompression limits. Do not execute macros, external links, or formulas; require supplied values for required formula cells. Skip recognizable headers/summary rows with explicit reporting. Escape spreadsheet-formula prefixes in exported error/report cells. Never split author names automatically where identity is ambiguous.

## 11. Code analysis within the admin panel

Show trusted analysis results rather than accepting executable code or shell commands in the dashboard.

- Display source version/build identifier when available, report timestamp, check status, severity, affected file, and suggested action.
- Import reports from trusted CI or an operations job for `flutter analyze`, `flutter test`, and backend checks once that backend exists.
- Show operational checks separately: API reachability, Firestore connectivity, SMTP delivery, disk space, upload directory access, failed jobs, and backup freshness.
- Restrict detailed reports to Super Admin and explicitly authorized technical staff; redact credentials and participant data.
- Label missing/stale results clearly. Do not claim a passing build or healthy SMTP service without a recorded check.
- Allow acknowledgement and tracking of findings; changing a finding's status must not modify the original report artifact.

## 12. Backend and operational requirements

Deploy the dashboard web frontend, a trusted API, background workers, and persistent file storage on the VPS. Continue using Firebase Auth and Firestore for identity/data initially. Keep Firebase Admin credentials exclusively on trusted infrastructure.

Representative API modules: `/users`, `/role-assignments`, `/registrations`, `/conference`, `/submissions`, `/sessions`, `/meal-slots`, `/coupons`, `/media`, `/imports`, `/email-jobs`, `/analysis-reports`, and `/audit-logs`. Final framework and route design are implementation decisions.

Every endpoint validates authentication, account state, action permission, conference scope, and input. Apply pagination, rate limits, optimistic concurrency, structured errors, and request IDs. Protect cookie sessions against CSRF if cookies are chosen. Update Firestore rules alongside changes and test direct-client access, since the mobile app still uses Firestore.

Avoid arbitrary database editors, server command consoles, or executable upload features. Provide explicit supported management actions. Record backup status and failures without offering destructive infrastructure controls to ordinary organizers.

## 13. Delivery phases

1. **Foundation:** configuration, trusted API, Super Admin bootstrap, permission enforcement, audit logging, and required identity validation.
2. **Core administration:** organizers/users, participants, conference data, programme, coupon management, and compatible Firestore publication.
3. **Operations:** staged Excel imports, VPS media library, SMTP queue/templates, and reports.
4. **Technical administration:** code analysis reports, system health, backup visibility, and release readiness checks.

## 14. Acceptance criteria

- A Super Admin can manage organizers, users, event data, imports, media, email settings, and application configuration.
- An organizer can access only assigned event modules and cannot grant global privileges. Participants cannot read or change other participants' private records.
- Blank/invalid name, email, or mobile is rejected consistently in forms, API requests, and imports; current Flutter-required fields remain valid.
- A valid spreadsheet imports with a preview and history; invalid/duplicate rows are explained; retrying a completed job does not duplicate registrations, accounts, passes, coupons, or mail.
- Participant edits reach the existing Flutter app in compatible form, with a defined refresh/cache strategy for conference changes.
- Two concurrent attempts to redeem one coupon produce one success. Fabricated coupons, mismatched owners, suspended users, and unauthorized staff are rejected.
- Managed image bytes persist on the VPS. Private assets reject unauthorized requests, and changing configured media/API hosts requires no database path rewrite.
- Development works with localhost and documented emulator/device overrides. Production URLs and credentials remain environment-specific.
- SMTP test and queued notifications report success/failure without exposing secrets; existing sign-in remains functional.
- Code analysis reports identify the checked version and timestamp; missing or failed checks are visible.
- Privileged changes are auditable; backups restore both data and matching media; deactivation is enforced across backend and direct Firestore access.

## 15. Repository references

- [Application overview](README.md)
- [Current models and parser contract](lib/data/models.dart)
- [Firestore reader and overview queries](lib/data/firestore_repository.dart)
- [Current Firestore access rules](firestore.rules)
- [Authentication and embedded domain configuration](lib/auth/firebase_auth_service.dart)
- [Identity normalization and validation](lib/auth/identity_matcher.dart)
- [Meal redemption transaction](lib/coupons/firestore_coupon_service.dart)
- [Device-only selfie storage](lib/app/selfie_store.dart)
- [Seed data and workbook mapping](tools/seed/seed_data.json)
- [Existing JSON seed process](tools/seed/seed.mjs)

Review basis: repository code and documentation. No production account, workbook participant records, or live service was modified or validated to prepare this specification.
