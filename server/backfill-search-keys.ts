// Adds `searchKeys` to participants and dashboard accounts saved before
// server-side search existed. Only documents whose keys differ are written.
//
//   npm run backfill:search-keys -- [--dry-run]
import { db } from "./firebase.js";
import { personSearchKeys } from "../shared/search.js";
import { firebaseOutage } from "./firebase-errors.js";

const dryRun = process.argv.includes("--dry-run");
try {
  for (const collection of ["people", "adminUsers"]) {
    let after: FirebaseFirestore.QueryDocumentSnapshot | undefined;
    let read = 0,
      changed = 0;
    for (;;) {
      let query = db
        .collection(collection)
        .orderBy("__name__")
        .select("fullName", "email", "mobile", "searchKeys")
        .limit(300);
      if (after) query = query.startAfter(after);
      const page = await query.get();
      if (page.empty) break;
      read += page.size;
      const batch = db.batch();
      let writes = 0;
      for (const doc of page.docs) {
        const keys = personSearchKeys(doc.data());
        if (JSON.stringify(keys) === JSON.stringify(doc.data().searchKeys))
          continue;
        batch.update(doc.ref, { searchKeys: keys });
        writes++;
      }
      if (writes && !dryRun) await batch.commit();
      changed += writes;
      after = page.docs.at(-1);
    }
    console.log(
      `${collection}: ${read} read, ${changed} ${dryRun ? "would be updated" : "updated"}`,
    );
  }
} catch (error) {
  // Already written batches stay written; running again resumes safely.
  console.error(firebaseOutage(error)?.message ?? error);
  process.exit(1);
}
process.exit(0);
