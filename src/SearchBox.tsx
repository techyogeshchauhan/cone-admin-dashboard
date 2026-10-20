import { Search, X } from "lucide-react";

/** True when any value contains the trimmed, case-insensitive query. */
export function matchesSearch(query: string, ...values: unknown[]) {
  const needle = query.trim().toLowerCase();
  return (
    !needle ||
    values.some((v) =>
      String(v ?? "")
        .toLowerCase()
        .includes(needle),
    )
  );
}

/** Live filter for data a page has already loaded; it makes no API calls. */
export default function SearchBox({
  value,
  onChange,
  label,
  shown,
  total,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  shown: number;
  total: number;
}) {
  return (
    <div className="toolbar search-bar" role="search">
      <div className="search">
        <Search size={18} />
        <input
          type="search"
          aria-label={`Search ${label}`}
          placeholder={`Search ${label}...`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onChange("")}
        />
        {value && (
          <button
            type="button"
            className="search-clear"
            aria-label="Clear search"
            onClick={() => onChange("")}
          >
            <X size={15} />
          </button>
        )}
      </div>
      <span className="record-count" aria-live="polite">
        {value.trim() ? `${shown} of ${total} match` : `${total} loaded`}
      </span>
    </div>
  );
}

export function NoMatches({ what, query }: { what: string; query: string }) {
  return (
    <p className="inline-note">
      No {what} match "{query.trim()}".
    </p>
  );
}
