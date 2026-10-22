import { type Query } from "firebase-admin/firestore";

// Legacy records can omit isDemo/archivedAt. An equality-to-null filter would
// silently drop missing fields. Subtract excluded records instead, counting a
// demo+archived record only once. Writers store booleans and ISO date strings.
export async function registrationCounts(
  people: Query,
  read = (query: ReturnType<Query["count"]>) => query.get(),
) {
  const count = async (query: Query) => {
    const archived = query.where("archivedAt", ">", "");
    const demo = query.where("isDemo", "==", true);
    const [all, hidden, demos, overlap] = await Promise.all([
      read(query.count()),
      read(archived.count()),
      read(demo.count()),
      read(archived.where("isDemo", "==", true).count()),
    ]);
    return Math.max(
      0,
      all.data().count -
        hidden.data().count -
        demos.data().count +
        overlap.data().count,
    );
  };
  const roles = [
    "presenter",
    "attendee",
    "speaker",
    "vip",
    "organiser",
    "volunteer",
  ];
  const [registrations, confirmed, ...counts] = await Promise.all([
    count(people),
    count(people.where("registrationStatus", "==", "confirmed")),
    ...roles.map((role) => count(people.where("role", "==", role))),
  ]);
  const byRole = Object.fromEntries(roles.map((role, i) => [role, counts[i]]));
  return { registrations, confirmed, presenters: byRole.presenter, byRole };
}
