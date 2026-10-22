import { describe, expect, it } from "vitest";
import { fakeFirestore } from "./fake-firestore.js";
import { registrationCounts } from "../server/overview-counts.js";
describe("overview aggregations", () => {
  it("preserves legacy missing/null fields and excludes overlapping archived/demo records once", async () => {
    const f = fakeFirestore();
    const records = [
      { role: "presenter", registrationStatus: "confirmed" },
      { role: "attendee", isDemo: false, archivedAt: null },
      { role: "speaker", archivedAt: "" },
      { role: "vip", isDemo: true },
      { role: "organiser", archivedAt: "2026-10-01" },
      { role: "volunteer", isDemo: true, archivedAt: "2026-10-01" },
      { role: "new-role", registrationStatus: "confirmed" },
    ];
    records.forEach((r, i) => f.store.set(`people/${i}`, r));
    const old = records.filter((r) => !r.isDemo && !r.archivedAt);
    const counts = await registrationCounts(f.db.collection("people"));
    expect(counts).toEqual({
      registrations: old.length,
      confirmed: 2,
      presenters: 1,
      byRole: {
        presenter: 1,
        attendee: 1,
        speaker: 1,
        vip: 0,
        organiser: 0,
        volunteer: 0,
      },
    });
  });
  it("uses 32 aggregation reads instead of 216 document reads for all registration metrics", async () => {
    const f = fakeFirestore();
    for (let i = 0; i < 216; i++)
      f.store.set(`people/${i}`, {
        role: "presenter",
        registrationStatus: "confirmed",
      });
    expect(
      (await registrationCounts(f.db.collection("people"))).registrations,
    ).toBe(216);
    expect(f.reads.reduce((n, r) => n + r.documents, 0)).toBe(32);
  });
});
