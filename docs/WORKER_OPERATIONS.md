# Admin Dashboard worker operations

Updated 22 October 2026. Local changes have not been deployed. This guide covers the dashboard/backend only; existing authentication, security rules and production service definitions are unchanged.

## Startup

- npm run dev: API and Vite only.
- npm run worker: explicit development email worker.
- npm run dev:with-worker: opt in to API/frontend/worker together.
- npm run worker:production: compiled worker under the existing supervisor.

Older README copies describe the previous automatic-worker startup. package.json and this guide describe the corrected behavior. Development processes still use whatever Firebase project their environment configures; APP_ENV=development alone is not an emulator or isolated database.

One active worker owns applicationLocks/emailWorker for ten minutes and renews every five minutes. Standbys do not listen to the queue/runtime and retry election every five minutes. Claims recheck leader ownership and the email-enabled switch transactionally. A global lease costs approximately 288 reads and 288 writes/day for a continuously running leader, plus startup/shutdown/retries; each continuous standby makes about 288 election reads/day. Takeover after an ungraceful crash can take approximately fifteen minutes.

## Read-only production inventory

Connect through your authorized SSH setup:

```bash
ssh root@187.127.178.185
```

Run on the VPS:

```bash
date -Is
systemctl show cone-api cone-worker \
  -p Id -p ActiveState -p SubState -p MainPID -p ExecMainStartTimestamp -p FragmentPath
ps -eo pid,ppid,lstart,args | grep -E 'server/(worker|index)|tsx|vite|concurrently|pm2' | grep -v grep
systemctl list-timers --all --no-pager
crontab -l
crontab -u cone -l
grep -RInE 'cone|firebase|worker|npm|node|conferencemanagement' \
  /etc/crontab /etc/cron.d /etc/cron.daily /etc/cron.hourly \
  /etc/cron.weekly /etc/cron.monthly /var/spool/cron 2>/dev/null
grep -E '^(FIREBASE_PROJECT_ID|APP_ENV|FIRESTORE_EMULATOR_HOST|API_CACHE_MS)=' /var/www/cone/.env
journalctl -u cone-api -u cone-worker --since '24 hours ago' --no-pager \
  | grep -Ei 'quota|resource_exhausted|email_worker|queue unavailable|retry'
```

These commands do not stop, restart or deploy services. No crontab for an account does not exclude system cron or systemd timers. Inspect matching commands and process working directories before attributing Firebase traffic. Redact credentials or participant information from shared cron/log output; never share complete .env files, private keys or tokens.

## Usage and monitoring

The attempted Monitoring API read returned 403 PERMISSION_DENIED; direct production totals were not retrieved. An authorized operator should inspect the project's Firestore Usage view and Cloud Monitoring document/read_ops_count plus API errors, using the same time window as dashboard request/worker activity. Project aggregates cannot automatically identify a particular route or host. No IAM or alert policy was changed.

Worker events: email_worker_started, email_worker_duplicate, email_worker_metrics, email_worker_backoff, email_worker_renewal_backoff and email_worker_startup_backoff. Metrics include active queue size, snapshots, candidates, attempts, failures and renewals without recipient/body data. They are application counters, not billing totals.

The existing permission-protected /api/system-health includes cache counters and still performs live Firebase checks. Use /api/health for frequent liveness probes. Investigate sustained backoff, repeated restarts, queue growth without progress, or multiple active leaders.

## Isolated validation

```text
npm test
npm run build
npm run test:quota-emulator
git diff --check
```

The emulator requires Java 21+, targets demo-cone-quota on localhost and rejects non-local Firestore endpoints before constructing a client. It verifies backend aggregations and leader transactions. Existing rules are only loaded into the local emulator unchanged; no rule deployment occurs. Never run bootstrap, provision, seed, analyze or backfill commands as production quota tests.

## Approval-gated release

1. Capture current artifacts/configuration and inventory every old worker. Old implementations ignore the new leader lock.
2. Merge/review the seven overview composite indexes, provision approved indexes only, and wait for readiness. Preserve all existing security rules.
3. Validate legacy isDemo/archivedAt types and existing fee totals on a staging copy. No production migration is included.
4. After deployment approval, coordinate replacement of API and worker. Confirm one leader, queue progress, unchanged authorized responses and actual read trends.
5. If rollback is approved, gracefully stop the new worker, restore the captured API/worker artifacts together and run one old worker. Keep compatible indexes, required audit history and business records. Do not delete an active leader's lock to force a takeover.

No deployment, remote restart, service-unit installation or rollback has been performed.
