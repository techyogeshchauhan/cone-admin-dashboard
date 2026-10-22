# Admin Dashboard Firebase quota remediation

**Scope:** Admin Dashboard and its backend only.<br>
**Date:** 22 October 2026, Asia/Kolkata.<br>
**Repository:** cone-admin-dashboard, feature/sign-in-conference-branding.<br>
**Status:** Local implementation and validation complete; production verification remains limited by access. No commit, push, deployment, infrastructure change or production test/seed execution.

This supersedes the implementation recommendations and estimates in [the supplied audit](firebase_usage_audit_report.md). Previous out-of-scope agent changes were undone: the separate Cone repository is clean, and existing security-rule and systemd-service files have no diff. No application permissions, authentication policy, financial calculations or required audit logging were removed.

## Confirmed causes and implementation

### Email worker

The previous worker held an active-queue snapshot but queried the first 50 active jobs again on every tick. It read runtime configuration before the batch and again inside each claim. A due job outside a first batch of future retries/leased jobs could leave the selected batch unclaimable and repeat the scan every 30 seconds. Snapshot notifications could also interrupt waits. Separate workers registered independent listeners and competed for claims. The old default npm run dev started a worker automatically.

Implemented behavior:

- Schedule from snapshot documents; remove the second collection query and 30-second fallback. Select due work in memory, including jobs beyond the old first-50 boundary.
- Suppress previously considered snapshot revisions. Reconcile lost claims with fresh transactional state and schedule retry/lease deadlines rather than repeatedly re-reading them.
- Observe runtime settings with a listener. Keep the authoritative email-enabled check inside each job transaction. Preserve enable notifications arriving during a disabled claim.
- Use a global transactional leader lease. One leader consumes the queue; standbys register no queue/runtime listeners and retry election every five minutes. Claims verify ownership. Arbitration uses Firestore read time.
- Use exponential quota/network backoff with jitter and an absolute retry deadline that snapshots cannot shorten. Unsubscribe errored listeners before replacement; back off startup and lease-renewal failures too.
- Load SMTP configuration once per message for both transport and sender. Preserve delivery templates, stable message IDs, five-attempt limit and existing delivery retry schedule.
- Start only API/Vite through npm run dev. Worker startup requires an explicit npm run worker or npm run dev:with-worker.

An SMTP success followed by a failed Firestore status update is no longer immediately classified as an SMTP send failure. Delivery retains its existing at-least-once recovery limitation. A global lease adds a small, explicit maintenance cost described below.

### Dashboard overview

The prior overview projected registration fields but returned every people document. Projections reduce bytes, not the number of returned documents. All registration totals, confirmed totals and six role counts now use count aggregations in one read-only transaction.

The implementation preserves legacy missing fields: total minus archived minus demo plus their overlap. This avoids dropping records whose archivedAt or isDemo field is absent. Presenters reuses its role count. There are 32 count queries for the complete registration summary, not one query for the whole dashboard. Seven dashboard aggregation index definitions are supplied.

Fee rows still feed the existing JavaScript amount calculation, including numeric coercion and received-status filtering. Replacing this with a numeric-only sum could change historical financial totals; it was deliberately retained. Meal counts were already aggregated. Recent imports remain limited to five. Role-specific fields and permission-scoped cache keys are preserved and tested.

Recent activity is loaded from the existing local audit log outside the metrics cache, so an unrelated audit event no longer evicts expensive database metrics.

### API caching and other endpoints reviewed

Caches now have dependency tags rather than all being flushed after any administrative mutation. Participant/fee/redemption writes invalidate metrics; user/role changes invalidate sessions; settings/runtime, branding and conference changes invalidate their own dependencies. Dashboard user changes also invalidate metrics because they can create a linked person. Background import completion clears affected caches after processing, including partial failure.

Inspection only parses an uploaded workbook and now invalidates nothing. Preview creates an import job and invalidates overview data, without evicting sessions. Committed imports can invalidate sessions. Media, venues, email queue and pass operations retain unrelated caches. SMTP changes do not invalidate branding or authentication gates.

Existing thirty-second successful cache TTL, token-expiry limits, authentication, authorization and verifyIdToken(token, true) revocation checks are retained. Concurrent requests share pending work. Quota failures back off per cache key/process for 60 seconds and network failures for 5 seconds; auth/permission refusals are never cached. Outage responses include Retry-After. Error code 8 no longer asserts that a specific daily Spark quota is necessarily the exhausted limit.

Other reviewed paths:

| Endpoint/work | Current behavior and decision |
|---|---|
| /api/records/:module and /api/email/jobs | Existing bounded cursor reads/projections retained. Filtering can require more scanned records than displayed rows. |
| /api/control/jobs | Bounded to 50 email jobs and 50 import jobs; each refresh can still read up to 100 documents. Not an autonomous polling daemon. |
| /api/control/system | Already uses four count aggregations. |
| Workbook status | One job read per request; UI polls every 2.5 seconds only during a running import. No extra persistent scheduler introduced. |
| Workbook report and participant export | Explicit report/export requests intentionally read matching records. They remain potentially expensive; no silent export truncation added. |
| /api/profile | Existing fresh registration/eligibility checks retained. |
| /api/system-health | Existing live Firebase checks retained; cache counters added without extra database reads. Use /api/health for frequent liveness checks. |
| Department records | Uses the local source snapshot; common authentication/runtime gates still apply. |

The alleged redundant Firestore auditLogs writes were not equivalent duplicates of local logging. OTP, branding and completed user-deletion security events remain transactional. Regression tests explicitly assert these records. Provisioning/setup scripts were not run and their audit writes were not removed. Security rules were not changed.

## Actual usage evidence versus estimates

- The local dashboard runtime log contains three Firebase failures with gRPC code 8 / RESOURCE_EXHAUSTED. These confirm exhaustion responses, not which daily/rate quota or which endpoint caused the day's total.
- A read-only Cloud Monitoring request was attempted on **22 October at 17:42:56 IST**, for the preceding 48 hours of firestore.googleapis.com/document/read_ops_count. The existing credential returned **HTTP 403 PERMISSION_DENIED**. No successful usage series was retrieved; no IAM permissions were changed.
- No Firestore production document query, SMTP message or production test/seed/backfill was used for this verification. The monitoring probe used the Monitoring API, not a Firestore client.
- Project-wide usage would still not by itself attribute reads to individual dashboard routes or hosts. That requires correlating timestamps with request/job telemetry.

The metric records document-read operations; availability and interpretation are documented in [Google Cloud's Firestore metrics reference](https://docs.cloud.google.com/monitoring/api/metrics_gcp_d_h#firestore). Neither billing plan nor an exact exhausted quota was established here.

## Before/after read estimates

Let Q be jobs returned by an old tick, C be attempted messages, F be fee documents and I be recent imports. Estimates exclude reconnects, transaction retries and extra index work. Count queries scan indexes; the one-read-per-count example below assumes each scans at most 1,000 entries. [Firestore aggregation pricing](https://firebase.google.com/docs/firestore/pricing#aggregation_queries)

| Optimization | Before | After | Expected effect |
|---|---|---|---|
| Redundant batch reads | 1 runtime + Q queue documents/tick | 0 of these reads | Saves 1 + Q per dispatch |
| Fresh claim authorization | 2 reads/job: job and runtime | 3 reads/job: job, runtime, leader | Adds 1 ownership read to prevent duplicate active consumers |
| SMTP configuration | 2 reads/message | 1 read/message | Offsets the extra ownership read |
| Fifty due messages | About 251: 1 + 50 + 100 transaction + 100 SMTP | About 200: 150 transaction + 50 SMTP | 51 fewer reads, about 20%, before listener/branding/heartbeat costs |
| First 50 unclaimable, another job due beyond them | Up to 151 reads/tick, possibly every 30 seconds | No repeat queue query; select due work directly | Removes the starvation scan trap |
| Empty worker queue | Old idle listener had no steady polling reads | About 288 leader reads and 288 writes/day, plus startup/shutdown | Explicit singleton reliability overhead; not a claimed idle saving |
| Additional worker | Another active queue listener and competing transactions | One election attempt/5 minutes; no queue/runtime listener | About 288 election reads/day per standby; removes duplicated active consumption |
| Full registration overview, illustrative N=216 | 216 document reads | About 32 count reads | About 85% fewer registration metric reads |
| Whole overview | 216 + F + I + existing meal aggregation | 32 + F + I + existing meal aggregation | Fee calculations preserved; I <= 5; auth/gates separate |
| Unrelated update before cache TTL expires | Session/gate reload up to 4 reads, branding 2, plus metrics reload | Unrelated cache entries retained | Eliminates mutation-induced misses, not natural expiry |
| Inspection / preview | Previously evicted sessions and metrics | Inspect: neither; preview: metrics only | Avoids access revalidation triggered by read-only inspection/job preview |
| R repeated quota-failing cached loads | Up to R Firebase attempts | One load/cache key/process/backoff window | Suppresses error storms without bypassing authentication |
| Required audit writes | Existing security history | Retained | No claimed write savings |

The figure 216 comes from the supplied audit and is illustrative, not a refreshed production record count. The original assertion that any single stuck job costs 51 reads every 30 seconds was not generally true: future retries/live leases already slept until due. The expensive repeated-query scenario required due work remaining outside a selected unclaimable batch. Auth revocation checks are Auth traffic, not Firestore document reads.

## Dashboard process inventory

The local configuration explicitly has APP_ENV=development and FIREBASE_PROJECT_ID=conferencemanagement-239a3. No Firestore emulator setting or cache override was present in the inspected local .env. Thus a normally launched dashboard API/worker uses the production project; development naming does not isolate it.

| Surface | Evidence/status |
|---|---|
| Earlier local dashboard worker | PID 27128 under watcher 6608 at the previous fresh snapshot. An earlier audit also observed PID 28564; it was already absent at that snapshot. |
| Earlier API/development stack | API 21288, watcher 19736, npm/concurrently 28916/15204. Vite 8696/32152/22532/15728. Scoped local dev processes were stopped before the previous implementation to avoid auto-reloading against production. |
| Scope-correction fresh check | No matching live dashboard API/worker/Vite watch process. No process was stopped/restarted in this correction. |
| Windows tasks and services | Fresh query: zero matching scheduled-task actions and zero matching service executable paths. |
| Checked-in runtime definitions | Separate cone-api and cone-worker services. Their installed remote state is not established by the source files. Existing service definitions are unchanged. |
| Production VPS | User-provided host 187.127.178.185 was reachable, but root SSH authentication failed: Permission denied (publickey,password). Remote worker/cron/timer state remains unverified; no remote command or service change was performed. |

The persistent backend job is email delivery. Workbook imports run after an explicit commit request, within the API process. Analyze/provision/bootstrap/backfill scripts are explicit commands, not confirmed running scheduled jobs. Open dashboard tabs make periodic session/settings and branding requests; frontend servers alone do not create Firestore reads without clients.

Manual read-only VPS commands and monitoring guidance are in [WORKER_OPERATIONS.md](docs/WORKER_OPERATIONS.md). Cloud Scheduler/other infrastructure inventory is still required if those services are configured for this dashboard; no claim is made that every production producer is identified.

## Changed dashboard/backend files

| Area | Files |
|---|---|
| Worker | server/worker.ts; new server/worker-queue.ts and server/worker-lease.ts; server/mail.ts; package.json |
| API, counts, caching and diagnostics | server/index.ts; server/request-cache.ts; new server/cache-policy.ts and server/overview-counts.ts; server/branding.ts; server/email-branding.ts; server/firebase-errors.ts |
| Isolated validation and indexes | New firebase.quota-test.json and firebase/firestore.indexes.json; new tests/quota-integration.ts |
| New unit suites | tests/cache-policy.test.ts; tests/overview-counts.test.ts; tests/worker-queue.test.ts; tests/worker-runtime.test.ts |
| Updated regression suites/helpers | tests/api.test.ts; tests/branding-api.test.ts; tests/delete-user.test.ts; tests/dev-role-login.test.ts; tests/email-otp.test.ts; tests/fake-firestore.ts; tests/list-api.test.ts; tests/request-cache.test.ts; tests/worker.test.ts |
| Documentation | firebase_quota_remediation_report.md; docs/WORKER_OPERATIONS.md |

Scope checks: Cone status is clean; no security-rule diff; no deploy-service diff; no backend test references the separate repository. Pre-existing unrelated deleted/moved documents and images in the dashboard worktree were preserved. Local ignored backup and monitoring evidence files are not release files.

## Validation

- **npm test: 291 tests passed, 34 suites.** Covers scheduling, stale snapshots, lease deadlines, feedback/backoff, runtime enable races, duplicate-worker exclusion, scoped invalidation including imports, financial totals, role data boundaries, token revocation and required audit history.
- **npm run build: passed.** TypeScript, dashboard Vite build and server compilation. Dependency annotation warnings only.
- **npm run test:quota-emulator: passed.** Real Firestore SDK checks for read-only aggregation behavior and concurrent leader acquisition, renewal, expiry, fencing and safe release. Localhost, demo-cone-quota, emulator 1.22.0 / Java 21 only. No production rule, data or service modifications.
- **git diff --check: passed.** Final repository boundary checks verify that release changes are dashboard/backend only.

## Deployment prerequisites and remaining risks

1. Obtain read-only Monitoring access for the existing operator/credential, or export usage through the authorized console. Check read_ops_count, API quota errors, timestamps and dashboard traffic before assigning daily totals to routes. No access grant was made here.
2. Authenticate the VPS read-only inventory. Identify all worker versions, cron entries, timers, process managers and hosts targeting the project. Existing old workers ignore the new leader lock; an approved rollout must stop/migrate old implementations before starting the new one.
3. Review and merge the seven overview index definitions with existing indexes. Provision only reviewed indexes and wait for readiness before releasing aggregation code. The emulator does not prove production index readiness. Do not deploy or alter security rules as part of this optimization.
4. Validate legacy boolean isDemo and nullable ISO-string archivedAt contracts in a staging copy. No production normalization/backfill was run. Fee sums intentionally retain existing semantics.
5. Caches and counters are per API process; external writers become visible after the existing TTL. Native SDK retries, reconnections, restarts, explicit exports/reports and fee scans can add reads beyond estimates.
6. The leader lease has a ten-minute TTL and five-minute election/renewal interval. Ungraceful takeover can take roughly fifteen minutes; graceful shutdown releases earlier. SMTP remains at least once. The global lease's steady read/write overhead must be included in the post-release comparison.
7. Use worker JSON events and existing protected system-health cache counters. Frequent liveness checks should use /api/health, which does not query Firebase. No cloud alert policy was created or infrastructure changed.

## Recommended deployment and rollback

**Deploy only after approval:** capture the currently running release, environment and worker inventory; verify index readiness; run the same checks in an isolated staging project; then replace the API/worker release during a coordinated window. Keep default development startup worker-free. Verify role-specific overview responses, unchanged fee totals and audit history, one active leader, queue progress and measured read rates. No production seed/test execution is needed for that validation.

**Rollback only after approval:** stop the new worker gracefully and verify its lease is released (or wait for expiry); restore the previously captured API and worker artifacts together. Start only one old worker because old code ignores the leader lock. Retain compatible added indexes during rollback; do not delete business records, audit history or an active worker's lock. No data migration or rule rollback is required by these changes. Restore deployment configuration from the captured release rather than resetting the dirty local repository.
