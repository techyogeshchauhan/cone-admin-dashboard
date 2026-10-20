import type { Express } from "express";
import { readFile } from "node:fs/promises";
import path from "node:path";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { auth, db } from "./firebase.js";
import { accessRoles, type AccessRole } from "../shared/schema.js";
type Credentials = { role: AccessRole; email: string; password: string };
type Dependencies = {
  readCredentials: () => Promise<{ accounts: Credentials[] }>;
  verifyAccount: (account: Credentials) => Promise<boolean>;
};
const defaults: Dependencies = {
  readCredentials: async () =>
    JSON.parse(
      await readFile(
        path.resolve("storage/admin-test-credentials.json"),
        "utf8",
      ),
    ),
  verifyAccount: async (account) => {
    const user = await auth.getUserByEmail(account.email);
    const profile = (await db.doc(`adminUsers/${user.uid}`).get()).data();
    return (
      !user.disabled &&
      user.emailVerified &&
      user.customClaims?.coneDashboardTest === true &&
      profile?.isTestAccount === true &&
      profile.status === "active" &&
      profile.accessRole === account.role &&
      profile.email === account.email
    );
  },
};
function loopback(value: string | undefined) {
  return (
    !!value &&
    ["localhost", "127.0.0.1", "::1", "[::1]", "::ffff:127.0.0.1"].includes(
      value.toLowerCase(),
    )
  );
}
export function registerDevRoleLogin(
  app: Express,
  dependencies: Dependencies = defaults,
) {
  app.post(
    "/api/dev/role-login",
    rateLimit({ windowMs: 60_000, limit: 30 }),
    async (req, res) => {
      res.setHeader("Cache-Control", "no-store");
      if (
        process.env.NODE_ENV === "production" ||
        !["development", "test"].includes(process.env.APP_ENV || "") ||
        process.env.ENABLE_ADMIN_TEST_ACCOUNTS !== "true" ||
        process.env.ENABLE_DASHBOARD_ROLE_LOGIN !== "true"
      )
        return void res.status(404).json({ error: "Not found" });
      let origin: URL;
      try {
        origin = new URL(req.get("origin") || "");
      } catch {
        return void res
          .status(403)
          .json({ error: "Local browser access only" });
      }
      if (
        !loopback(req.socket.remoteAddress) ||
        !loopback(req.hostname) ||
        !loopback(origin.hostname) ||
        !["http:", "https:"].includes(origin.protocol) ||
        req.get("x-forwarded-for")
      )
        return void res
          .status(403)
          .json({ error: "Local browser access only" });
      const parsed = z
        .object({ role: z.enum(accessRoles) })
        .strict()
        .safeParse(req.body);
      if (!parsed.success)
        return void res
          .status(400)
          .json({ error: "Select a supported dashboard role" });
      try {
        const { accounts } = await dependencies.readCredentials();
        const account = accounts.find((a) => a.role === parsed.data.role);
        const expected = `${parsed.data.role.replaceAll("_", "-")}@cone-admin.test`;
        if (
          !account ||
          account.email !== expected ||
          !account.password ||
          !(await dependencies.verifyAccount(account))
        )
          return void res.status(503).json({
            error:
              "This dashboard test account is unavailable. Run npm run setup:admin-test-accounts.",
          });
        // Sent only to the explicitly enabled loopback development UI, never
        // embedded in JavaScript, environment VITE_* values, or production assets.
        res.json({ email: account.email, password: account.password });
      } catch {
        res.status(503).json({
          error:
            "Cannot load dashboard test accounts. Check the API credentials and local test-account setup.",
        });
      }
    },
  );
}
