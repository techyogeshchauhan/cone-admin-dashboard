import assert from "node:assert/strict";
const project = "demo-cone-otp";
const host = process.env.FIRESTORE_EMULATOR_HOST;
assert(
  host && /^(127\.0\.0\.1|localhost):\d+$/.test(host),
  "Run only through the local Firestore emulator",
);
const base = `http://${host}/v1/projects/${project}/databases/(default)/documents`;
const now = Math.floor(Date.now() / 1000);
function token(extra = {}) {
  const encode = (v) => Buffer.from(JSON.stringify(v)).toString("base64url");
  return `${encode({ alg: "none", typ: "JWT" })}.${encode({ sub: "otp-user", user_id: "otp-user", aud: project, iss: `https://securetoken.google.com/${project}`, iat: now, exp: now + 3600, auth_time: now, email: "user@example.org", email_verified: true, firebase: { sign_in_provider: "custom" }, login_method: "email_otp", login_audience: "mobile", otp_verified_at: now, ...extra })}.`;
}
async function write(path, values) {
  const fields = Object.fromEntries(
    Object.entries(values).map(([k, v]) => [
      k,
      typeof v === "boolean" ? { booleanValue: v } : { stringValue: v },
    ]),
  );
  const response = await fetch(`${base}/${path}`, {
    method: "PATCH",
    headers: {
      Authorization: "Bearer owner",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ fields }),
  });
  assert(response.ok, await response.text());
}
async function read(path, credential, expected) {
  const response = await fetch(`${base}/${path}`, {
    headers: { Authorization: `Bearer ${credential}` },
  });
  assert.equal(response.status, expected, `${path}: ${await response.text()}`);
}
await write("people/user@example.org", {
  fullName: "OTP Test",
  registrationStatus: "confirmed",
  role: "attendee",
  isDemo: false,
});
await write("adminUsers/otp-user", { status: "active" });
await write("authChallenges/test", { hash: "not-readable" });
await read("people/user@example.org", token(), 200);
await read(
  "people/user@example.org",
  token({
    login_method: "password",
    firebase: { sign_in_provider: "password" },
  }),
  403,
);
await read(
  "people/user@example.org",
  token({ otp_verified_at: now - 86401 }),
  403,
);
await read(
  "people/user@example.org",
  token({ login_audience: "dashboard" }),
  403,
);
await read("authChallenges/test", token(), 403);
await write("adminUsers/otp-user", { status: "disabled" });
await read("people/user@example.org", token(), 403);
await write("adminUsers/otp-user", { status: "active" });
await write("people/user@example.org", {
  fullName: "OTP Test",
  registrationStatus: "confirmed",
  role: "attendee",
  isDemo: true,
});
await read("people/user@example.org", token(), 403);
console.log(
  "PASS: OTP session, legacy password denial, stale session, audience, private challenges, disabled account and demo denial.",
);
