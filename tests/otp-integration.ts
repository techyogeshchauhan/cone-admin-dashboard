import assert from "node:assert/strict";
import net from "node:net";
import { randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, readdir, unlink, rmdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
const loopback = /^(127\.0\.0\.1|localhost):\d+$/;
assert(
  loopback.test(process.env.FIRESTORE_EMULATOR_HOST || ""),
  "Local Firestore emulator required",
);
assert(
  loopback.test(process.env.FIREBASE_AUTH_EMULATOR_HOST || ""),
  "Local Auth emulator required",
);
execFileSync(process.execPath, ["tests/otp-rules.mjs"], { stdio: "inherit" });
process.env.NODE_ENV = "test";
process.env.APP_ENV = "test";
process.env.REQUIRE_ADMIN_MFA = "false";
const temporaryStorage = await mkdtemp(
  path.join(os.tmpdir(), "cone-branding-test-"),
);
process.env.STORAGE_ROOT = temporaryStorage;
process.env.PUBLIC_API_BASE_URL = "http://localhost:8080";
process.env.FIREBASE_PROJECT_ID = "demo-cone-otp";
process.env.OTP_AUTH_ENABLED = "true";
process.env.OTP_HMAC_SECRET = randomBytes(32).toString("base64");
process.env.SMTP_HOST = "127.0.0.1";
process.env.SMTP_SECURITY = "none";
process.env.SMTP_USERNAME = "";
process.env.SMTP_PASSWORD = "";
let receivedCode: string | undefined;
const sockets = new Set<net.Socket>();
const smtp = net.createServer((socket) => {
  sockets.add(socket);
  socket.on("close", () => sockets.delete(socket));
  socket.write("220 localhost test SMTP\r\n");
  let buffer = "",
    dataMode = false;
  socket.on("data", (chunk) => {
    buffer += chunk.toString();
    if (dataMode) {
      const end = buffer.indexOf("\r\n.\r\n");
      if (end < 0) return;
      const body = buffer.slice(0, end);
      receivedCode = body.match(/code is (\d{6})/)?.[1];
      buffer = buffer.slice(end + 5);
      dataMode = false;
      socket.write("250 accepted locally\r\n");
    }
    while (!dataMode && buffer.includes("\r\n")) {
      const index = buffer.indexOf("\r\n"),
        line = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      if (/^EHLO|^HELO/i.test(line)) socket.write("250 localhost\r\n");
      else if (/^DATA/i.test(line)) {
        dataMode = true;
        socket.write("354 end with dot\r\n");
      } else if (/^QUIT/i.test(line)) {
        socket.end("221 bye\r\n");
      } else socket.write("250 OK\r\n");
    }
  });
});
await new Promise<void>((resolve) => smtp.listen(0, "127.0.0.1", resolve));
process.env.SMTP_PORT = String((smtp.address() as net.AddressInfo).port);
const { app } = await import("../server/index.js");
const { auth, db } = await import("../server/firebase.js");
const { default: supertest } = await import("supertest");
const api = supertest(app);
try {
  const email = "integration@example.org";
  const user = await auth.createUser({
    email,
    displayName: "Integration User",
    emailVerified: false,
  });
  await db.doc(`people/${email}`).set({
    email,
    fullName: "Integration User",
    mobile: "9876543210",
    role: "presenter",
    registrationStatus: "confirmed",
    isDemo: false,
    registrationId: "OTP-TEST",
    passId: "OTP-PASS",
    affiliation: "Test",
  });
  const requested = await api
    .post("/api/auth/email-otp/request")
    .send({ name: "Integration User", email, mobile: "9876543210" });
  assert.equal(requested.status, 200, JSON.stringify(requested.body));
  assert(!requested.body.token);
  assert(!requested.body.code);
  const deadline = Date.now() + 15000;
  while (!receivedCode && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 25));
  assert(receivedCode, "The local SMTP sink must capture the OTP");
  const challengeId = requested.body.challengeId;
  const wrong = await api.post("/api/auth/email-otp/verify").send({
    challengeId,
    code: receivedCode === "000000" ? "111111" : "000000",
  });
  assert.equal(wrong.status, 400);
  const verified = await api
    .post("/api/auth/email-otp/verify")
    .send({ challengeId, code: receivedCode });
  assert.equal(verified.status, 200, JSON.stringify(verified.body));
  assert(verified.body.token);
  const replay = await api
    .post("/api/auth/email-otp/verify")
    .send({ challengeId, code: receivedCode });
  assert.equal(replay.status, 400);
  const exchange = await fetch(
    `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-key`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: verified.body.token,
        returnSecureToken: true,
      }),
    },
  );
  const session = (await exchange.json()) as any;
  assert(exchange.ok, JSON.stringify(session));
  const decoded = await auth.verifyIdToken(session.idToken, true);
  assert.equal(decoded.uid, user.uid);
  assert.equal(decoded.login_method, "email_otp");
  assert.equal(decoded.login_audience, "mobile");
  assert.equal(decoded.email_verified, true);
  const ownProfile = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/demo-cone-otp/databases/(default)/documents/people/${email}`,
    { headers: { Authorization: `Bearer ${session.idToken}` } },
  );
  assert.equal(ownProfile.status, 200, await ownProfile.text());
  const admin = await api
    .get("/api/me")
    .set("Authorization", `Bearer ${session.idToken}`);
  assert.equal(admin.status, 403);
  console.log(
    "PASS full local workflow: request, SMTP sink, wrong-code rejection, verification, replay rejection, Firebase token exchange, protected mobile profile and admin isolation. No external email was sent.",
  );
  const owner = await auth.createUser({
    email: "branding-owner@example.org",
    emailVerified: true,
  });
  await db.doc(`adminUsers/${owner.uid}`).set({
    fullName: "Branding Owner",
    email: owner.email,
    mobile: "9876543210",
    accessRole: "superadmin",
    status: "active",
    conferenceId: "main",
    version: 1,
  });
  async function signInUid(uid: string) {
    const token = await auth.createCustomToken(uid);
    const response = await fetch(
      `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken?key=demo-key`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, returnSecureToken: true }),
      },
    );
    const body = (await response.json()) as any;
    assert(response.ok, JSON.stringify(body));
    return body.idToken as string;
  }
  const ownerToken = await signInUid(owner.uid);
  const png = await sharp({
    create: { width: 32, height: 32, channels: 4, background: "#167d72" },
  })
    .png()
    .toBuffer();
  const updated = await api
    .post("/api/settings/branding")
    .set("Authorization", `Bearer ${ownerToken}`)
    .field("applicationName", "Aurora Congress")
    .field("version", "0")
    .attach("logo", png, { filename: "logo.png", contentType: "image/png" });
  assert.equal(updated.status, 200, JSON.stringify(updated.body));
  assert.equal(updated.body.applicationName, "Aurora Congress");
  assert(updated.body.logoId);
  const brand = await api.get("/api/branding");
  assert.equal(brand.body.applicationName, "Aurora Congress");
  assert.equal(brand.body.version, 1);
  const logo = await api.get(`/api/branding/logo/${brand.body.logoId}`);
  assert.equal(logo.status, 200);
  assert.match(logo.headers["content-type"], /webp/);
  assert.equal(logo.headers["cross-origin-resource-policy"], "cross-origin");
  assert.equal(logo.headers["access-control-allow-origin"], "*");
  const metadata = await sharp(logo.body).metadata();
  assert.equal(metadata.format, "webp");
  const published = await db.doc("conference/branding").get();
  assert.equal(published.data()!.applicationName, "Aurora Congress");
  assert.match(
    published.data()!.logoUrl,
    /^http:\/\/localhost:8080\/api\/branding\/logo\//,
  );
  const publicDocument = await fetch(
    `http://${process.env.FIRESTORE_EMULATOR_HOST}/v1/projects/demo-cone-otp/databases/(default)/documents/conference/branding`,
  );
  assert.equal(publicDocument.status, 200);
  const stale = await api
    .post("/api/settings/branding")
    .set("Authorization", `Bearer ${ownerToken}`)
    .field("applicationName", "Outdated")
    .field("version", "0");
  assert.equal(stale.status, 409);
  const invalid = await api
    .post("/api/settings/branding")
    .set("Authorization", `Bearer ${ownerToken}`)
    .field("applicationName", "Invalid")
    .field("version", "1")
    .attach("logo", Buffer.from('<svg width="32" height="32"></svg>'), {
      filename: "bad.svg",
      contentType: "image/svg+xml",
    });
  assert.equal(invalid.status, 400);
  await db.doc(`adminUsers/${user.uid}`).set({
    fullName: "Participant",
    email,
    mobile: "9876543210",
    accessRole: "participant",
    status: "active",
    conferenceId: "main",
  });
  const participantToken = await signInUid(user.uid);
  const forbidden = await api
    .post("/api/settings/branding")
    .set("Authorization", `Bearer ${participantToken}`)
    .field("applicationName", "Unauthorized")
    .field("version", "1");
  assert.equal(forbidden.status, 403);
  const removed = await api
    .post("/api/settings/branding")
    .set("Authorization", `Bearer ${ownerToken}`)
    .field("applicationName", "Summit")
    .field("version", "1")
    .field("removeLogo", "true");
  assert.equal(removed.status, 200);
  assert.equal(removed.body.logoId, null);
  console.log(
    "PASS branding: Super Admin save/upload, optimized public VPS file, persistent database values, mobile public read, conflict protection, SVG rejection, participant denial and logo removal.",
  );
} finally {
  for (const socket of sockets) socket.destroy();
  await new Promise<void>((resolve) => smtp.close(() => resolve()));
  await db.terminate();
  for (const file of await readdir(temporaryStorage))
    await unlink(path.join(temporaryStorage, file));
  await rmdir(temporaryStorage);
}
