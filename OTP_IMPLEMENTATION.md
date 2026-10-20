# Local OTP implementation

Branch: `feature/email-otp-auth`. No GitHub push, live deployment, live authentication-provider changes, or real OTP emails were performed during implementation. Existing uncommitted work is preserved.

## Implemented scope

The mobile application has a numeric email OTP login mode. It reuses Firebase identities, registration profiles, role-based dashboards, selfie navigation and the existing email screen. The React administrator login retains its current password/MFA flow. Mobile OTP tokens are explicitly denied at dashboard APIs; OTP does not grant administrative access or replace Super Admin MFA. This follows the mobile-first rollout in the approved plan; migrating the separate administrator login and its privileged step-up is not part of this release.

Existing development settings are unchanged. OTP endpoints are absent unless explicitly enabled. Default demo login continues with name/email/mobile and sends no email. Arbitrary non-demo users use the OTP mode once deliberately enabled; matching three details alone does not grant production access.

## Enable for a local or staging review

1. Configure the API with `OTP_AUTH_ENABLED=true` and `OTP_HMAC_SECRET`, a server-only base64 secret containing at least 32 random bytes. Generate it locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`. Do not put it in Flutter defines, `VITE_*`, source control or logs. Existing TLS SMTP settings are reused.
2. Start the API normally. Registration must already exist in `people/{email}` and Firebase Auth. Accounts must not be disabled, archived, cancelled, suspended, demo fixtures or dashboard test identities. No public sign-up is introduced.
3. Build/run Flutter with `--dart-define=EMAIL_OTP_LOGIN=true --dart-define=AUTH_API_URL=http://YOUR_DEVELOPMENT_HOST:8080`. Use a host reachable by the device, not the device's own localhost. OTP mode takes precedence over bundled demo login and automatic development verification. A newly requested code is a real email when this mode and the server are enabled; do not enable it for recipients without permission to send mail.
4. Enter registered name/email/mobile, press Continue, enter the emailed six-digit code and Verify. The app loads its own profile after Firebase authentication and retains the existing role/selfie navigation. Request a replacement after the resend countdown if delivery fails or the process restarts.
5. Keep `OTP_AUTH_ENABLED` unset/false and omit `EMAIL_OTP_LOGIN` for the existing no-email demo behavior. No fixed universal OTP or production bypass is provided.

An example template is in `.env.otp.example`; it contains no credentials. No changes were made to the current `.env`.

## Behavior and limits

- `POST /api/auth/email-otp/request` and `/resend` accept `{name,email,mobile,audience:"mobile"}` and return an opaque `challengeId`, expiry/cooldown and a generic response.
- `POST /api/auth/email-otp/verify` accepts `{challengeId,code}`. Only successful verification returns a Firebase custom token, carrying mobile OTP session provenance.
- Codes expire after five minutes. Five incorrect guesses lock a challenge. A newly issued challenge invalidates the previous code for the account.
- Firestore transactions enforce 60-second issuance cooldown, five sends/account/15 minutes, 30 sends/IP/15 minutes, 20 verification attempts/account/15 minutes and 60 verification attempts/IP/15 minutes. These counters work across API instances and resends.
- The code is stored as a challenge-bound HMAC. Only its delivery task holds the raw code in memory. Authentication codes never enter routine emailJobs or logs. Request responses do not wait for SMTP, so SMTP delivery timing/failures are not reported as account-existence signals.
- Delivery tasks use the existing bounded SMTP connection/socket timeouts and mark failed delivery unusable. They do not retry or survive an API restart: request a replacement. Challenges still expire, and late delivery does not revive a replaced/expired code.
- Verification transactionally consumes the challenge before token issuance. Disabled accounts and registration eligibility are rechecked. Signing failure cannot leave a reusable code. Safe request/code-verification audit events contain no code or session token.
- `applicationSettings/runtime.emailEnabled=false` blocks new issuance. Firebase session restoration checks OTP provenance/age in OTP mode; production rules enforce access independently of the UI.

## Production cutover requirements

This implementation was not deployed. A production build requires `--dart-define=APP_ENV=production --dart-define=EMAIL_OTP_LOGIN=true --dart-define=AUTH_API_URL=https://YOUR_API_HOST`. Production API OTP mode refuses the known enabled development bypass flags and requires HTTPS. Loopback-only proxy trust supports a local TLS reverse proxy; do not expose its HTTP backend publicly. This does not migrate administrator MFA.

`firebase/firestore.email-otp.rules` is the separate OTP production rules candidate. It requires the custom-auth/mobile OTP provenance and a maximum 24-hour OTP age, blocks demo/inactive registrations and disabled dashboard profiles, and denies client access to private collections. Existing active rules and `firebase.json` are unchanged, to preserve today's demo and avoid a live cutover without review. Deploy the OTP rules to an isolated staging project and validate the application there before production. Until those rules are deployed, current database rules still permit historical verified sessions: enabling a frontend flag alone is not a production migration.

Use Firestore TTL on `expiresAt` for `authChallenges`, `authOtpLimits`, `authOtpAttempts` and `authOtpVerifyLimits`. TTL is cleanup only; expiry is enforced by the service. Rotate/revoke historical sessions and retire demo identities/legacy authentication as part of a staged production migration after confirming effects on other clients. A historical development emailVerified flag is not OTP proof.

## Checks

- API OTP tests mock SMTP/Firebase and exercise expiry, replay/concurrent use, wrong guesses, cooldown/resend, issuance limits, missing/disabled users, SMTP/signing failure and disabled endpoints.
- Flutter widget tests exercise verification before role navigation, wrong-code denial and the unchanged no-email demo flow. No real email is sent by tests.
- `firebase emulators:exec --only firestore --project demo-cone-otp --config firebase.otp-test.json "node tests/otp-rules.mjs"` validates session provenance, expiry, audience and private data access against a local demo project. The test refuses a non-loopback Firestore emulator address.
- Build, Flutter analysis and the existing application/browser tests remain the regression checks. Any emulator prerequisite failure is recorded in the final handoff rather than treated as a passing rules test.

## Local validation result

The Firestore/Auth emulator workflow passed using Android Studio's bundled Java 21 runtime. If the system Java is 17, run in PowerShell before `npm run test:otp-emulators`:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:Path = $env:JAVA_HOME + '\bin;' + $env:Path
npm run test:otp-emulators
```

This changes only that terminal's Java selection. The emulator command uses the isolated `demo-cone-otp` project and a loopback SMTP sink. It checks request/delivery, incorrect code, valid code, replay rejection, Firebase token exchange, protected profile access and rejection of mobile tokens by the administrator API. Production rules/providers remain undeployed.

The delivery task assumes the persistent Node/VPS API process remains running after the response. A serverless environment that suspends work after returning a response needs a dedicated authentication delivery task mechanism before using this deployment model. Resending replaces a challenge after a process restart; no reusable code or unverified session is restored.
