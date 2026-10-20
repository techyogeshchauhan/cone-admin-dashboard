import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({
  doc: vi.fn(),
  runTransaction: vi.fn(),
  getUserByEmail: vi.fn(),
  updateUser: vi.fn(),
  createCustomToken: vi.fn(),
  sendMail: vi.fn(),
}));
vi.mock("../server/firebase.js", () => ({ db: m, auth: m }));
vi.mock("../server/mail.js", () => ({
  mailTransport: async () => ({ sendMail: m.sendMail }),
  sender: async () => ({ address: "sender@example.org" }),
}));
import {
  requestEmailOtp,
  verifyEmailOtp,
  registerEmailOtp,
} from "../server/email-otp.js";
import express from "express";
import supertest from "supertest";
let records: Map<string, any>;
const details = {
  name: "New User",
  email: "new@example.org",
  mobile: "9876543210",
};
let now: number;
function code() {
  return m.sendMail.mock.calls.at(-1)![0].text.match(/code is (\d{6})/)[1];
}
async function issue() {
  const challenge = await requestEmailOtp(details, "127.0.0.1");
  await vi.waitFor(() =>
    expect(records.get(`authChallenges/${challenge.challengeId}`).status).toBe(
      "pending",
    ),
  );
  return { challengeId: challenge.challengeId, code: code() };
}
describe("email OTP authentication", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("OTP_HMAC_SECRET", Buffer.alloc(32, 7).toString("base64"));
    vi.stubEnv("APP_ENV", "test");
    now = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => now);
    records = new Map([
      [
        "people/new@example.org",
        {
          fullName: "New User",
          mobile: "9876543210",
          registrationStatus: "confirmed",
        },
      ],
    ]);
    m.doc.mockImplementation((path: string) => ({
      id: path.split("/").at(-1),
      path,
      get: async () => ({
        exists: records.has(path),
        data: () => structuredClone(records.get(path)),
      }),
      update: async (value: any) =>
        records.set(path, { ...records.get(path), ...value }),
    }));
    let chain = Promise.resolve();
    m.runTransaction.mockImplementation((fn: any) => {
      const result = chain.then(() =>
        fn({
          get: (ref: any) => ref.get(),
          set: (ref: any, value: any, options: any) =>
            records.set(ref.path, {
              ...(options?.merge ? records.get(ref.path) : {}),
              ...value,
            }),
          create: (ref: any, value: any) => records.set(ref.path, value),
          update: (ref: any, value: any) =>
            records.set(ref.path, { ...records.get(ref.path), ...value }),
        }),
      );
      chain = result.catch(() => {});
      return result;
    });
    m.getUserByEmail.mockResolvedValue({
      uid: "uid",
      email: "new@example.org",
      disabled: false,
    });
    m.updateUser.mockResolvedValue({});
    m.createCustomToken.mockResolvedValue("firebase-token");
    m.sendMail.mockResolvedValue({});
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });
  it("sends a code but returns no code or session credential before verification", async () => {
    const result = await requestEmailOtp(details, "ip");
    await vi.waitFor(() =>
      expect(records.get(`authChallenges/${result.challengeId}`).status).toBe(
        "pending",
      ),
    );
    expect(result).not.toHaveProperty("token");
    expect(JSON.stringify(result)).not.toContain(code());
    const stored = records.get(`authChallenges/${result.challengeId}`);
    expect(stored.hash).toHaveLength(64);
    expect(JSON.stringify(stored)).not.toContain(`"${code()}"`);
    expect(m.createCustomToken).not.toHaveBeenCalled();
  });
  it("authenticates only after consumption, bound to mobile audience", async () => {
    const challenge = await issue();
    expect(await verifyEmailOtp(challenge)).toEqual({
      token: "firebase-token",
    });
    expect(records.get(`authChallenges/${challenge.challengeId}`).status).toBe(
      "used",
    );
    expect(m.createCustomToken).toHaveBeenCalledWith(
      "uid",
      expect.objectContaining({
        login_method: "email_otp",
        login_audience: "mobile",
      }),
    );
    expect(m.updateUser).toHaveBeenCalledWith("uid", { emailVerified: true });
  });
  it("rejects replay and concurrent verification", async () => {
    const challenge = await issue();
    const results = await Promise.allSettled([
      verifyEmailOtp(challenge),
      verifyEmailOtp(challenge),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(m.createCustomToken).toHaveBeenCalledTimes(1);
  });
  it("locks a challenge after five incorrect guesses", async () => {
    const challenge = await issue();
    const wrong = challenge.code === "000000" ? "111111" : "000000";
    for (let i = 0; i < 5; i++)
      await expect(
        verifyEmailOtp({ ...challenge, code: wrong }),
      ).rejects.toThrow("Invalid");
    await expect(verifyEmailOtp(challenge)).rejects.toThrow("Invalid");
    expect(m.createCustomToken).not.toHaveBeenCalled();
  });
  it("expires codes using server time", async () => {
    const challenge = await issue();
    now += 300001;
    await expect(verifyEmailOtp(challenge)).rejects.toThrow("expired");
  });
  it("enforces cooldown and invalidates old codes on resend", async () => {
    const old = await issue();
    await expect(issue()).rejects.toMatchObject({ status: 429 });
    now += 60001;
    const next = await issue();
    await expect(verifyEmailOtp(old)).rejects.toThrow("Invalid");
    await expect(verifyEmailOtp(next)).resolves.toHaveProperty("token");
  });
  it("bounds sends across newly created challenges", async () => {
    for (let i = 0; i < 5; i++) {
      await issue();
      now += 60001;
    }
    await expect(issue()).rejects.toMatchObject({ status: 429 });
  });
  it("reports unknown registrations without issuing a code or email", async () => {
    records.clear();
    await expect(requestEmailOtp(details, "ip")).rejects.toMatchObject({
      status: 404,
      message: expect.stringContaining("User data not found in system"),
    });
    expect(m.sendMail).not.toHaveBeenCalled();
    expect(
      [...records.keys()].some((k) => k.startsWith("authChallenges/")),
    ).toBe(false);
  });
  it("reports mismatched name or mobile as not found", async () => {
    await expect(
      requestEmailOtp({ ...details, mobile: "9000000000" }, "ip"),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      requestEmailOtp({ ...details, name: "Someone Else" }, "ip"),
    ).rejects.toMatchObject({ status: 404 });
    expect(m.sendMail).not.toHaveBeenCalled();
  });
  it("lets a corrected request through without an account cooldown", async () => {
    await expect(
      requestEmailOtp({ ...details, mobile: "9000000000" }, "ip"),
    ).rejects.toMatchObject({ status: 404 });
    await expect(issue()).resolves.toHaveProperty("code");
  });
  it("throttles repeated unknown lookups per IP", async () => {
    records.clear();
    for (let i = 0; i < 30; i++)
      await expect(requestEmailOtp(details, "ip")).rejects.toMatchObject({
        status: 404,
      });
    await expect(requestEmailOtp(details, "ip")).rejects.toMatchObject({
      status: 429,
    });
  });
  it("rechecks disabled identities before granting access", async () => {
    const challenge = await issue();
    m.getUserByEmail.mockResolvedValue({ uid: "uid", disabled: true });
    await expect(verifyEmailOtp(challenge)).rejects.toThrow("Invalid");
    expect(m.createCustomToken).not.toHaveBeenCalled();
  });
  it("fails closed on delivery failure without queueing raw codes", async () => {
    m.sendMail.mockRejectedValue(new Error("secret transport details"));
    const result = await requestEmailOtp(details, "ip");
    expect(result.message).toContain("code has been sent");
    await vi.waitFor(() =>
      expect(records.get(`authChallenges/${result.challengeId}`).status).toBe(
        "delivery_failed",
      ),
    );
    expect(
      [...records.values()].some(
        (r) => r.status === "delivery_failed" && r.hash === null,
      ),
    ).toBe(true);
    expect(m.createCustomToken).not.toHaveBeenCalled();
  });
  it("does not reuse a code after token signing fails", async () => {
    const challenge = await issue();
    m.createCustomToken.mockRejectedValue(new Error("signing failed"));
    await expect(verifyEmailOtp(challenge)).rejects.toThrow("signing failed");
    await expect(verifyEmailOtp(challenge)).rejects.toThrow("Invalid");
  });
  it("keeps endpoints absent by default", async () => {
    vi.stubEnv("OTP_AUTH_ENABLED", "false");
    const app = express();
    registerEmailOtp(app);
    expect(
      (await supertest(app).post("/api/auth/email-otp/request")).status,
    ).toBe(404);
  });
  it("refuses production startup with development bypasses", () => {
    vi.stubEnv("OTP_AUTH_ENABLED", "true");
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("TEST_IN_APP_EMAIL_VERIFICATION", "true");
    expect(() => registerEmailOtp(express())).toThrow("bypasses");
  });
});
