import { afterEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { encryptSecret, decryptSecret } from "../server/secrets.js";
const initial = process.env.CONFIG_ENCRYPTION_KEY;
afterEach(() => {
  if (initial === undefined) delete process.env.CONFIG_ENCRYPTION_KEY;
  else process.env.CONFIG_ENCRYPTION_KEY = initial;
});
describe("SMTP credential storage", () => {
  it("encrypts secrets and uses distinct nonces", () => {
    process.env.CONFIG_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    const a = encryptSecret("private-smtp-password");
    const b = encryptSecret("private-smtp-password");
    expect(a).not.toContain("private-smtp-password");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("private-smtp-password");
  });
  it("rejects storage without a valid encryption key", () => {
    delete process.env.CONFIG_ENCRYPTION_KEY;
    expect(() => encryptSecret("password")).toThrow("CONFIG_ENCRYPTION_KEY");
  });
  it("rejects tampered ciphertext", () => {
    process.env.CONFIG_ENCRYPTION_KEY = randomBytes(32).toString("base64");
    const parts = encryptSecret("password").split(".");
    parts[1] = randomBytes(16).toString("base64");
    expect(() => decryptSecret(parts.join("."))).toThrow();
  });
});
