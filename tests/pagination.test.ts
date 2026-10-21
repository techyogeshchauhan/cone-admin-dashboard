import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeFirestore } from "./fake-firestore.js";
const fake = vi.hoisted(() => ({ value: null as any }));
vi.mock("../server/firebase.js", () => ({
  get db() {
    return fake.value.db;
  },
}));
import { pageSize, readPage } from "../server/pagination.js";

describe("readPage", () => {
  beforeEach(() => {
    fake.value = fakeFirestore();
    for (let i = 1; i <= 7; i++)
      fake.value.store.set(`items/i${i}`, {
        n: i,
        archived: i % 2 === 0,
        at: `2026-10-0${i}`,
      });
  });
  const items = () => fake.value.db.collection("items");
  it("reads one extra document to know whether another page exists", async () => {
    const first = await readPage({
      query: items().orderBy("__name__"),
      collection: "items",
      limit: 3,
      byId: true,
    });
    expect(first.rows.map((r) => r.id)).toEqual(["i1", "i2", "i3"]);
    expect(first.next).toBe("i3");
    expect(fake.value.reads).toEqual([{ collection: "items", documents: 4 }]);
    const last = await readPage({
      query: items().orderBy("__name__"),
      collection: "items",
      limit: 3,
      byId: true,
      after: "i6",
    });
    expect(last).toEqual({
      rows: [expect.objectContaining({ id: "i7" })],
      next: null,
    });
  });
  it("continues past rows filtered out in memory until the page is full", async () => {
    const page = await readPage({
      query: items().orderBy("__name__"),
      collection: "items",
      limit: 3,
      byId: true,
      keep: (d) => !d.archived,
    });
    expect(page.rows.map((r) => r.n)).toEqual([1, 3, 5]);
    expect(page.next).toBe("i5");
    const rest = await readPage({
      query: items().orderBy("__name__"),
      collection: "items",
      limit: 3,
      byId: true,
      keep: (d) => !d.archived,
      after: page.next!,
    });
    expect(rest).toEqual({
      rows: [expect.objectContaining({ n: 7 })],
      next: null,
    });
  });
  it("stops a sparse search at the scan limit and hands back a cursor", async () => {
    const page = await readPage({
      query: items().orderBy("__name__"),
      collection: "items",
      limit: 2,
      byId: true,
      keep: () => false,
      maxScan: 3,
    });
    expect(page.rows).toEqual([]);
    expect(page.next).toBe("i3");
  });
  it("resumes a newest-first list from the previous page's last document", async () => {
    const query = items().orderBy("at", "desc");
    const first = await readPage({ query, collection: "items", limit: 2 });
    expect(first.rows.map((r) => r.n)).toEqual([7, 6]);
    const second = await readPage({
      query,
      collection: "items",
      limit: 2,
      after: first.next!,
    });
    expect(second.rows.map((r) => r.n)).toEqual([5, 4]);
  });
  it("asks for a reload when the cursor document has gone", async () => {
    await expect(
      readPage({
        query: items().orderBy("at", "desc"),
        collection: "items",
        limit: 2,
        after: "deleted",
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("keeps page sizes between 1 and 100", () => {
    expect([
      pageSize(undefined),
      pageSize("10"),
      pageSize("500"),
      pageSize("-1"),
      pageSize("x", 24),
    ]).toEqual([25, 10, 100, 25, 24]);
  });
});
