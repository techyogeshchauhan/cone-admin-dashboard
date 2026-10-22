// A small in-memory stand-in for the Firestore query API used by list
// endpoints: where (== and array-contains), orderBy, select, limit,
// startAfter (an id or a snapshot), get and count. It also records how many
// documents each read returned, which is what Firestore bills.
type Data = Record<string, any>;
type Filter = (data: Data) => boolean;

export function fakeFirestore() {
  const store = new Map<string, Data>();
  const reads: { collection: string; documents: number }[] = [];
  const snap = (path: string) => ({
    id: path.split("/").pop()!,
    ref: { path },
    exists: store.has(path),
    data: () =>
      store.has(path) ? structuredClone(store.get(path)) : undefined,
  });
  function query(
    name: string,
    state: {
      filters: Filter[];
      order: [string, "asc" | "desc"][];
      fields?: string[];
      limit?: number;
      after?: string | { id: string };
    } = { filters: [], order: [] },
  ): any {
    const next = (change: Partial<typeof state>) =>
      query(name, { ...state, ...change });
    return {
      where: (field: string, op: string, value: unknown) =>
        next({
          filters: [
            ...state.filters,
            op === "array-contains"
              ? (d) => Array.isArray(d[field]) && d[field].includes(value)
              : (d) => d[field] === value,
          ],
        }),
      orderBy: (field: string, dir: "asc" | "desc" = "asc") =>
        next({ order: [...state.order, [field, dir]] }),
      select: (...fields: string[]) => next({ fields }),
      limit: (limit: number) => next({ limit }),
      startAfter: (after: string | { id: string }) => next({ after }),
      count: () => ({
        get: async () => {
          const size = run().length;
          reads.push({
            collection: name,
            documents: Math.ceil(size / 1000) || 1,
          });
          return { data: () => ({ count: size }) };
        },
      }),
      get: async () => {
        let rows = run();
        if (state.after !== undefined) {
          const id =
            typeof state.after === "string" ? state.after : state.after.id;
          rows =
            typeof state.after === "string"
              ? rows.filter((r) => r.id > id)
              : rows.slice(rows.findIndex((r) => r.id === id) + 1);
        }
        if (state.limit !== undefined) rows = rows.slice(0, state.limit);
        reads.push({ collection: name, documents: rows.length || 1 });
        const docs = rows.map((r) => ({
          ...r,
          data: () => {
            const data = r.data()!;
            return state.fields
              ? Object.fromEntries(
                  state.fields
                    .filter((f) => f in data)
                    .map((f) => [f, data[f]]),
                )
              : data;
          },
        }));
        return { docs, size: docs.length, empty: !docs.length };
      },
    };
    function run() {
      const rows = [...store.keys()]
        .filter((k) => k.startsWith(`${name}/`) && k.split("/").length === 2)
        .map(snap)
        .filter((s) => state.filters.every((f) => f(s.data()!)));
      const order = state.order.length ? state.order : [["__name__", "asc"]];
      return rows.sort((a, b) => {
        for (const [field, dir] of order) {
          const x = field === "__name__" ? a.id : a.data()![field];
          const y = field === "__name__" ? b.id : b.data()![field];
          if (x === y) continue;
          return (x < y ? -1 : 1) * (dir === "desc" ? -1 : 1);
        }
        return a.id < b.id ? -1 : 1;
      });
    }
  }
  const db = {
    collection: (name: string) => ({
      ...query(name),
      doc: (id: string) => db.doc(`${name}/${id}`),
      add: async (data: Data) => {
        store.set(`${name}/auto-${store.size}`, data);
      },
    }),
    doc: (path: string) => ({
      path,
      id: path.split("/").pop(),
      get: async () => {
        reads.push({ collection: path.split("/")[0], documents: 1 });
        return snap(path);
      },
      set: async (data: Data, options?: { merge?: boolean }) =>
        write(path, data, options),
    }),
    // Writes apply when the callback finishes, as in a real transaction.
    runTransaction: async (work: (tx: any) => Promise<unknown>) => {
      const pending: (() => void)[] = [];
      const result = await work({
        get: async (ref: { path: string }) => snap(ref.path),
        set: (
          ref: { path: string },
          data: Data,
          options?: { merge?: boolean },
        ) => pending.push(() => write(ref.path, data, options)),
        create: (ref: { path: string }, data: Data) =>
          pending.push(() => write(ref.path, data)),
        update: (ref: { path: string }, data: Data) =>
          pending.push(() => write(ref.path, data, { merge: true })),
      });
      pending.forEach((apply) => apply());
      return result;
    },
  };
  function write(path: string, data: Data, options?: { merge?: boolean }) {
    store.set(path, options?.merge ? { ...store.get(path), ...data } : data);
  }
  return { db, store, reads };
}
