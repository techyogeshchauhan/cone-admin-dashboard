// Keyset pagination for Firestore lists. A page is read with one extra
// document, so the client learns whether more exist without a follow-up
// request, and the cursor is the id of the last document examined. Rows can
// also be filtered in memory (archived, demo or search matches); then further
// batches are read until the page is full, within a bounded scan.
import type { DocumentData, Query } from "firebase-admin/firestore";
import { db } from "./firebase.js";

export const pageSize = (value: unknown, fallback = 25) => {
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? Math.min(n, 100) : fallback;
};

export async function readPage(options: {
  query: Query;
  collection: string;
  limit: number;
  after?: string;
  // Ordered by document id: the cursor needs no lookup.
  byId?: boolean;
  keep?: (data: DocumentData) => boolean;
  maxScan?: number;
}) {
  const { query, collection, limit, keep, byId } = options;
  const rows: (DocumentData & { id: string })[] = [];
  const batch = limit + 1;
  let cursor = options.after;
  let scanned = 0;
  let more = false;
  while (scanned < (options.maxScan ?? 500)) {
    let next = query.limit(batch);
    if (cursor) {
      if (byId) next = next.startAfter(cursor);
      else {
        const at = await db.doc(`${collection}/${cursor}`).get();
        if (!at.exists)
          throw Object.assign(
            new Error("This list changed while you were reading it. Reload."),
            { status: 409 },
          );
        next = next.startAfter(at);
      }
    }
    const snapshot = await next.get();
    scanned += snapshot.size;
    let full = false;
    for (const doc of snapshot.docs) {
      if (rows.length === limit) {
        full = true;
        break;
      }
      cursor = doc.id;
      const data = doc.data();
      if (!keep || keep(data)) rows.push({ id: doc.id, ...data });
    }
    more = full || snapshot.size === batch;
    // A page that filled on the batch's last document may report one more
    // page than exists; that page is then empty, which costs less than a
    // whole extra batch on every page.
    if (full || !more || rows.length === limit) break;
  }
  return { rows, next: more ? (cursor ?? null) : null };
}
