import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import supertest from "supertest";
import ExcelJS from "exceljs";
import { fakeFirestore } from "./fake-firestore.js";
import { accessRoles, permissions, type AccessRole } from "../shared/schema.js";

const m = vi.hoisted(() => {
  process.env.API_CACHE_MS = "30000";
  return { fake: null as any, verify: vi.fn() };
});
vi.mock("../server/firebase.js", () => ({
  get db() {
    return m.fake.db;
  },
  auth: { verifyIdToken: m.verify },
}));
vi.mock("../server/accounts.js", async (original) => ({
  ...(await original<typeof import("../server/accounts.js")>()),
  ensureIdentity: vi
    .fn()
    .mockResolvedValue({ account: { uid: "person" }, created: false }),
  ensureParticipantAccess: vi.fn().mockResolvedValue(undefined),
}));
import { app } from "../server/index.js";
import { clearRequestCaches } from "../server/request-cache.js";
const api = supertest(app);
const get = (path: string) =>
  api.get(path).set("Authorization", "Bearer token");
const post = (path: string, body = {}) =>
  api.post(path).set("Authorization", "Bearer token").send(body);
const person = {
  fullName: "Example Presenter",
  email: "person@example.org",
  mobile: "9876543210",
  affiliation: "Example University",
  role: "presenter",
  registrationStatus: "confirmed",
  registrationId: "REG-1",
  discipline: "Chemistry",
  category: "I",
  presentationType: "O",
  registrationFee: 500,
  feesReceived: "DD-000123",
  workingAs: "Research Scholar",
  district: "DN",
  dob: "1999-01-02",
  gender: "F",
  rollNo: "R-3",
  remark: "Internal note",
  importSource: { row: 5, jobId: "job" },
  original: { private: "raw source data" },
  accountType: "test",
  searchKeys: ["example"],
  version: 1,
};
let logDirectory: string;
beforeAll(async () => {
  logDirectory = await mkdtemp(path.join(tmpdir(), "cone-role-data-"));
  vi.stubEnv("LOG_DIR", logDirectory);
});
afterAll(async () => {
  vi.unstubAllEnvs();
  if (
    path.dirname(path.resolve(logDirectory)) !== path.resolve(tmpdir()) ||
    !path.basename(logDirectory).startsWith("cone-role-data-")
  )
    throw new Error("Refusing to remove an unexpected test log directory");
  await rm(logDirectory, { recursive: true, force: true });
});
function actor(role: string, grants?: string[]) {
  clearRequestCaches();
  m.fake.store.set("adminUsers/owner", {
    fullName: "Owner",
    accessRole: role,
    status: "active",
    conferenceId: "main",
  });
  if (grants)
    m.fake.store.set(`roleDefinitions/${role}`, {
      name: "Custom policy",
      description: "",
      active: true,
      managedRole: true,
      version: 1,
      permissions: grants,
    });
}
beforeEach(() => {
  clearRequestCaches();
  m.fake = fakeFirestore();
  m.verify.mockResolvedValue({
    uid: "owner",
    email: "person@example.org",
    email_verified: true,
    auth_time: Date.now() / 1000,
    exp: Date.now() / 1000 + 3600,
    firebase: { sign_in_second_factor: "phone" },
  });
  m.fake.store.set("people/person@example.org", structuredClone(person));
  m.fake.store.set("people/other@example.org", {
    ...person,
    email: "other@example.org",
  });
  m.fake.store.set("feeRecords/a", {
    participantEmail: person.email,
    amount: 500,
    currency: "INR",
    status: "received",
    reference: "VERIFIED-1",
    updatedBy: "private-staff-id",
    version: 1,
  });
  m.fake.store.set("feeRecords/b", {
    participantEmail: "other@example.org",
    amount: 1000,
    currency: "INR",
    status: "pending",
    reference: "OTHER-PRIVATE",
  });
  m.fake.store.set("feeRecords/c", {
    participantEmail: person.email,
    amount: 9999,
    status: "received",
    reference: "ARCHIVED",
    archivedAt: "2026-10-01",
  });
  actor("superadmin");
});

describe("Role data boundaries over HTTP", () => {
  it.each(accessRoles)(
    "limits record reads and writes for %s",
    async (role: AccessRole) => {
      actor(role);
      for (const resource of [
        "participants",
        "sessions",
        "submissions",
        "fees",
        "users",
        "staff",
        "meals",
        "venues",
      ] as const) {
        const allowed =
          role === "superadmin" || permissions[role].includes(resource);
        expect(
          (await get(`/api/records/${resource}`)).status,
          `${role}: read ${resource}`,
        ).toBe(allowed ? 200 : 403);
        if (!allowed) {
          expect(
            (await post(`/api/records/${resource}`, { data: {} })).status,
          ).toBe(403);
          expect(
            (await post(`/api/records/${resource}/arbitrary/archive`)).status,
          ).toBe(403);
        }
      }
    },
  );

  it("removes financial and raw/internal fields from a custom registration reader", async () => {
    actor("registration_reader", ["participants:read"]);
    const response = await get("/api/records/participants");
    expect(response.status).toBe(200);
    const row = response.body.rows.find((r: any) => r.email === person.email);
    expect(row).toMatchObject({
      workingAs: "Research Scholar",
      district: "DN",
      dob: "1999-01-02",
    });
    for (const key of [
      "registrationFee",
      "feesReceived",
      "original",
      "importSource",
      "searchKeys",
      "accountType",
    ])
      expect(row).not.toHaveProperty(key);
    expect(
      (await post("/api/records/participants", { data: person })).status,
    ).toBe(403);
    expect((await get("/api/fees/workbook")).status).toBe(403);
  });

  it("enforces fee-field write permissions and preserves existing fees on registration-only edits", async () => {
    actor("registration_editor", ["participants:read", "participants:write"]);
    const data = {
      fullName: person.fullName,
      email: person.email,
      mobile: person.mobile,
      affiliation: person.affiliation,
      role: person.role,
      registrationStatus: person.registrationStatus,
      workingAs: "JRF",
    };
    expect(
      (
        await post("/api/records/participants", {
          id: person.email,
          version: 1,
          data: { ...data, registrationFee: 1 },
        })
      ).status,
    ).toBe(403);
    const saved = await post("/api/records/participants", {
      id: person.email,
      version: 1,
      data,
    });
    expect(saved.status).toBe(200);
    expect(m.fake.store.get(`people/${person.email}`)).toMatchObject({
      registrationFee: 500,
      feesReceived: "DD-000123",
      workingAs: "JRF",
    });
  });

  it("shows source references to fee readers without exposing registration demographics", async () => {
    actor("fee_reader", ["fees:read"]);
    const source = await get("/api/fees/workbook?q=dd-000123&limit=1");
    expect(source.status).toBe(200);
    expect(source.body.rows).toHaveLength(1);
    expect(source.body.rows[0]).toMatchObject({
      registrationFee: 500,
      feesReceived: "DD-000123",
    });
    for (const key of [
      "mobile",
      "dob",
      "gender",
      "remark",
      "importSource",
      "original",
    ])
      expect(source.body.rows[0]).not.toHaveProperty(key);
    expect((await post("/api/records/fees", { data: {} })).status).toBe(403);
    expect((await post("/api/records/fees/a/archive")).status).toBe(403);
  });

  it("keeps source references intact when authorized staff manage a fee", async () => {
    actor("registration_manager");
    const result = await post("/api/records/fees", {
      id: "a",
      version: 1,
      data: {
        participantEmail: "PERSON@example.org",
        amount: 500,
        currency: "INR",
        status: "refunded",
        reference: "REFUND-1",
      },
    });
    expect(result.status).toBe(200);
    expect(m.fake.store.get(`people/${person.email}`).feesReceived).toBe(
      "DD-000123",
    );
    expect(m.fake.store.get("feeRecords/a")).toMatchObject({
      status: "refunded",
      participantEmail: person.email,
    });
  });

  it("returns only the signed-in participant's fee records even with another email or cursor supplied", async () => {
    actor("participant");
    const result = await get(
      "/api/profile/fees?email=other@example.org&participantEmail=other@example.org&limit=1",
    );
    expect(result.status).toBe(200);
    expect(result.body.rows).toEqual([
      {
        id: "a",
        amount: 500,
        currency: "INR",
        status: "received",
        reference: "VERIFIED-1",
      },
    ]);
    const afterOther = await get("/api/profile/fees?after=b");
    expect(afterOther.body.rows).toEqual([]);
    const profile = await get("/api/profile?email=other@example.org");
    expect(profile.body.profile.email).toBe(person.email);
    expect(profile.body.profile.feesReceived).toBe("DD-000123");
    for (const key of ["remark", "original", "importSource", "accountType"])
      expect(profile.body.profile).not.toHaveProperty(key);
    expect((await post("/api/records/fees", { data: {} })).status).toBe(403);
  });

  it.each(["archived", "cancelled", "suspended"])(
    "withholds own private data for %s registrations",
    async (state) => {
      actor("participant");
      m.fake.store.set(`people/${person.email}`, {
        ...person,
        ...(state === "archived"
          ? { archivedAt: "2026-10-01" }
          : { registrationStatus: state }),
      });
      expect((await get("/api/profile")).body.profile).toBeNull();
      expect((await get("/api/profile/fees")).body.rows).toEqual([]);
    },
  );

  it("scopes overview data and cache keys to effective read permissions", async () => {
    actor("superadmin");
    expect((await get("/api/overview")).body).toMatchObject({
      mealsServed: 0,
      feeRecords: 2,
      feesReceivedAmount: 500,
    });
    actor("registration_manager");
    const registration = (await get("/api/overview")).body;
    expect(registration).toHaveProperty("registrations");
    expect(registration).toHaveProperty("feeRecords");
    expect(registration).not.toHaveProperty("mealsServed");
    expect(registration).not.toHaveProperty("recentActivity");
    // Keep the registration overview cached while a second user requests a
    // report-only view. Sharing the old counts-only cache key would leak data.
    m.fake.store.set("adminUsers/reader", {
      fullName: "Reader",
      accessRole: "report_reader",
      status: "active",
      conferenceId: "main",
    });
    m.fake.store.set("roleDefinitions/report_reader", {
      name: "Report reader",
      description: "",
      active: true,
      managedRole: true,
      version: 1,
      permissions: ["reports:read"],
    });
    m.verify.mockResolvedValue({
      uid: "reader",
      email: "reader@example.org",
      email_verified: true,
      exp: Date.now() / 1000 + 3600,
      firebase: {},
    });
    m.fake.reads.length = 0;
    expect(
      (
        await api
          .get("/api/overview")
          .set("Authorization", "Bearer second-token")
      ).body,
    ).toEqual({});
    expect(
      m.fake.reads.some((r: any) =>
        ["people", "feeRecords", "importJobs", "mealRedemptions"].includes(
          r.collection,
        ),
      ),
    ).toBe(false);
  });

  it("blocks raw-workbook access without both registration and fee reads", async () => {
    actor("import_reader", ["imports:read", "participants:read"]);
    for (const path of [
      "/api/imports",
      "/api/imports/workbook/job/report",
      "/api/imports/workbook/job/rows-to-fix",
      "/api/import-template",
    ])
      expect((await get(path)).status).toBe(403);
    actor("import_reader", [
      "imports:read",
      "imports:write",
      "participants:read",
      "fees:read",
    ]);
    expect((await get("/api/imports")).status).toBe(200);
    expect((await post("/api/imports/workbook/job/commit")).status).toBe(403);
  });

  it("requires participant read access for exports and omits fees without fee read", async () => {
    actor("report_reader", ["reports:read"]);
    expect((await get("/api/reports/participants")).status).toBe(403);
    actor("report_reader", ["reports:read", "participants:read"]);
    const response = await get("/api/reports/participants")
      .buffer(true)
      .parse((res, callback) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => callback(null, Buffer.concat(chunks)));
      });
    expect(response.status).toBe(200);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body);
    const headers = workbook.worksheets[0].getRow(1).values;
    expect(headers).not.toContain("registrationFee");
    expect(headers).not.toContain("feesReceived");
  });
});
