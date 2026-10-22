export type JobData = Record<string, any>;
export type QueueDocument = { id: string; ref: any; data(): JobData };

export function nextDue(jobs: JobData[], now = Date.now()) {
  let due: number | null = null;
  for (const job of jobs) {
    if (!["queued", "retry", "processing"].includes(job.status)) continue;
    // A reclaimed retry must satisfy both its retry time and its lease.
    const times = [
      job.nextAttemptAt,
      ...(job.status === "processing" ? [job.leaseUntil] : []),
    ];
    const at = Math.max(
      now,
      ...times.map((v) => Date.parse(String(v))).filter(Number.isFinite),
    );
    due = due === null ? at : Math.min(due, at);
  }
  return due === null ? null : Math.max(0, due - now);
}

export function retryDelay(
  failures: number,
  quota: boolean,
  random = Math.random,
) {
  const base = quota ? 300000 : 15000;
  return (
    Math.min(3600000, base * 2 ** Math.min(failures, 8)) +
    Math.floor(random() * base * 0.2)
  );
}

// Snapshot notifications are signals, not instructions to poll. Remember the
// exact revision already considered; our own writes cannot schedule it again.
export class QueueSchedule {
  private documents = new Map<string, QueueDocument>();
  private handled = new Map<string, string>();
  replace(documents: QueueDocument[]) {
    this.documents = new Map(documents.map((d) => [d.id, d]));
    for (const id of this.handled.keys())
      if (!this.documents.has(id)) this.handled.delete(id);
  }
  private revision(d: QueueDocument) {
    return JSON.stringify(d.data());
  }
  due(now = Date.now()) {
    return [...this.documents.values()]
      .filter(
        (d) =>
          this.handled.get(d.id) !== this.revision(d) &&
          nextDue([d.data()], now) === 0,
      )
      .sort((a, b) =>
        String(a.data().createdAt ?? a.id).localeCompare(
          String(b.data().createdAt ?? b.id),
        ),
      )
      .slice(0, 50);
  }
  delay(now = Date.now()) {
    return nextDue(
      [...this.documents.values()]
        .filter((d) => this.handled.get(d.id) !== this.revision(d))
        .map((d) => d.data()),
      now,
    );
  }
  considered(d: QueueDocument) {
    this.handled.set(d.id, this.revision(d));
  }
  retry(d: QueueDocument) {
    this.handled.delete(d.id);
  }
  // Use a fresh transactional observation after losing a claim. Leased jobs
  // are scheduled at lease expiry instead of repeatedly querying every 30s.
  observed(d: QueueDocument, data: JobData | null) {
    const current = this.documents.get(d.id);
    if (!current || this.revision(current) !== this.revision(d)) return;
    if (!data || !["queued", "retry", "processing"].includes(data.status))
      this.documents.delete(d.id);
    else {
      this.documents.set(d.id, { ...d, data: () => data });
      this.handled.delete(d.id);
    }
  }
}
