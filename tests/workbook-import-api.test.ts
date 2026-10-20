import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import supertest from "supertest";
import ExcelJS from "exceljs";
import { registrationWorkbookBuffer } from "./registration-fixture.js";
// An in-memory Firestore with the transaction semantics the import relies on.
const m = vi.hoisted(() => {
  process.env.STORAGE_ROOT = `${process.env.TEMP || process.env.TMPDIR || "/tmp"}/cone-workbook-import-test`;
  process.env.IMPORT_RETRY_DELAY_MS = "0";
  const store = new Map<string, any>();
  // flaky: the next N transactions fail; failPath: reads of it always fail.
  const network = { flaky: 0, failPath: "" };
  let seq = 0;
  const snap = (path: string): any => ({
    ref: { path },
    exists: store.has(path),
    id: path.split("/").pop(),
    data: () =>
      store.has(path) ? JSON.parse(JSON.stringify(store.get(path))) : undefined,
  });
  const write = {
    create(path: string, data: any) {
      if (store.has(path)) throw new Error(`Document already exists: ${path}`);
      store.set(path, data);
    },
    update(path: string, data: any) {
      if (!store.has(path)) throw new Error(`No document: ${path}`);
      store.set(path, { ...store.get(path), ...data });
    },
    set(path: string, data: any, options?: { merge?: boolean }) {
      store.set(path, options?.merge ? { ...store.get(path), ...data } : data);
    },
  };
  const ref = (path: string): any => ({
    path,
    id: path.split("/").pop(),
    get: async () => snap(path),
    create: async (data: any) => write.create(path, data),
    update: async (data: any) => write.update(path, data),
    set: async (data: any, options?: any) => write.set(path, data, options),
    collection: (name: string) => collection(`${path}/${name}`),
  });
  const collection = (name: string) => ({
    doc: (id?: string) => ref(`${name}/${id ?? `auto-${++seq}`}`),
    add: async (data: any) => write.create(`${name}/auto-${++seq}`, data),
    limit: () => ({
      get: async () => ({
        docs: [...store.keys()]
          .filter((k) => k.startsWith(`${name}/`))
          .map((k) => snap(k)),
      }),
    }),
    where: (field: string, _op: "==", value: unknown) => {
      const query = {
        select: () => query,
        get: async () => {
          const docs = [...store.entries()]
            .filter(
              ([k, v]) =>
                k.startsWith(`${name}/`) &&
                k.split("/").length === name.split("/").length + 1 &&
                v[field] === value,
            )
            .map(([k]) => snap(k));
          return { docs, size: docs.length };
        },
      };
      return query;
    },
  });
  const db = {
    doc: ref,
    collection,
    getAll: async (...refs: { path: string }[]) =>
      refs.map((r) => snap(r.path)),
    runTransaction: async (fn: (tx: any) => Promise<unknown>) => {
      if (network.flaky > 0) {
        network.flaky--;
        throw new Error("Client network socket disconnected (ECONNRESET)");
      }
      const pending: (() => void)[] = [];
      const result = await fn({
        get: async (r: any) => {
          if (r.path === network.failPath)
            throw new Error("timeout of 25000ms exceeded");
          return snap(r.path);
        },
        create: (r: any, d: any) => pending.push(() => write.create(r.path, d)),
        update: (r: any, d: any) => pending.push(() => write.update(r.path, d)),
        set: (r: any, d: any, o?: any) =>
          pending.push(() => write.set(r.path, d, o)),
      });
      pending.forEach((apply) => apply());
      return result;
    },
  };
  return {
    store,
    network,
    db,
    verifyIdToken: vi.fn(),
    ensureIdentity: vi.fn(),
    ensureParticipantAccess: vi.fn(),
  };
});
vi.mock("../server/firebase.js", () => ({
  db: m.db,
  auth: { verifyIdToken: m.verifyIdToken },
}));
vi.mock("../server/accounts.js", async (original) => ({
  ...(await original<typeof import("../server/accounts.js")>()),
  ensureIdentity: m.ensureIdentity,
  ensureParticipantAccess: m.ensureParticipantAccess,
}));
import { app } from "../server/index.js";
const api = supertest(app);
const people = () =>
  [...m.store.keys()].filter((k) => k.startsWith("people/")).sort();
async function preview(fields: Record<string, string> = {}) {
  let call = api
    .post("/api/imports/workbook/preview")
    .set("Authorization", "Bearer token")
    .attach("file", await registrationWorkbookBuffer(), "registrations.xlsx");
  for (const [key, value] of Object.entries(fields))
    call = call.field(key, value);
  return call;
}
const commit = (id: string) =>
  api
    .post(`/api/imports/workbook/${id}/commit`)
    .set("Authorization", "Bearer token");
// Saving runs in the background: start it, then wait for the job to finish.
async function save(id: string) {
  const started = await commit(id);
  expect(started.status).toBe(202);
  for (let i = 0; i < 500; i++) {
    if (m.store.get(`importJobs/${id}`).status !== "running") break;
    await new Promise((resolve) => setTimeout(resolve, 2));
  }
  return m.store.get(`importJobs/${id}`);
}

describe("full registration workbook import", () => {
  beforeEach(() => {
    m.store.clear();
    m.store.set("adminUsers/organizer-uid", {
      fullName: "Organizer",
      accessRole: "organizer",
      status: "active",
      conferenceId: "main",
    });
    m.verifyIdToken.mockResolvedValue({
      uid: "organizer-uid",
      email: "organizer@example.org",
      email_verified: true,
      firebase: {},
    });
    m.ensureIdentity.mockImplementation(async (email: string) => ({
      account: { uid: `uid-${email}` },
      created: true,
    }));
    m.ensureParticipantAccess.mockResolvedValue(undefined);
    m.network.flaky = 0;
    m.network.failPath = "";
  });
  afterEach(() => vi.clearAllMocks());

  it("previews every sheet without writing participants", async () => {
    const response = await preview();
    expect(response.status).toBe(200);
    expect(response.body.rows).toHaveLength(5);
    expect(people()).toEqual([]);
    expect(m.store.get(`importJobs/${response.body.id}`)).toMatchObject({
      kind: "registrationWorkbook",
      status: "preview",
      mode: "create",
      total: 5,
      valid: 2,
      needsFix: 2,
      duplicates: 1,
    });
  });

  it("saves the original data of every row and creates participants with login only for ready rows", async () => {
    const { body } = await preview();
    expect(await save(body.id)).toMatchObject({
      status: "completed",
      processed: 5,
      created: 2,
      updated: 0,
      existing: 0,
      needsFix: 2,
      duplicates: 1,
      loginReady: 2,
      loginFailed: 0,
      rowErrors: 0,
    });
    expect(people()).toEqual([
      "people/asha@example.org",
      "people/kiran@example.org",
    ]);
    expect(m.store.get("people/asha@example.org")).toMatchObject({
      fullName: "Asha Rawat",
      mobile: "9876543210",
      role: "presenter",
      isDemo: false,
      coupons: [],
      paper: { submissionId: "ABS-3-1" },
      importSource: { jobId: body.id, sheet: "Chemical Sciences", row: 5 },
    });
    const originals = [...m.store.entries()].filter(([k]) =>
      k.startsWith("registrationRows/"),
    );
    expect(originals).toHaveLength(5);
    expect(originals.map(([, v]) => v.outcome).sort()).toEqual([
      "created",
      "created",
      "duplicate",
      "needs_fix",
      "needs_fix",
    ]);
    const ravi = originals.find(([, v]) => v.email === "ravi@example.org")![1];
    expect(ravi.original["Name of Author(S)"]).toBe("Ravi Negi");
    expect(ravi.errors).toContain("Mobile is missing");
    expect(m.ensureIdentity).toHaveBeenCalledTimes(2);
    expect(m.ensureParticipantAccess).toHaveBeenCalledWith(
      "uid-asha@example.org",
      {
        email: "asha@example.org",
        fullName: "Asha Rawat",
        mobile: "9876543210",
      },
      "organizer-uid",
    );
    expect((await commit(body.id)).status).toBe(409);
    expect(m.store.get(`workbookSummaries/${body.id}-1`)).toMatchObject({
      sheet: "MAIN",
      importJobId: body.id,
      headerRows: 2,
      title: "21st Conference — discipline summary",
    });
  });

  it("shows the MAIN sheet and rows to fix before and after saving, and downloads them as Excel", async () => {
    const { body } = await preview();
    const report = (id: string) =>
      api
        .get(`/api/imports/workbook/${id}/report`)
        .set("Authorization", "Bearer token");
    const before = await report(body.id);
    expect(before.status).toBe(200);
    expect(before.body.summaries.map((s: any) => s.sheet)).toEqual(["MAIN"]);
    expect(before.body.rowsToFix.map((r: any) => r.status)).toEqual([
      "needs_fix",
      "needs_fix",
      "duplicate",
    ]);
    await save(body.id);
    const after = await report(body.id);
    expect(after.body.job).toMatchObject({ status: "completed", created: 2 });
    expect(after.body.summaries[0].rows).toHaveLength(4);
    expect(after.body.rowsToFix).toHaveLength(3);
    expect(after.body.rowsToFix[0]).toMatchObject({
      sheet: "Chemical Sciences",
      row: 6,
      email: "ravi@example.org",
      problems: ["Mobile is missing"],
    });

    const download = await api
      .get(`/api/imports/workbook/${body.id}/rows-to-fix`)
      .set("Authorization", "Bearer token")
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => done(null, Buffer.concat(chunks)));
      });
    expect(download.status).toBe(200);
    expect(download.headers["content-type"]).toContain("spreadsheetml");
    const book = new ExcelJS.Workbook();
    await book.xlsx.load(download.body);
    const fix = book.getWorksheet("Rows to fix")!;
    expect(fix.rowCount).toBe(4);
    expect(fix.getRow(1).getCell(4).text).toBe("Problem");
    expect(fix.getRow(2).getCell(4).text).toBe("Mobile is missing");
    const main = book.getWorksheet("MAIN")!;
    expect(main.getCell("A1").text).toBe(
      "21st Conference — discipline summary",
    );
    expect(main.getCell("C3").text).toBe("Oral");
    expect(main.model.merges).toEqual(
      expect.arrayContaining(["A3:A4", "C3:E3", "F3:G4", "A6:B6"]),
    );
  });

  it("keeps existing participants in create mode and protects demo data and coupon roles in update mode", async () => {
    m.store.set("people/asha@example.org", {
      fullName: "Asha R.",
      role: "attendee",
      coupons: [{ couponId: "C1" }],
      version: 3,
    });
    m.store.set("couponIndex/C1", { fullName: "Asha R." });
    m.store.set("people/kiran@example.org", { fullName: "Demo", isDemo: true });
    const kept = await save((await preview()).body.id);
    expect(kept).toMatchObject({ created: 0, existing: 2 });
    expect(m.store.get("people/asha@example.org").fullName).toBe("Asha R.");

    const updated = await save((await preview({ mode: "update" })).body.id);
    expect(updated).toMatchObject({ updated: 1, existing: 1 });
    expect(m.store.get("people/asha@example.org")).toMatchObject({
      fullName: "Asha Rawat",
      role: "attendee",
      version: 4,
    });
    expect(m.store.get("couponIndex/C1").fullName).toBe("Asha Rawat");
    expect(m.store.get("people/kiran@example.org")).toEqual({
      fullName: "Demo",
      isDemo: true,
    });
  });

  it("leaves a failed login setup open for Retry and completes it without duplicating rows", async () => {
    let authDown = true;
    m.ensureIdentity.mockImplementation(async (email: string) => {
      if (authDown && email === "kiran@example.org")
        throw new Error("Auth unavailable");
      return { account: { uid: `uid-${email}` }, created: true };
    });
    const { body } = await preview();
    expect(await save(body.id)).toMatchObject({
      status: "failed",
      created: 2,
      loginReady: 1,
      loginFailed: 1,
      rowErrors: 0,
    });
    authDown = false;
    expect(await save(body.id)).toMatchObject({
      status: "completed",
      created: 2,
      loginReady: 1,
      loginFailed: 0,
    });
    expect(people()).toHaveLength(2);
    const failed = [...m.store.values()].filter(
      (v) => v.importJobId === body.id && v.login === "failed",
    );
    expect(failed).toEqual([]);
  });

  it("retries dropped network calls so a flaky connection still saves every row", async () => {
    const { body } = await preview();
    m.network.flaky = 2;
    expect(await save(body.id)).toMatchObject({
      status: "completed",
      created: 2,
      needsFix: 2,
      duplicates: 1,
      rowErrors: 0,
    });
  });

  it("keeps saving other rows when one keeps failing, then Retry saves only what is missing", async () => {
    const { body } = await preview();
    m.network.failPath = "people/kiran@example.org";
    const first = await save(body.id);
    expect(first).toMatchObject({
      status: "failed",
      created: 1,
      needsFix: 2,
      duplicates: 1,
      rowErrors: 1,
    });
    expect(first.lastError).toMatch(/Physical Sciences row 3: timeout/);
    expect(people()).toEqual(["people/asha@example.org"]);

    m.network.failPath = "";
    expect(await save(body.id)).toMatchObject({
      status: "completed",
      created: 2,
      rowErrors: 0,
    });
    expect(people()).toHaveLength(2);
    expect(
      [...m.store.keys()].filter((k) => k.startsWith("registrationRows/")),
    ).toHaveLength(5);
    expect(m.ensureIdentity).toHaveBeenCalledTimes(2);
  });

  it("reports a run cut off by a server restart as stalled and lets Retry finish it", async () => {
    const { body } = await preview();
    m.store.set(`importJobs/${body.id}`, {
      ...m.store.get(`importJobs/${body.id}`),
      status: "running",
      processed: 3,
      leaseUntil: new Date(Date.now() - 1000).toISOString(),
    });
    const status = await api
      .get(`/api/imports/workbook/${body.id}/status`)
      .set("Authorization", "Bearer token");
    expect(status.body).toMatchObject({
      status: "running",
      processed: 3,
      stalled: true,
    });
    expect(await save(body.id)).toMatchObject({
      status: "completed",
      created: 2,
    });
  });
});
