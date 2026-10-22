import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  queue: vi.fn(),
  runtime: vi.fn(),
  unsubscribe: vi.fn(),
  transaction: vi.fn(),
  acquire: vi.fn(),
  renew: vi.fn(),
  release: vi.fn(),
  sendMail: vi.fn(),
}));
vi.mock("../server/firebase.js", () => ({
  db: {
    collection: () => ({ where: () => ({ onSnapshot: m.queue }) }),
    doc: (path: string) => ({ path, onSnapshot: m.runtime }),
    runTransaction: m.transaction,
  },
}));
vi.mock("../server/worker-lease.js", () => ({
  acquireWorkerLease: m.acquire,
  leaderRenewMs: 300000,
}));
vi.mock("../server/mail.js", () => ({
  mailTransport: async () => ({ sendMail: m.sendMail }),
  sender: async () => ({ address: "fixture@example.test" }),
  smtpConfiguration: async () => ({}),
}));
vi.mock("../server/email-branding.js", () => ({
  emailBranding: async () => ({ applicationName: "Fixture" }),
}));
import { runWorker } from "../server/worker.js";
describe("worker runtime without production connections", () => {
  let controller: AbortController;
  let running: Promise<unknown> | undefined;
  const flush = () => vi.advanceTimersByTimeAsync(0);
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.spyOn(Math, "random").mockReturnValue(0);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    m.queue.mockReturnValue(m.unsubscribe);
    m.runtime.mockReturnValue(m.unsubscribe);
    m.acquire.mockResolvedValue({
      ref: { path: "leader" },
      valid: () => true,
      renew: m.renew,
      release: m.release,
    });
    m.renew.mockResolvedValue(true);
    m.release.mockResolvedValue(undefined);
    controller = new AbortController();
    running = undefined;
  });
  afterEach(async () => {
    controller.abort();
    await flush();
    await running;
    vi.useRealTimers();
    vi.restoreAllMocks();
  });
  it("exits duplicate workers before registering queue/config listeners", async () => {
    m.acquire.mockResolvedValue(null);
    await runWorker(controller.signal);
    expect(m.queue).not.toHaveBeenCalled();
    expect(m.runtime).not.toHaveBeenCalled();
  });
  it("does no queue/transaction polling for idle, leased or disabled work", async () => {
    running = runWorker(controller.signal);
    await flush();
    const queue = m.queue.mock.calls[0][0],
      runtime = m.runtime.mock.calls[0][0];
    const later = new Date(Date.now() + 120000).toISOString();
    const job = {
      id: "future",
      data: () => ({ status: "processing", leaseUntil: later }),
    };
    runtime({ data: () => ({ emailEnabled: true }) });
    queue({ docs: [job] });
    await vi.advanceTimersByTimeAsync(60000);
    expect(m.transaction).not.toHaveBeenCalled();
    runtime({ data: () => ({ emailEnabled: false }) });
    queue({ docs: [{ id: "queued", data: () => ({ status: "queued" }) }] });
    await vi.advanceTimersByTimeAsync(240000);
    expect(m.transaction).not.toHaveBeenCalled();
    expect(m.renew).toHaveBeenCalledOnce();
    expect(m.queue).toHaveBeenCalledOnce();
  });
  it("snapshot feedback cannot cancel quota backoff; errored listeners are replaced", async () => {
    running = runWorker(controller.signal);
    await flush();
    m.queue.mock.calls[0][1]({ code: 8 });
    await flush();
    for (let i = 0; i < 5; i++) {
      m.queue.mock.calls[0][0]({ docs: [] });
      m.runtime.mock.calls[0][0]({ data: () => ({ emailEnabled: true }) });
      await vi.advanceTimersByTimeAsync(30000);
    }
    expect(m.queue).toHaveBeenCalledOnce();
    expect(m.transaction).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(150000);
    expect(m.queue).toHaveBeenCalledTimes(2);
    expect(m.unsubscribe).toHaveBeenCalledTimes(2);
  });
  it("own processing/sent snapshot notifications deliver a queued job once", async () => {
    running = runWorker(controller.signal);
    await flush();
    const queue = m.queue.mock.calls[0][0];
    let data: Record<string, any> = {
      status: "queued",
      subject: "Fixture",
      body: "Hello",
      recipient: "fixture@example.test",
    };
    const document: any = {
      id: "one",
      data: () => ({ ...data }),
      ref: {
        path: "emailJobs/one",
        update: vi.fn(async (value) => {
          data = { ...data, ...value };
          queue({ docs: data.status === "sent" ? [] : [document] });
        }),
      },
    };
    m.transaction.mockImplementation(async (work) =>
      work({
        get: async (ref: any) => ({
          readTime: { toMillis: () => Date.now() },
          data: () =>
            ref.path === "emailJobs/one" ? { ...data } : { emailEnabled: true },
        }),
        update: (_ref: any, value: any) => {
          data = { ...data, ...value };
          queue({ docs: [document] });
        },
      }),
    );
    m.runtime.mock.calls[0][0]({ data: () => ({ emailEnabled: true }) });
    queue({ docs: [document] });
    await flush();
    await vi.advanceTimersByTimeAsync(120000);
    expect(m.transaction).toHaveBeenCalledOnce();
    expect(m.sendMail).toHaveBeenCalledOnce();
    expect(m.queue).toHaveBeenCalledOnce();
  });
  it("does not lose a concurrent enable notification after a disabled transaction", async () => {
    running = runWorker(controller.signal);
    await flush();
    const queue = m.queue.mock.calls[0][0],
      runtime = m.runtime.mock.calls[0][0];
    let checks = 0;
    let data: Record<string, any> = {
      status: "queued",
      subject: "Fixture",
      body: "Hello",
      recipient: "fixture@example.test",
    };
    const document: any = {
      id: "one",
      data: () => ({ ...data }),
      ref: { path: "emailJobs/one", update: async () => queue({ docs: [] }) },
    };
    m.transaction.mockImplementation(async (work) =>
      work({
        get: async (ref: any) => {
          if (ref.path === "applicationSettings/runtime" && checks++ === 0) {
            runtime({ data: () => ({ emailEnabled: true }) });
            return { data: () => ({ emailEnabled: false }) };
          }
          return {
            readTime: { toMillis: () => Date.now() },
            data: () =>
              ref.path === "emailJobs/one"
                ? { ...data }
                : { emailEnabled: true },
          };
        },
        update: (_ref: any, value: any) => {
          data = { ...data, ...value };
        },
      }),
    );
    runtime({ data: () => ({ emailEnabled: true }) });
    queue({ docs: [document] });
    await flush();
    expect(m.transaction).toHaveBeenCalledTimes(2);
    expect(m.sendMail).toHaveBeenCalledOnce();
  });
});
