# Admin Dashboard Firebase optimization: deployment readiness review

Reviewed 22 October 2026. Scope: `cone-admin-dashboard` and its backend only.

**Decision: local checks pass; production deployment remains blocked.** Production index metadata was retrieved read-only. Usage metrics returned 403. Remote process inventory and staging validation remain incomplete. This review does not establish that production quota exhaustion has been resolved.

At review completion, no commit, push, deployment, IAM change, production document query/test/seed, or production service modification had been performed. This review added documentation and sanitized index evidence; it did not change runtime code. See [the implementation report](../firebase_quota_remediation_report.md) for the preceding implementation.

Publication follow-up: the user subsequently authorized committing and pushing all pending dashboard changes. This includes the existing documentation/asset moves into `docs/`, the supplied audit report, and the existing Firebase web SDK update to `^12.19.0` with its lockfile. The participant workbook remains excluded, including its copy under `docs/`. This Git publication authorization does not approve production deployment, IAM changes, index provisioning, or service changes. The deployment blockers below remain in effect.

## 1. Change and preservation review

The following implementation files were reviewed against Git HEAD, including the new helpers and tests:

| Area                                     | Files                                                                                                                                                                                                                                                 |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Worker and mail                          | `server/worker.ts`, `server/worker-queue.ts`, `server/worker-lease.ts`, `server/mail.ts`, `package.json`                                                                                                                                              |
| API and caching                          | `server/index.ts`, `server/request-cache.ts`, `server/cache-policy.ts`, `server/overview-counts.ts`, `server/branding.ts`, `server/email-branding.ts`, `server/firebase-errors.ts`                                                                    |
| Updated tests                            | `tests/api.test.ts`, `tests/branding-api.test.ts`, `tests/delete-user.test.ts`, `tests/dev-role-login.test.ts`, `tests/email-otp.test.ts`, `tests/fake-firestore.ts`, `tests/list-api.test.ts`, `tests/request-cache.test.ts`, `tests/worker.test.ts` |
| New validation                           | `tests/cache-policy.test.ts`, `tests/overview-counts.test.ts`, `tests/worker-queue.test.ts`, `tests/worker-runtime.test.ts`, `tests/quota-integration.ts`, `firebase.quota-test.json`                                                                 |
| Indexes and implementation documentation | `firebase/firestore.indexes.json`, `firebase_quota_remediation_report.md`, `docs/WORKER_OPERATIONS.md`                                                                                                                                                |
| This review                              | `docs/FIREBASE_DEPLOYMENT_READINESS.md`, `docs/firebase-index-review.json`                                                                                                                                                                            |

Existing unrelated dirty work includes deleted root documentation, `.env.example`, `.env.otp.example`, the two root PNGs, moved/untracked documentation under `docs/`, and the supplied `firebase_usage_audit_report.md`. These were preserved and are outside the release manifest. Do not use `git add .` or a whole-worktree release. The review-start SHA-256 manifest covers 178 non-ignored existing files/missing-file markers; the final comparison confirmed all 178 inputs unchanged. This verifies preservation during this review, not historical authorship of every prior change.

The separate `Cone` repository has a clean Git status. Its source was not analyzed or modified. Existing `firebase/*.rules`, `deploy/`, permission definitions, authentication implementation, and audit implementation have no optimization diff. The optimization review did not include dependency changes; the later publication also includes the existing SDK/lockfile update described above.

### Findings requiring release attention

1. **Index rollout is not ready.** None of the seven proposed `people` definitions exists as an exact production composite index. The candidate file omits all nine existing production indexes. Preserve those definitions; do not deploy this file as a complete replacement or approve deletion prompts.
2. **Registration parity is conditional on stored types.** `server/overview-counts.ts` subtracts boolean `isDemo == true` and nonempty string `archivedAt`. The former code used JavaScript truthiness. For example, a legacy `isDemo: "false"` would previously be excluded but can now be counted. No such production record has been observed; no production data scan was performed. Validate an authorized sanitized staging dataset, including malformed legacy types. Any normalization or behavior change requires separate review/approval.
3. **Worker leadership changes availability and cost.** A ten-minute lease with five-minute election checks can delay crash takeover by roughly fifteen minutes. The leader adds about 288 reads and 288 writes/day; each standby adds about 288 election reads/day. Idle workloads can cost more. Accept this recovery time and measure net savings before approving rollout.
4. **Old and new workers must not overlap.** Older workers ignore the global leader lease. Inventory every dashboard producer and coordinate their replacement during an approved window.
5. **Production observability is incomplete.** Monitoring access is denied; VPS SSH authentication was previously denied. No endpoint-level share of actual production usage is established.

## 2. Seven-index comparison with production

At **2026-10-22T12:32:06Z (18:02:06 IST)**, an authenticated GET to the following metadata endpoint succeeded. All pages were consumed; no next-page token remained:

```text
GET https://firestore.googleapis.com/v1/projects/conferencemanagement-239a3/databases/(default)/collectionGroups/-/indexes
```

The result contains nine composite indexes across other collection groups and zero `people` composite indexes. The comparison uses collection group, query scope, ordered fields and directions, excluding the implicit `__name__` suffix. The [sanitized evidence](firebase-index-review.json) records actual index IDs/states and all seven comparison results. No production documents were fetched.

All proposed definitions target `people`, scope `COLLECTION`; every listed field direction is `ASCENDING`:

| #   | Ordered fields                               | Production exact match | Query family                            |
| --- | -------------------------------------------- | ---------------------- | --------------------------------------- |
| 1   | `isDemo`, `archivedAt`                       | None                   | Demo/archive overlap, all registrations |
| 2   | `role`, `archivedAt`                         | None                   | Archived records within each role       |
| 3   | `registrationStatus`, `archivedAt`           | None                   | Archived confirmed records              |
| 4   | `role`, `isDemo`                             | None                   | Demo records within each role           |
| 5   | `registrationStatus`, `isDemo`               | None                   | Demo confirmed records                  |
| 6   | `role`, `isDemo`, `archivedAt`               | None                   | Role + demo/archive overlap             |
| 7   | `registrationStatus`, `isDemo`, `archivedAt` | None                   | Confirmed + demo/archive overlap        |

Existing production indexes, all `READY` and scope `COLLECTION`:

| Collection group     | Explicit fields and directions                      |
| -------------------- | --------------------------------------------------- |
| `correctionRequests` | `status ASC`, `createdAt DESC`                      |
| `auditLogs`          | `action ASC`, `at DESC`                             |
| `sessions`           | `published ASC`, `startsAt ASC`                     |
| `claimRequests`      | `status ASC`, `createdAt DESC`                      |
| `passes`             | `ownerUid ASC`, `status ASC`                        |
| `userRoles`          | `roles CONTAINS`, `active ASC`                      |
| `scanEvents`         | `staffUid ASC`, `at DESC`                           |
| `claimRequests`      | `uid ASC`, `status ASC`                             |
| `announcements`      | `published ASC`, `audience ASC`, `publishedAt DESC` |

An absent exact composite does not prove a query fails. Equality-only candidates #4/#5 may use index merging. Field overrides/single-field exemptions were not inventoried. Before release, inspect them and validate all 32 aggregation query shapes against real staging Firestore with equivalent index configuration; capture the selected plans and costs using Query Explain where supported, plus actual aggregate execution in a read-only transaction. The local emulator does not enforce production index requirements. Prepare an additive index plan preserving the nine existing definitions; obtain approval, create only required indexes, wait for `READY`, and refresh this comparison immediately before deployment. No index was created or deleted here. See [index merging](https://firebase.google.com/docs/firestore/query-data/index-overview#use_index_merging) and the [index list API](https://docs.cloud.google.com/firestore/docs/reference/rest/v1/projects.databases.collectionGroups.indexes/list).

## 3. Exact read-only Monitoring access

The existing credential's `projects.timeSeries.list` probe for the production project returned **403 PERMISSION_DENIED** with the generic message “Permission denied (or the resource may not exist).” The denial does not identify a particular missing binding or exclude an IAM deny policy, scope, or resource mismatch. No usage series was obtained.

| Purpose                                      | Required permission/access                                                                                                                             |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Read known metric time series                | `monitoring.timeSeries.list` on `conferencemanagement-239a3` for the direct project request                                                            |
| Discover/read metric descriptors             | `monitoring.metricDescriptors.list`, `monitoring.metricDescriptors.get`                                                                                |
| Discover/read monitored-resource descriptors | `monitoring.monitoredResourceDescriptors.list`, `monitoring.monitoredResourceDescriptors.get`                                                          |
| Console project navigation                   | `resourcemanager.projects.get`, `resourcemanager.projects.list`, as provided by the viewer role                                                        |
| Suitable predefined read-only role           | `roles/monitoring.viewer` at the project; if using a different metrics-scope project, verify access on that scoping project                            |
| REST OAuth scope                             | `https://www.googleapis.com/auth/monitoring.read`; the existing probe used accepted `cloud-platform` scope. OAuth scope does not grant IAM permission. |

These are metrics-reading permissions; Monitoring Admin, Owner, Editor, metric-writing, index-administration, and business-document access are unnecessary for this direct metrics request. `roles/monitoring.metricWriter` does not grant time-series reading. An authorized owner must verify the intended principal/project and API availability or supply an export from an already authorized account. Any IAM/API-enablement action remains separately approval-gated. [Monitoring roles](https://docs.cloud.google.com/iam/docs/roles-permissions/monitoring), [time-series REST API and scopes](https://docs.cloud.google.com/monitoring/api/ref_v3/rest/v3/projects.timeSeries/list).

Index metadata access is separate. Current Firestore IAM documentation names `datastore.schemas.list/get` for index list/get (legacy `datastore.indexes.*` names remain aliases). No new permission was needed for the successful metadata probe. [Firestore IAM reference](https://docs.cloud.google.com/firestore/native/docs/security/iam).

## 4. Read-only production inventory checklist

The VPS is `root@187.127.178.185`. Previous noninteractive SSH authentication failed. An authorized operator can run the following manually after SSH access is available. None of these commands stops, restarts, enables, disables, schedules, or runs a job. Inspect locally and redact credentials, tokens and personal data before sharing command lines, cron contents or logs.

```bash
ssh -o BatchMode=yes -o StrictHostKeyChecking=yes root@187.127.178.185
date -u
hostname
ps -eo user,pid,ppid,lstart,args --sort=pid
systemctl list-units --type=service --all --no-pager
systemctl list-unit-files --type=service --no-pager
systemctl list-timers --all --no-pager
systemctl show cone-api.service cone-worker.service \
  -p Id -p ActiveState -p SubState -p MainPID -p User -p WorkingDirectory \
  -p ExecStart -p EnvironmentFiles -p FragmentPath -p Restart -p RestartUSec
journalctl -u cone-worker.service --since '24 hours ago' --no-pager \
  | grep -E 'email_worker_|RESOURCE_EXHAUSTED|quota|WORKER_LEASE_LOST'
getent passwd | cut -d: -f1
```

For each relevant account from that list, run `crontab -u ACCOUNT -l`. Inspect `/etc/crontab`, `/etc/cron.d/`, periodic cron directories and the service units activated by relevant timers for dashboard paths, npm/node/tsx commands and project references. Example discovery, if ripgrep is installed:

```bash
rg -n -i 'cone|conference|worker|tsx|node|firebase|187\.127\.178\.185' \
  /etc/crontab /etc/cron.d /etc/cron.hourly /etc/cron.daily /etc/cron.weekly /etc/cron.monthly
```

For each actual dashboard PID, inspect `/proc/PID/cwd`, `/proc/PID/exe`, its parent tree and only these environment keys: `FIREBASE_PROJECT_ID`, `GCLOUD_PROJECT`, `GOOGLE_CLOUD_PROJECT`, `FIRESTORE_EMULATOR_HOST`, `APP_ENV`, `NODE_ENV`, `API_CACHE_MS`, `GOOGLE_APPLICATION_CREDENTIALS` (path only). Do not dump all environment variables or credential JSON. Environment files may be loaded by dotenv rather than inherited; inspect only allowlisted project keys from the resolved working directory/environment file. Confirm the effective credential project without printing private keys. A development process targeting the production project still consumes production usage.

- [ ] Map PID -> owner -> supervisor/parent -> checkout/build version -> effective Firebase project/database -> API/worker/import responsibility.
- [ ] Include running and disabled installed services/timers, all relevant users' crons, watch processes, npm/concurrently children, and other dashboard hosts/CI jobs. A checked-in unit file is not evidence of its installed state.
- [ ] Identify existing PM2 daemons from process inventory and their owner/home. Inspect already available process-manager metadata through an existing session. Do not run an unguarded PM2 CLI command that might start a new daemon. Check containers with `docker ps --no-trunc` only if Docker is already installed/running; inspect only selected command/label fields, not secret-bearing environment dumps.
- [ ] If Cloud Scheduler is configured, list jobs for each known dashboard region using `gcloud scheduler jobs list --project=conferencemanagement-239a3 --location=REGION`. Inspect target identity/URL/topic and schedule; do not run, resume, update or delete jobs. List associated Cloud Run/Functions services read-only only if this dashboard uses them. Do not infer their absence from VPS inventory.
- [ ] Record every old worker version, duplicate consumer and explicit provision/bootstrap/analyze/backfill invocation. Do not execute those scripts to test access.
- [ ] Record worker log starts, standby elections, renewals, failures, restarts and queue progress, with UTC timestamps. Counters are process-local and reset on restart; do not add successive cumulative samples as independent events.

No remote commands from this checklist were executed in this review. Earlier local inventory found no remaining dashboard API/worker/watch processes and no matching Windows task/service actions; recheck all developer machines before release. Use `/api/health` for frequent liveness checks. `/api/system-health` is protected and performs existing live checks; polling it frequently can itself add reads.

## 5. Staging validation gate

Staging has not been executed on a separate cloud project. First prepare an explicitly approved isolated Firebase project and separate credentials. Align backend project, frontend Firebase/Auth settings, database and storage with staging. `APP_ENV=development` alone does not isolate Firebase. Use synthetic fixtures or an authorized sanitized export; never run this test plan or seed scripts against production.

- [ ] Configure an SMTP capture sink and synthetic recipients. Remove/replace staging `applicationSettings/smtp` production settings: stored settings override environment fallback, so changing `SMTP_HOST` alone is insufficient. No copied production email queue may be deliverable.
- [ ] Reproduce relevant production indexes and field overrides. Add candidate indexes in staging, wait for `READY`, then execute all 32 count shapes in the read-only transaction. Capture plans/cost where supported, cold-cache latency, errors and output.
- [ ] Compare old/new registrations, confirmed totals and every role count for missing/null/empty fields, boolean flags, overlapping demo/archive records and unexpected historical types. Any mismatch blocks release; do not silently normalize data.
- [ ] Compare fee totals/visibility using received/pending/other statuses, archived records, missing amounts and numeric strings. The existing JavaScript fee reduction remains authoritative.
- [ ] Exercise superadmin, registration manager, report-only, fee-authorized and fee-denied roles. Confirm forbidden fields stay absent, forbidden writes stay rejected, and permission-scoped cache keys never share private data.
- [ ] Exercise expired/revoked tokens, disabled users and role removal. Verify `verifyIdToken(token, true)` on uncached verification, token-expiry ceilings, immediate local session eviction after access mutations, and existing TTL behavior for external/other-instance changes. Auth errors must not be cached as successes.
- [ ] Verify participant/fee/redemption changes refresh overview; unrelated media/venue/email writes preserve metrics/session caches; access changes evict sessions; runtime/branding/conference settings refresh their dependencies; import completion evicts affected data even on partial failure.
- [ ] Use two API processes to document per-process cache behavior. There is no cross-process cache bus. Preserve the existing 30-second successful TTL; do not lengthen it to pass cost targets.
- [ ] Use two worker processes: one queue consumer, one standby without queue/runtime listeners. Validate leader expiry/renewal, graceful handover, crash takeover, expired job leases, runtime disable/enable races and no starvation behind >50 future jobs.
- [ ] Inject quota/network/listener errors only in staging/local mocks. Confirm absolute jittered backoff survives snapshot feedback, errored listeners unsubscribe, and failures recover without busy loops. Validate startup/renewal failures and Retry-After responses.
- [ ] Verify normal email rendering, stable message IDs, five-attempt limit, retry timing, and the existing at-least-once limitation after SMTP success/status-write failure. Do not claim exactly-once delivery.
- [ ] Confirm local audit persistence plus transactional OTP, branding and deletion security events, their permissions, and absence of secrets. Preserve required events and local log storage through release/rollback.
- [ ] Rerun `npm test`, `npm run build`, and the guarded `npm run test:quota-emulator`. Record artifact hashes and explicit staging project IDs. Emulator success alone is not cloud staging approval.

## 6. Read measurement and acceptance

The code-level repeated-read causes are confirmed by the old source: active-queue snapshot plus redundant GET, wakeable polling, independent worker listeners, full people scans and global mutation invalidation. Their share of production usage is unmeasured.

| Component                               | Before estimate                                      | After estimate                                                                       | Qualification                                                                                                                         |
| --------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Registration metrics on a cold overview | N people document reads                              | 32 count requests; approximately 32 billed reads if each scans <=1,000 index entries | At illustrative N=216, about 85% fewer registration-metric reads; N is not a refreshed production count                               |
| Fifty attempted messages                | About 251 reads                                      | About 200 reads                                                                      | Excludes listeners, branding, reconnects, retries and heartbeat; one new leader check/job is offset by one fewer SMTP config read/job |
| Old starvation scan                     | Up to 151 reads per repeated tick                    | No repeated queue GET for this case                                                  | Requires due work beyond an unclaimable first-50 batch; not every delayed message creates this pattern                                |
| Empty queue / standby                   | Idle old listener had no polling cost                | Leader about 288 reads + 288 writes/day; standby about 288 election reads/day each   | Reliability overhead can exceed savings on a quiet day                                                                                |
| Unrelated mutations                     | Evicted sessions/settings/metrics and caused reloads | Unrelated entries survive until existing TTL                                         | Savings depend on mutation/request mix and number of API processes                                                                    |
| Fee totals and security audit writes    | Existing scans/writes                                | Retained                                                                             | No savings claimed                                                                                                                    |

Count billing depends on scanned index entries, with a minimum charge for each aggregation; do not equate 32 returned numbers to a guaranteed fixed bill. For staging estimates use `sum(max(1, ceil(entries_scanned_for_query / 1000)))` across the 32 queries, accounting for actual plans and retries. Small datasets below roughly 32 records can cost more. [Aggregation pricing](https://firebase.google.com/docs/firestore/pricing#aggregation_queries).

Read-only comparison procedure for an authorized metrics reader:

1. Export at least one representative full-day baseline before deployment; preferably several matched business days including a busy email/import period. Record UTC start/end, release versions, database, role/request counts, queued/completed messages, exports/imports, API/worker instance counts and known other project writers. Never generate production load for this comparison.
2. Query `firestore.googleapis.com/document/read_ops_count`, resource type `firestore.googleapis.com/Database`, filtering the target database/project labels as shown in its actual descriptor. Retain QUERY and LOOKUP series. Sum DELTA points across all pages and relevant label series, using one-minute or five-minute SUM alignment; do not average counts or take a rate and call it a total. Do not add legacy `document/read_count` to the newer metric. Export raw JSON/CSV, query parameters and timestamps.
3. Also export `document/write_ops_count` and `api/request_count` grouped by method and response code. Discover actual response-code values instead of assuming Monitoring uses the worker's numeric gRPC code 8. Correlate quota/rate failures with worker/API logs, and determine which quota was exhausted. Capture Firebase Usage/quota-console evidence for the same interval; plan and daily/rate limit are not established here.
4. Follow every Monitoring `nextPageToken`. Wait at least four minutes after a window ends, then confirm the last samples are complete. Exclude deployment/restart warm-up from the steady-state comparison and report its cost separately. Align daily quota comparisons to the actual quota reset boundary (Firestore daily free quota uses Pacific time), keeping UTC exports and daylight-saving changes explicit.
5. After an approved release, repeat an equal, representative interval with the same filters. Report absolute reads/day and writes/day, peak reads/minute, quota failures, workload counts and backlog age/completion rate. Report `100 * (before_reads - after_reads) / before_reads` only when baseline >0. Also compare reads per completed email and per dashboard request; changes in role mix, cache misses, exports or queue retries must be disclosed. A project-wide ratio cannot isolate one endpoint's contribution.
6. Attribute per-endpoint costs with matched isolated staging workloads and existing request/worker telemetry. Project metrics lack dashboard-route/host attribution. Read counters in local fakes and worker snapshots are diagnostic, not billed-operation meters. Do not analyze or modify the mobile application to attribute other traffic; record unallocated project traffic as a limitation.
7. Accept production quota improvement only after complete actual metrics show sustained lower usage at comparable useful workload, errors remain controlled, fees/roles/auth/audits pass validation, and queue delay does not increase. A disabled worker, lower traffic, an empty queue or fewer successful reads during an outage is not proof of resolution. If the quota is daily, include at least a complete representative quota day after rollout and a busy period.

The metric descriptor documents 60-second sampling and up to 240-second publication lag. Query scan statistics are performance diagnostics, not a substitute for billing/usage evidence. [Firestore metrics reference](https://docs.cloud.google.com/monitoring/api/metrics_gcp_d_h#firestore).

## 7. Functionality and validation evidence

| Area                        | Confirmed locally                                                                                                                    | Remaining production/staging evidence                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Fees                        | Fee projection, archive filter, received-status filter and `Number` reduction unchanged; existing role/fee API tests pass            | Legacy amount/status parity against an authorized sanitized dataset               |
| Authentication              | Revocation-aware verification, audience checks, expiry bound and authentication implementation retained                              | Real staging revocation/disable tests; no production auth mutation test performed |
| Roles                       | Permission definitions and enforcement unchanged; effective-permission overview keys and denied-field tests pass                     | Real staging accounts/roles and multi-process expiry checks                       |
| Audit logging               | No audit writer removed; OTP, branding and deletion transaction assertions pass; local activity reading separated from metrics cache | Staging persistence and log-directory retention across release/rollback           |
| Rules/infrastructure/mobile | Existing rule/service files have no diff; separate mobile repository clean                                                           | Remote installed configuration inventory                                          |

Fresh checks on 22 October 2026: **291 tests passed in 34 suites**; **`npm run build` passed** (frontend TypeScript/Vite and server TypeScript); **`npm run test:quota-emulator` passed** against localhost/demo project, covering actual SDK aggregation and concurrent lease acquire/renew/expiry/fencing/release. `git diff --check` passed. Dependency annotation warnings during build were nonfatal. The emulator's shutdown SIGKILL notice followed successful test completion. None of these checks proves production index readiness or measured read reduction.

## 8. Approval-gated deployment and rollback plan

### Prerequisites, in order

1. An authorized operator completes the read-only inventory and records all dashboard processes/project targets. Supply SSH access or the redacted inventory output; no service change is needed for inspection.
2. An existing authorized metrics reader supplies baseline exports, or the owner approves and separately arranges the minimal Monitoring viewer access above. Recheck the direct time-series GET; a 403 is not an empty baseline.
3. Complete real staging parity, security, worker fault/recovery and index-plan validation. Resolve type mismatches and accept the worker's takeover time/heartbeat budget. Record pass/fail evidence.
4. Prepare a reviewed additive production index plan preserving all existing indexes/overrides. Obtain explicit approval for index creation, wait for `READY`, then verify metadata again. Index provisioning and application deployment are separate changes.
5. Prepare a narrow release artifact from the reviewed dashboard files, excluding unrelated dirty documentation/images, secrets, local evidence and generated emulator logs. Capture the current release artifact/version, environment paths, service configuration and durable audit-log directory securely for rollback. Do not reset the shared dirty worktree.
6. Request explicit approval for the concrete release, maintenance window, old-worker replacement and rollback plan. No commit, push or deploy is implied by completing this review.

### During an approved deployment

- [ ] Confirm baseline export is complete, indexes are `READY`, artifact hashes match and rollback artifacts are accessible.
- [ ] Gracefully replace all old dashboard worker implementations before enabling the new worker; coordinate API/worker release and verify one active leader. Existing old workers cannot be fenced by the new lock.
- [ ] Preserve runtime environment, auth/security rules, permissions and persistent audit storage. Do not run test/seed/provision/backfill scripts on production.
- [ ] Use authorized read-only role smoke checks and passive observation of normal operations for fee totals, overview fields, audits, email queue progress, errors and cache statistics. Do not create production test records or emails.
- [ ] Observe release/reconnect warm-up separately, then compare matched actual usage windows as above. Define operator-agreed error/backlog/usage rollback thresholds before the window; do not use a promised fixed percentage as a release guarantee.

### Rollback recommendation, only with approval

Gracefully stop the new worker and verify release of its ownership or wait for expiry; do not delete another live worker's lock. Restore the captured API and worker artifacts together, then run only one old worker because old code ignores the lease. Preserve compatible added indexes, all business records, security audits and local logs. No data migration or rule rollback is required by this optimization. Recheck role/fee responses, delivery progress and measured usage; rollback does not itself resolve the original quota problem.

**Outstanding blockers:** real staging results; production index provisioning/plan approval; authenticated remote inventory; actual Monitoring baseline and after-release access; acceptance of recovery time and measured net cost; explicit release approval. Production quota resolution remains unverified.
