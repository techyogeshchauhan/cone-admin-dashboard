import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "./firebase";

// A list read from the API a page at a time ({ rows, next }). Changing the
// path or parameters starts over; a response that arrives after a newer
// request was made is ignored.
export function usePagedList<T extends { id: string }>(
  path: string,
  params: Record<string, string | undefined> = {},
  mode: "append" | "pages" = "append",
) {
  const query = new URLSearchParams(
    Object.entries(params).filter((entry): entry is [string, string] =>
      Boolean(entry[1]),
    ),
  ).toString();
  const [rows, setRows] = useState<T[]>([]),
    [next, setNext] = useState<string | null>(null),
    [loading, setLoading] = useState(true),
    [loaded, setLoaded] = useState(false),
    [error, setError] = useState(""),
    [pageIndex, setPageIndex] = useState(0),
    [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const generation = useRef(0);
  const load = useCallback(
    async (after?: string, targetPage = 0) => {
      const current = ++generation.current;
      setLoading(true);
      setError("");
      try {
        const search = new URLSearchParams(query);
        if (after) search.set("after", after);
        const page = await request<{ rows?: T[]; next?: string | null } | T[]>(
          `${path}${search.size ? `?${search}` : ""}`,
        );
        if (current !== generation.current) return;
        // An API from before pagination answers with a plain array.
        const received = Array.isArray(page) ? page : page.rows || [];
        setRows((old) =>
          after && mode === "append" ? [...old, ...received] : received,
        );
        setNext(Array.isArray(page) ? null : page.next || null);
        if (mode === "pages") {
          setPageIndex(targetPage);
          setCursors((old) => [...old.slice(0, targetPage), after]);
        }
        setLoaded(true);
      } catch (e) {
        if (current === generation.current) setError((e as Error).message);
      } finally {
        if (current === generation.current) setLoading(false);
      }
    },
    [path, query, mode],
  );
  useEffect(() => {
    setRows([]);
    setNext(null);
    setLoaded(false);
    setPageIndex(0);
    setCursors([undefined]);
    void load();
    return () => {
      ++generation.current;
    };
  }, [load]);
  const loadMore = useCallback(() => {
    if (next && !loading) void load(next, pageIndex + 1);
  }, [next, loading, load, pageIndex]);
  return {
    rows,
    setRows,
    next,
    loading,
    loaded,
    error,
    loadMore,
    previousPage: () => {
      if (pageIndex > 0 && !loading)
        void load(cursors[pageIndex - 1], pageIndex - 1);
    },
    pageNumber: pageIndex + 1,
    reload: () =>
      mode === "pages" ? load(cursors[pageIndex], pageIndex) : load(),
  };
}

// Loads the next page when the end of a list scrolls into view; the button
// stays for keyboards and for screens too tall to scroll.
export function LoadMore({
  next,
  loading,
  onLoad,
}: {
  next: string | null;
  loading: boolean;
  onLoad: () => void;
}) {
  const marker = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = marker.current;
    if (!next || loading || !element || !("IntersectionObserver" in window))
      return;
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && onLoad(),
      { rootMargin: "300px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [next, loading, onLoad]);
  if (!next) return null;
  return (
    <div ref={marker} className="load-more">
      <button
        className="secondary"
        disabled={loading}
        aria-busy={loading}
        onClick={onLoad}
      >
        {loading ? "Loading…" : "Load more"}
      </button>
    </div>
  );
}

// Shows a long, already loaded list a screenful at a time, starting over
// when `reset` changes (a new filter, say).
export function useIncremental<T>(items: T[], reset: string, step = 50) {
  const [count, setCount] = useState(step);
  useEffect(() => setCount(step), [reset, step]);
  return {
    shown: items.slice(0, count),
    more: items.length > count ? "more" : null,
    showMore: useCallback(() => setCount((c) => c + step), [step]),
  };
}

export function useDebounced<T>(value: T, delay = 300) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}

// True once the element has come near the screen; used to start costly
// work, such as downloading an image, only for what can be seen.
export function useNearScreen(element: React.RefObject<HTMLElement | null>) {
  const [near, setNear] = useState(!("IntersectionObserver" in window));
  useEffect(() => {
    if (near || !element.current) return;
    const observer = new IntersectionObserver(
      ([entry]) => entry.isIntersecting && setNear(true),
      { rootMargin: "200px" },
    );
    observer.observe(element.current);
    return () => observer.disconnect();
  }, [element, near]);
  return near;
}
