# Email OTP login implementation plan

Status: Approved for local implementation on `feature/email-otp-auth`; mobile-first implementation and remaining deployment/admin migration boundaries are documented in `OTP_IMPLEMENTATION.md`. The original proposal is retained below for context. Mobile OTP endpoints/UI and local tests are implemented; production migration, live deployment, administrator OTP migration and current environment settings remain unchanged.

## 1. Current implementation and findings

- `lib/screens/login_screen.dart` now contains Name, Email ID, Mobile Number and Continue. It calls the original development authentication path and keeps the existing selfie/dashboard navigation.
- `lib/main.dart` currently defaults `DIRECT_DEMO_LOGIN` to true. `DirectDemoAuthService` matches the bundled demo identities, authenticates those fixtures internally with Firebase and reads their protected Firestore registration. There is no password input and no email delivery. Non-bundled accounts are not supported by this default demo path merely because their name/email/mobile match.
- The alternative `FirebaseAuthService` supports `/api/testing/continue`: the development API matches an existing `people/{email}` registration, uses a Firebase Admin custom token, and the app calls `signInWithCustomToken`. It requires the correct test API URL and signing permissions. This path is already present; the UI change does not switch to it.
- The retained real email flow is `sendSignInLinkToEmail` / `isSignInWithEmailLink` / `signInWithEmailLink`. It sends a Firebase email link. No numeric email OTP generation, stored challenge, verification API, or numeric code entry flow was found in the inspected application code. Restoring a flag would restore links, not numeric OTPs.
- `check_email_screen.dart` already provides email verification layout, resend countdown, loading/error states and navigation. Reuse its presentation where practical; replace the link-specific behavior only after approval.
- Dashboard SMTP in `admin-dashboard/server/mail.ts` is reusable for sending OTP mail. `worker.ts` currently delivers queued administrative messages; it is not an authentication service.
- Mobile profiles and roles are in `people/{email}`. Dashboard permissions are separately stored in `adminUsers/{firebaseUid}` and `roleDefinitions/{role}`. Role labels supplied by the client must never determine access.
- The React admin dashboard has a separate email/password login and development role buttons. They remain unchanged in this UI-only step. Migrating that separate login to three fields/OTP requires the approved implementation below; deleting its password field alone would break it.
- Previously added password authentication service methods and account provisioning remain in place but are no longer called by the mobile login form. Removing those backend capabilities or changing existing Firebase identities is deferred to approval.

## 2. Proposed production login sequence

1. Enter Name, Email ID and Mobile Number and press Continue.
2. Normalize email and mobile using the shared identity rules. On the trusted server, match an existing registration and check Firebase identity status and eligibility for the requested application (`mobile` or `dashboard`). Do not offer public self-registration or accept a client-selected role.
3. Return a generic response and an opaque challenge identifier. For an eligible account, generate a cryptographically random six-digit code and email it to the registered address using the existing server SMTP transport. Do not issue a Firebase session yet.
4. Show the OTP screen with a masked address, code input, Verify, Resend and Change details. No account access is granted while waiting.
5. Submit challenge ID and code. Verify expiry, attempt limits, eligibility and the code on the backend. Atomically consume the challenge so concurrent requests cannot reuse it.
6. Only after verification, establish email ownership, update verification metadata, generate a Firebase custom token for the existing UID, and return it over HTTPS with `Cache-Control: no-store`. If final session creation fails, fail closed and request a new challenge rather than restoring an unverified session.
7. The client exchanges the custom token with Firebase, loads its own current profile and effective permissions, and follows the existing dashboard navigation. OTP verification must precede any protected profile read or dashboard transition.
8. Use Firebase session restoration for subsequent app opens, subject to session age, account disablement/revocation and authorization checks. A restored session is not a new name/email/mobile authentication attempt.

Name and mobile are matching information, not authentication secrets. Successful OTP verification proves access to the registered mailbox; it does not verify ownership of the mobile number.

## 3. Proposed APIs and storage

| Proposed API | Responsibility |
| --- | --- |
| `POST /api/auth/email-otp/request` | Accept identity details and application audience; check eligibility, enforce limits, create/send challenge; return generic response and opaque ID. |
| `POST /api/auth/email-otp/verify` | Accept ID and code; atomically verify and consume; issue the Firebase session credential only on success. |
| `POST /api/auth/email-otp/resend` | Enforce cooldown and quotas; invalidate the old code and issue a replacement. |

Authentication endpoints must be registered before the existing dashboard bearer-token middleware, with their own validation, abuse controls and HTTPS requirements. No existing authenticated administrative endpoints should become public.

Proposed server-only `authChallenges/{randomId}` fields: UID, normalized identity binding, application audience, code HMAC, creation/expiry timestamps, failed-attempt count, resend/issuance metadata, delivery state, used/replaced status and use timestamp. Use an HMAC with a server-only secret, binding the challenge ID and code; a plain hash of a six-digit code is insufficient against offline guessing. Never store the raw OTP in profile records, routine email jobs, audit details, URLs or logs.

Maintain server-only, durable rate-limit/issuance records keyed by protected account/IP identifiers. Firestore transactions must enforce limits across API instances and across resends. Firestore rules deny all client access to challenge/limit collections. TTL cleanup is housekeeping: the server still checks expiry on every verification.

Keep the existing profile keys and Firebase UIDs. Add explicit production verification metadata such as `lastEmailOtpVerifiedAt` and `emailVerificationMethod`; distinguish demo bypass verification from real mailbox verification. A historical `emailVerified=true` from development is not proof of a production OTP login.

## 4. Security and delivery rules

Proposed initial settings, subject to review:

- Six-digit random OTP, five-minute lifetime, five incorrect guesses per challenge, and at least 60 seconds between sends. Add rolling account/IP limits so new challenges cannot reset brute-force protections.
- Single-use, transactionally consumed codes; a resend invalidates previous codes. Recheck disabled/archived/inactive accounts, registration eligibility and current role status before issuing any token.
- Generic request/resend responses for unknown or mismatched accounts, with similar response behavior and limits to reduce enumeration. No tokens or sensitive profile details in those responses.
- Send via the existing TLS SMTP transport through an authentication-specific sender, with bounded timeouts. Avoid the ordinary retrying queue for short-lived OTPs; delayed messages must never revive expired/replaced challenges. Keep other administrative email workflows unchanged.
- Display safe validation, expiry, throttling and delivery-failure messages; record safe authentication audit events without codes or session credentials.
- HTTPS, restrictive CORS for the web client, request-size/schema validation and layered abuse controls. Mobile clients cannot be secured solely by CORS. Consider App Check/CAPTCHA as an additional anti-abuse layer after assessing platform support.
- Successful email OTP is not privileged MFA. Preserve Super Admin step-up protection. Do not fabricate Firebase second-factor claims in custom tokens. The separate admin migration must include a supported, server-verified privileged step-up design before Super Admin OTP sessions gain administrative access.
- Removing password UI does not disable other Firebase sign-in methods. Before production cutover, prevent legacy passwords, demo credentials, bypass routes and old sessions from accessing production resources. Require the approved session provenance in both API middleware and Firestore rules, validate session age/revocation, and remove unnecessary password providers only after checking impacts on other clients. Do not rely solely on the visible login screen or a permanent `emailVerified` flag.

The Firebase custom-token integration follows [Firebase Admin custom authentication documentation](https://firebase.google.com/docs/auth/admin/create-custom-tokens). The proposed short lifetime, single-use behavior and abuse controls follow applicable [OWASP token/code guidance](https://cheatsheetseries.owasp.org/cheatsheets/Forgot_Password_Cheat_Sheet.html).

## 5. Development behavior

For now, keep the existing bundled demo login: three fields, Continue, existing role-specific dashboard, no email or OTP. Existing fixture passwords may still be used internally by that service; users do not enter them.

Supporting arbitrary dashboard-created accounts with only three entered details would require switching to or hardening the existing development custom-token path. This is a separate authentication change and will wait for approval. That path currently requires an existing Firebase identity, matching registration, test-server connectivity and Firebase Admin token-signing permission.

After approval, replace scattered bypass flags with an explicit server-controlled development authentication mode and a clear build configuration. Restrict bypasses to dedicated fixtures/development infrastructure; reject them on production startup and in production resource access rules. If email delivery is disabled in production, fail closed rather than bypassing OTP. Do not use a universal production code or return OTPs in production responses.

## 6. Role-based routing and authorization

- Mobile: read `people/{email}`, parse its existing conference role (presenter, attendee, speaker, VIP, organiser or volunteer), preserve the selfie step, then render the existing role-based dashboard.
- Web dashboard, if included in the approved migration: sign in to Firebase, call `/api/me`, resolve active `adminUsers`/`roleDefinitions` permissions, then use the existing role-specific home page. Dashboard access requires a dashboard profile, not just a mobile registration.
- Keep conference participation role and dashboard access role separate. Do not automatically grant Organizer/Super Admin permissions from a submitted category.
- Role changes, disabled accounts and expired sessions must be enforced by APIs and database rules, not just hidden navigation. Preserve self/last-Super-Admin protection and privileged step-up requirements.

## 7. Files/components to change after approval

| Area | Planned change |
| --- | --- |
| `lib/auth/participant_auth_service.dart` | Add typed request/verify/resend challenge contracts and explicit pending/verified/error states. |
| `lib/auth/firebase_auth_service.dart` | Add approved OTP API calls and custom-token exchange; retire link/password paths from the chosen production login mode. |
| `lib/screens/login_screen.dart` | Keep the three identity fields; initiate a challenge in production and the approved development flow in test builds. |
| `lib/screens/check_email_screen.dart` | Reuse layout/countdown/state handling for numeric OTP input and server-backed verification/resend. |
| `lib/main.dart`, demo service and session/deep-link handling | Select explicit modes, preserve demo journeys, stop defaulting production to demo login, retain link handling only where still needed. |
| `admin-dashboard/server/index.ts` plus a new OTP service/router | Validate requests, apply distributed limits, send codes, verify/consume challenges and issue Firebase custom tokens. |
| `server/mail.ts`, configuration | Reuse TLS SMTP; add server-only HMAC/configuration settings; do not expose secrets through `VITE_*`. |
| `server/testing-verification.ts`, account provisioning | Separate development bypasses from production, stop treating development verification as production proof, review password provisioning after login migration. |
| Firestore rules/indexes/TTL and Auth provider settings | Protect challenges, enforce approved session provenance and authorization, plan old-session revocation and safe migration. |
| React `App.tsx`/`firebase.ts` | Only if approved for the admin portal: add name/mobile fields and OTP state, exchange custom tokens, reuse `/api/me` and existing role navigation, preserve Super Admin step-up. |
| Tests and setup documentation | Cover both modes, delivery, permissions, migration and operational failure handling. |

## 8. Implementation order and acceptance tests

1. Confirm whether the first OTP release covers mobile only or mobile plus the separate React admin portal; confirm Super Admin step-up and development account scope.
2. Implement the backend challenge service, server-only storage/rules, SMTP adapter, limits and session policy with tests first.
3. Integrate the mobile OTP screen and Firebase custom-token exchange, preserving role/selfie navigation.
4. If approved, integrate the separate web login and privileged step-up without changing permissions or dashboard components.
5. Test correct/wrong/expired/replayed codes, concurrent verification, resends, rate-limit resets, unknown/mismatched details, SMTP failures, token-signing failures, inactive/deleted accounts and revoked sessions.
6. Test every mobile and dashboard role, denied unauthorized access, session restoration, disabled-email production failure and development login with zero outgoing emails.
7. Test direct Firebase password/demo access against production API/database rules, not only the UI. Confirm no OTP/password/token leaks in responses, logs, storage or bundles.
8. Stage the migration, revoke incompatible sessions, verify release configuration, and enable production OTP only after the approved acceptance checks pass. Do not deploy or change live authentication providers during planning.

## Approval boundary

Review this proposal before implementation. No OTP sending or new authentication behavior will be enabled until explicitly approved. Current delivery is limited to removing the mobile password field, restoring its existing three-field development submission path, regression tests, and this plan.


## Local implementation handoff

See [OTP_IMPLEMENTATION.md](OTP_IMPLEMENTATION.md) for implemented scope, configuration, tests and the staged production cutover. The original proposal below/above is retained as design context; no GitHub push or live deployment has been performed.
