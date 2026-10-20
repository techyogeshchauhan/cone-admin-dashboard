import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
function key() {
  const value = Buffer.from(process.env.CONFIG_ENCRYPTION_KEY || "", "base64");
  if (value.length !== 32)
    throw Object.assign(
      new Error(
        "Configure CONFIG_ENCRYPTION_KEY with a base64-encoded 32-byte key before storing SMTP credentials",
      ),
      { status: 400 },
    );
  return value;
}
export function encryptSecret(value: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return `${iv.toString("base64")}.${cipher.getAuthTag().toString("base64")}.${data.toString("base64")}`;
}
export function decryptSecret(value: string) {
  const [iv, tag, data] = value.split(".");
  const cipher = createDecipheriv(
    "aes-256-gcm",
    key(),
    Buffer.from(iv, "base64"),
  );
  cipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    cipher.update(Buffer.from(data, "base64")),
    cipher.final(),
  ]).toString("utf8");
}
