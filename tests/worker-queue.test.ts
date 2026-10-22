import { describe, expect, it } from "vitest";
import { QueueSchedule, nextDue, retryDelay } from "../server/worker-queue.js";
const now = Date.parse("2026-10-22T10:00:00Z");
const doc = (id: string, data: Record<string, any>) => ({
  id,
  ref: { id },
  data: () => data,
});
describe("snapshot queue scheduling", () => {
  it("finds due work beyond fifty future jobs without another collection query", () => {
    const queue = new QueueSchedule();
    queue.replace([
      ...Array.from({ length: 50 }, (_, i) =>
        doc(String(i), {
          status: "retry",
          nextAttemptAt: new Date(now + 60000).toISOString(),
        }),
      ),
      doc("due", { status: "queued" }),
    ]);
    expect(queue.due(now).map((d) => d.id)).toEqual(["due"]);
  });
  it("ignores identical snapshots and own processing feedback until lease expiry", () => {
    const queue = new QueueSchedule();
    const queued = doc("a", { status: "queued" });
    queue.replace([queued]);
    queue.considered(queued);
    queue.replace([doc("a", { status: "queued" })]);
    expect(queue.due(now)).toEqual([]);
    expect(queue.delay(now)).toBeNull();
    queue.replace([
      doc("a", {
        status: "processing",
        leaseUntil: new Date(now + 120000).toISOString(),
      }),
    ]);
    expect(queue.due(now)).toEqual([]);
    expect(queue.delay(now)).toBe(120000);
    expect(queue.due(now + 120000)).toHaveLength(1);
    queue.replace([]);
    expect(queue.delay(now)).toBeNull();
  });
  it("schedules a lost transaction claim at its observed lease deadline", () => {
    const queue = new QueueSchedule();
    const queued = doc("a", { status: "queued" });
    queue.replace([queued]);
    queue.considered(queued);
    queue.observed(queued, {
      status: "processing",
      leaseUntil: new Date(now + 120000).toISOString(),
    });
    expect(queue.due(now + 30000)).toEqual([]);
    expect(queue.delay(now)).toBe(120000);
  });
  it("waits for both retry time and lease; ignores completed records", () => {
    expect(
      nextDue(
        [
          {
            status: "processing",
            leaseUntil: new Date(now + 1000).toISOString(),
            nextAttemptAt: new Date(now + 5000).toISOString(),
          },
        ],
        now,
      ),
    ).toBe(5000);
    expect(nextDue([{ status: "sent" }], now)).toBeNull();
  });
  it("backs off exponentially with a cap and jitter for quota/network failures", () => {
    expect(retryDelay(0, true, () => 0)).toBe(300000);
    expect(retryDelay(1, true, () => 0)).toBe(600000);
    expect(retryDelay(100, true, () => 0)).toBe(3600000);
    expect(retryDelay(0, false, () => 0.5)).toBe(16500);
  });
});
