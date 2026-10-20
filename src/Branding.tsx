import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { request } from "./firebase";
export type Branding = {
  applicationName: string;
  logoId: string | null;
  logoUrl: string | null;
  version: number;
};
const defaults: Branding = {
  applicationName: "CONE",
  logoId: null,
  logoUrl: null,
  version: 0,
};
const base = import.meta.env.VITE_API_BASE_URL || "/api";
const cacheKey = `app-branding:${import.meta.env.VITE_FIREBASE_PROJECT_ID || "default"}:${base}`;
function normalize(value: Branding): Branding {
  return {
    ...value,
    logoUrl: value.logoId ? `${base}/branding/logo/${value.logoId}` : null,
  };
}
const Context = createContext({
  branding: defaults,
  refresh: async () => {},
  updateBranding: (_value: Branding) => {},
});
export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<Branding>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(cacheKey) || "null");
      return value && typeof value.applicationName === "string"
        ? normalize(value)
        : defaults;
    } catch {
      return defaults;
    }
  });
  const refreshId = useRef(0);
  const updateBranding = useCallback((value: Branding) => {
    ++refreshId.current;
    const next = normalize(value);
    setBranding(next);
    try {
      localStorage.setItem(cacheKey, JSON.stringify(next));
    } catch {
      /* Storage may be unavailable. */
    }
  }, []);
  const refresh = useCallback(async () => {
    const id = ++refreshId.current;
    try {
      const response = await fetch(`${base}/branding`, { cache: "no-store" });
      if (!response.ok) return;
      const value = await response.json();
      if (typeof value.applicationName !== "string" || id !== refreshId.current)
        return;
      const next = normalize(value);
      setBranding(next);
      localStorage.setItem(cacheKey, JSON.stringify(next));
    } catch {
      /* Keep the last known branding during network outages. */
    }
  }, []);
  useEffect(() => {
    void refresh();
    const focus = () => void refresh();
    const timer = window.setInterval(() => {
      if (!document.hidden) void refresh();
    }, 30000);
    window.addEventListener("focus", focus);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [refresh]);
  useEffect(() => {
    document.title = `${branding.applicationName} - Conference administration`;
    let icon = document.querySelector<HTMLLinkElement>(
      "link[data-app-branding]",
    );
    if (!branding.logoUrl) {
      icon?.remove();
      return;
    }
    if (!icon) {
      icon = document.createElement("link");
      icon.rel = "icon";
      icon.dataset.appBranding = "true";
      document.head.appendChild(icon);
    }
    icon.href = branding.logoUrl;
  }, [branding]);
  return (
    <Context.Provider value={{ branding, refresh, updateBranding }}>
      {children}
    </Context.Provider>
  );
}
export const useBranding = () => useContext(Context);
export function BrandLogo({
  className = "brand-icon",
}: {
  className?: string;
}) {
  const { branding } = useBranding();
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [branding]);
  return (
    <span className={className}>
      {branding.logoUrl && !failed ? (
        <img
          src={branding.logoUrl}
          alt={`${branding.applicationName} logo`}
          onError={() => setFailed(true)}
        />
      ) : (
        branding.applicationName.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}
export function BrandingEditor() {
  const { branding, refresh, updateBranding } = useBranding();
  const [version, setVersion] = useState(branding.version);
  const [dirty, setDirty] = useState(false);
  const [name, setName] = useState(branding.applicationName),
    [file, setFile] = useState<File | null>(null),
    [remove, setRemove] = useState(false),
    [preview, setPreview] = useState(""),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [note, setNote] = useState("");
  useEffect(() => {
    if (!dirty) {
      setName(branding.applicationName);
      setVersion(branding.version);
    }
  }, [branding.applicationName, branding.version, dirty]);
  useEffect(() => {
    if (!file) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);
  return (
    <section className="panel narrow branding-editor">
      <h2>App Branding</h2>
      <p className="subtitle">
        Update the name and logo across the mobile app and all dashboards.
      </p>
      {error && (
        <p role="alert" className="message">
          {error}
        </p>
      )}
      {note && (
        <p role="status" className="success">
          {note}
        </p>
      )}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = e.currentTarget;
          setBusy(true);
          setError("");
          setNote("");
          try {
            const body = new FormData();
            body.set("applicationName", name);
            body.set("version", String(version));
            body.set("removeLogo", String(remove));
            if (file) body.set("logo", file);
            const saved = await request<Branding>("/settings/branding", {
              method: "POST",
              body,
            });
            updateBranding(saved);
            setName(saved.applicationName);
            setVersion(saved.version);
            setDirty(false);
            setFile(null);
            setRemove(false);
            form.reset();
            setNote(
              "Branding saved. All applications will receive the updated name and logo.",
            );
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Application name
          <input
            disabled={busy}
            value={name}
            onChange={(e) => {
              setDirty(true);
              setName(e.target.value);
            }}
            minLength={2}
            maxLength={100}
            required
          />
        </label>
        <label>
          Application logo
          <input
            disabled={busy}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            onChange={(e) => {
              const next = e.target.files?.[0] || null;
              setError("");
              if (
                next &&
                (!["image/png", "image/jpeg", "image/webp"].includes(
                  next.type,
                ) ||
                  next.size > 2 * 1024 * 1024)
              ) {
                setFile(null);
                setError(
                  "Choose a JPEG, PNG or WebP image of 2 MB or smaller.",
                );
                e.target.value = "";
                return;
              }
              setDirty(true);
              setFile(next);
              setRemove(false);
            }}
          />
        </label>
        <p className="inline-note">
          JPEG, PNG or WebP, up to 2 MB and 4096 pixels per side. The saved logo
          is optimized for display.
        </p>
        {(preview || (!remove && branding.logoUrl)) && (
          <img
            className="branding-preview"
            src={preview || branding.logoUrl!}
            alt="Application logo preview"
          />
        )}
        {branding.logoId && (
          <label className="checkbox">
            <input
              type="checkbox"
              checked={remove}
              disabled={busy}
              onChange={(e) => {
                setDirty(true);
                setRemove(e.target.checked);
                if (e.target.checked) setFile(null);
              }}
            />
            Remove current logo and use the application initial
          </label>
        )}
        <div className="form-actions">
          <button
            type="button"
            className="secondary"
            disabled={busy}
            onClick={() => {
              setDirty(false);
              setName(branding.applicationName);
              setVersion(branding.version);
              void refresh();
              setFile(null);
              setRemove(false);
              setError("");
              setNote("");
            }}
          >
            Reload branding
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "Saving..." : "Save branding"}
          </button>
        </div>
      </form>
    </section>
  );
}
