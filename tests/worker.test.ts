import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  collection: vi.fn(),
  doc: vi.fn(),
  runTransaction: vi.fn(),
  runtimeConfiguration: vi.fn(),
  sendMail: vi.fn(),
  mailTransport: vi.fn(),
  sender: vi.fn(),
}));
vi.mock("../server/firebase.js", () => ({ db: m }));
vi.mock("../server/control.js", () => ({
  runtimeConfiguration: m.runtimeConfiguration,
}));
vi.mock("../server/mail.js", () => ({
  mailTransport: m.mailTransport,
  sender: m.sender,
}));
import { nextDue, tick } from "../server/worker.js";
describe("SMTP email worker", () => {
  let update: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks();
    update = vi.fn().mockResolvedValue(undefined);
    m.runtimeConfiguration.mockResolvedValue({ emailEnabled: true });
    const ref = { update };
    const job = {
      status: "queued",
      attempts: 0,
      body: "Hello {{name}}",
      recipientName: "Alice",
      recipient: "recipient@example.org",
      subject: "Welcome",
    };
    const tx = {
      get: vi
        .fn()
        .mockImplementation(async (doc) =>
          doc === ref
            ? { data: () => job }
            : { data: () => ({ emailEnabled: true }) },
        ),
      update: vi.fn(),
    };
    m.runTransaction.mockImplementation((fn) => fn(tx));
    m.collection.mockReturnValue({
      where: () => ({
        limit: () => ({ get: async () => ({ docs: [{ id: "job1", ref }] }) }),
      }),
    });
    m.mailTransport.mockResolvedValue({ sendMail: m.sendMail });
    m.sender.mockResolvedValue({ name: "CONE", address: "sender@example.org" });
    m.sendMail.mockResolvedValue({});
  });
  afterEach(() => vi.clearAllMocks());
  it("delivers queued messages and records success", async () => {
    await tick();
    expect(m.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "recipient@example.org",
        subject: "Welcome",
        text: "Hello Alice",
        html: expect.stringContaining("Hello Alice"),
      }),
    );
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "sent" }),
    );
  });
  it("pauses delivery when disabled", async () => {
    m.runtimeConfiguration.mockResolvedValue({ emailEnabled: false });
    await tick();
    expect(m.sendMail).not.toHaveBeenCalled();
  });
  it("records a retry without storing SMTP secrets or full errors", async () => {
    m.sendMail.mockRejectedValue({
      code: "EAUTH",
      message: "sensitive transport details",
    });
    await tick();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "retry", error: "EAUTH" }),
    );
    expect(JSON.stringify(update.mock.calls)).not.toContain("sensitive");
  });
});
describe("when the email worker wakes", () => {
  const now = Date.parse("2026-10-21T10:00:00.000Z");
  it("sleeps while nothing is waiting", () => {
    expect(nextDue([], now)).toBeNull();
  });
  it("sends queued emails at once and retries when they fall due", () => {
    expect(nextDue([{ status: "queued" }], now)).toBe(0);
    expect(
      nextDue(
        [{ status: "retry", nextAttemptAt: "2026-10-21T10:05:00.000Z" }],
        now,
      ),
    ).toBe(300000);
  });
  it("takes over an abandoned job when its lease ends", () => {
    expect(
      nextDue(
        [
          { status: "processing", leaseUntil: "2026-10-21T10:02:00.000Z" },
          { status: "retry", nextAttemptAt: "2026-10-21T11:00:00.000Z" },
        ],
        now,
      ),
    ).toBe(120000);
  });
  it("treats an unreadable time as due now", () => {
    expect(nextDue([{ status: "retry", nextAttemptAt: "soon" }], now)).toBe(0);
  });
});
