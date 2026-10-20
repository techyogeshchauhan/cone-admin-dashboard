import nodemailer from "nodemailer";
import { db } from "./firebase.js";
import { decryptSecret } from "./secrets.js";
export async function smtpConfiguration() {
  const saved = (await db.doc("applicationSettings/smtp").get()).data();
  if (saved)
    return {
      ...saved,
      password: saved.passwordEncrypted
        ? decryptSecret(saved.passwordEncrypted)
        : "",
    } as {
      host: string;
      port: number;
      security: string;
      username: string;
      password: string;
      fromEmail: string;
      fromName: string;
      passwordEncrypted?: string;
    };
  return {
    host: process.env.SMTP_HOST || "",
    port: Number(process.env.SMTP_PORT || 587),
    security: process.env.SMTP_SECURITY || "none",
    username: process.env.SMTP_USERNAME || "",
    password: process.env.SMTP_PASSWORD || "",
    fromEmail: process.env.SMTP_FROM_EMAIL || "no-reply@example.test",
    fromName: process.env.SMTP_FROM_NAME || "CONE",
  };
}
export async function publicSmtpConfiguration() {
  const config = await smtpConfiguration();
  const { password, passwordEncrypted, ...publicValues } =
    config as typeof config & { passwordEncrypted?: string };
  return {
    ...publicValues,
    passwordConfigured: Boolean(password),
    configured: Boolean(config.host),
  };
}
export async function mailTransport() {
  const config = await smtpConfiguration();
  if (!config.host)
    throw Object.assign(new Error("Configure SMTP first"), { status: 400 });
  const mode = config.security;
  if (
    process.env.APP_ENV === "production" &&
    !["tls", "starttls"].includes(mode)
  )
    throw new Error("Production SMTP requires TLS");
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: mode === "tls",
    requireTLS: mode === "starttls",
    connectionTimeout: 15000,
    greetingTimeout: 15000,
    socketTimeout: 30000,
    ...(config.username
      ? {
          auth: {
            user: config.username,
            pass: config.password,
          },
        }
      : {}),
  });
}
export async function sender() {
  const config = await smtpConfiguration();
  return { name: config.fromName, address: config.fromEmail };
}
