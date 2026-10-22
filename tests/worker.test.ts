import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import nodemailer from "nodemailer";
const m = vi.hoisted(() => ({
  collection: vi.fn(),
  doc: vi.fn(),
  runTransaction: vi.fn(),
  runtimeConfiguration: vi.fn(),
  sendMail: vi.fn(),
  mailTransport: vi.fn(),
  sender: vi.fn(),
  smtpConfiguration: vi.fn(),
}));
vi.mock("../server/firebase.js", () => ({ db: m }));
vi.mock("../server/control.js", () => ({
  runtimeConfiguration: m.runtimeConfiguration,
}));
vi.mock("../server/mail.js", () => ({
  mailTransport: m.mailTransport,
  sender: m.sender,
  smtpConfiguration: m.smtpConfiguration,
}));
import { nextDue, tick } from "../server/worker.js";
describe("SMTP email worker", () => {
  let documents: any[];
  let update: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.clearAllMocks();
    update = vi.fn().mockResolvedValue(undefined);
    m.runtimeConfiguration.mockResolvedValue({ emailEnabled: true });
    const ref = { update };
    documents = [{ id: "job1", ref, data: () => job }];
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

    m.smtpConfiguration.mockResolvedValue({ host: "local-fixture" });
    m.mailTransport.mockResolvedValue({ sendMail: m.sendMail });
    m.sender.mockResolvedValue({ name: "CONE", address: "sender@example.org" });
    m.sendMail.mockResolvedValue({});
  });
  afterEach(() => vi.clearAllMocks());
  it("delivers queued messages and records success", async () => {
    await tick(documents);
    expect(m.sendMail).toHaveBeenCalledWith(
      expect.objectContaining({
        to: "recipient@example.org",
        subject: "Welcome",
        text: "Hello Alice",
        html: expect.stringContaining("Hello Alice"),
      }),
    );
    expect(m.collection).not.toHaveBeenCalled();
    expect(m.smtpConfiguration).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "sent",
        deliveryFormat: "html",
        rendererVersion: "cone-branded-v1",
      }),
    );
  });
  it("assembles HTML and plain text as multipart email without contacting SMTP", async () => {
    const transport = nodemailer.createTransport({
      streamTransport: true,
      buffer: true,
      newline: "unix",
    });
    const deliver = vi.fn((options) => transport.sendMail(options));
    m.mailTransport.mockResolvedValue({ sendMail: deliver });
    await tick(documents);
    expect(deliver).toHaveBeenCalledOnce();
    const message = (await deliver.mock.results[0].value).message.toString();
    expect(message).toMatch(/Content-Type: multipart\/alternative;/);
    expect(message).toMatch(/Content-Type: text\/plain; charset=utf-8/);
    expect(message).toMatch(/Content-Type: text\/html; charset=utf-8/);
    expect(message).toContain("Hello Alice");
    expect(message).toContain("CONFERENCE COMMUNICATION");
  });
  it("pauses delivery when disabled", async () => {
    m.runtimeConfiguration.mockResolvedValue({ emailEnabled: false });
    await tick(documents, { enabled: false });
    expect(m.sendMail).not.toHaveBeenCalled();
  });
  it("does not attempt claims for future retries or live leases", async () => {
    documents[0].data = () => ({
      status: "retry",
      nextAttemptAt: new Date(Date.now() + 60000).toISOString(),
    });
    expect(await tick(documents)).toBe(0);
    expect(m.runTransaction).not.toHaveBeenCalled();
  });
  it("rechecks the email switch inside the transaction", async () => {
    m.runTransaction.mockImplementation((fn) =>
      fn({
        get: async (ref: any) => ({
          data: () =>
            ref === documents[0].ref
              ? documents[0].data()
              : { emailEnabled: false },
        }),
        update: vi.fn(),
      }),
    );
    expect(await tick(documents)).toBe("disabled");
    expect(m.sendMail).not.toHaveBeenCalled();
  });
  it("ignores a stale snapshot after a different worker already sent the job", async () => {
    m.runTransaction.mockImplementation((fn) =>
      fn({ get: async () => ({ data: () => ({ status: "sent" }) }) }),
    );
    const observed = vi.fn();
    await tick(documents, { observed });
    expect(m.sendMail).not.toHaveBeenCalled();
    expect(observed).toHaveBeenCalled();
  });
  it("does not requeue successful SMTP delivery when its Firestore status write fails", async () => {
    update.mockRejectedValueOnce({ code: 8 });
    await expect(tick(documents)).rejects.toMatchObject({ code: 8 });
    expect(m.sendMail).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "sent" }),
    );
  });
  it("records a retry without storing SMTP secrets or full errors", async () => {
    m.sendMail.mockRejectedValue({
      code: "EAUTH",
      message: "sensitive transport details",
    });
    await tick(documents);
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
