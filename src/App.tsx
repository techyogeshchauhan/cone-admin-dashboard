import { useBranding, BrandLogo, BrandingEditor } from "./Branding";
import {
  useEffect,
  useState,
  useRef,
  lazy,
  Suspense,
  type FormEvent,
  type CSSProperties,
} from "react";
import {
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  sendPasswordResetEmail,
  getMultiFactorResolver,
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  RecaptchaVerifier,
  type MultiFactorResolver,
  type MultiFactorError,
  type AuthError,
} from "firebase/auth";
import {
  LayoutDashboard,
  Users,
  ShieldCheck,
  CalendarDays,
  BookOpen,
  Utensils,
  Image,
  FileSpreadsheet,
  Mail,
  Activity,
  Settings,
  ScrollText,
  ChevronRight,
  Search,
  Plus,
  ArrowUpRight,
  ArrowLeft,
  ArrowRight,
  LogOut,
  Menu,
  X,
  LoaderCircle,
  Download,
  Upload,
  CheckCircle2,
  AlertCircle,
  GraduationCap,
  Layers,
  Ticket,
} from "lucide-react";
import { auth, configured, request } from "./firebase";
const EmailCenter = lazy(() => import("./EmailCenter"));
import PassCenter from "./PassCenter";
import ConferenceEditor from "./ConferenceEditor";
import InviteUser from "./InviteUser";
const ImportCenter = lazy(() => import("./ImportCenter"));
import MfaEnrollment from "./MfaEnrollment";
import SearchBox, { matchesSearch, NoMatches } from "./SearchBox";
import RoleWorkspace, {
  roleDesign,
  sectionGroups,
  pageDescriptions,
  permittedShortcuts,
} from "./RoleWorkspace";
const ParticipantWorkspace = lazy(() => import("./ParticipantWorkspace"));
const ControlCenter = lazy(() => import("./ControlCenter"));
import {
  can,
  conferenceRoles,
  accessRoles,
  type Actor,
  type AccessRole,
  type Module,
} from "../shared/schema";
const DevRoleLogins =
  import.meta.env.DEV &&
  import.meta.env.VITE_ENABLE_DASHBOARD_ROLE_LOGIN === "true"
    ? lazy(() => import("./DevRoleLogins"))
    : null;

type Row = Record<string, unknown> & { id: string };
type ParticipantFilter = {
  role?: string;
  status?: string;
  excludeDemo?: boolean;
};
type Field = {
  key: string;
  label: string;
  type?: string;
  options?: readonly string[];
  required?: boolean;
};
const identityFields: Field[] = [
  { key: "fullName", label: "Full name", required: true },
  { key: "email", label: "Email address", type: "email", required: true },
  { key: "mobile", label: "Mobile number", type: "tel", required: true },
];
const fields: Record<Module, Field[]> = {
  venues: [
    { key: "name", label: "Venue name", required: true },
    { key: "location", label: "Location", required: true },
    { key: "capacity", label: "Capacity", type: "number", required: true },
  ],
  staff: [
    {
      key: "staffEmail",
      label: "Organizer / volunteer email",
      type: "email",
      required: true,
    },
    { key: "duty", label: "Duty", required: true },
    { key: "day", label: "Date", type: "date", required: true },
    { key: "start", label: "Start", type: "time", required: true },
    { key: "end", label: "End", type: "time", required: true },
    {
      key: "vipEmail",
      label: "VIP liaison for (optional email)",
      type: "email",
    },
  ],
  fees: [
    {
      key: "participantEmail",
      label: "Participant email",
      type: "email",
      required: true,
    },
    {
      key: "amount",
      label: "Amount (whole INR)",
      type: "number",
      required: true,
    },
    { key: "currency", label: "Currency", options: ["INR"] },
    {
      key: "status",
      label: "Fee status",
      options: ["pending", "received", "waived", "refunded"],
    },
    { key: "reference", label: "Payment / administrative reference" },
  ],
  participants: [
    ...identityFields,
    { key: "affiliation", label: "Affiliation", required: true },
    { key: "role", label: "Conference role", options: conferenceRoles },
    {
      key: "registrationStatus",
      label: "Registration status",
      options: ["pending", "confirmed", "cancelled", "suspended"],
    },
    { key: "discipline", label: "Discipline" },
    {
      key: "category",
      label: "Category",
      options: ["", "I", "II", "III", "IV"],
    },
    {
      key: "presentationType",
      label: "Presentation type",
      options: ["", "O", "P"],
    },
    { key: "registrationFee", label: "Registration fee (INR)", type: "number" },
    { key: "accommodation", label: "Accommodation", options: ["No", "Yes"] },
    { key: "softCopy", label: "Soft copy", options: ["No", "Yes"] },
    { key: "earlierAwardee", label: "Earlier awardee", options: ["No", "Yes"] },
  ],
  users: [
    ...identityFields,
    { key: "accessRole", label: "Dashboard access", options: accessRoles },
    { key: "conferenceId", label: "Conference", options: ["main"] },
    { key: "status", label: "Account status", options: ["active", "disabled"] },
  ],
  sessions: [
    { key: "title", label: "Session title", required: true },
    { key: "day", label: "Date", type: "date", required: true },
    { key: "start", label: "Start", type: "time", required: true },
    { key: "end", label: "End", type: "time", required: true },
    { key: "venue", label: "Venue", required: true },
    {
      key: "kind",
      label: "Kind",
      options: ["general", "session", "presentation", "personal"],
    },
  ],
  disciplines: [
    { key: "name", label: "Discipline name", required: true },
    { key: "code", label: "Code", required: true },
    { key: "oral", label: "Source oral total", type: "number" },
    { key: "poster", label: "Source poster total", type: "number" },
  ],
  submissions: [
    { key: "title", label: "Paper title", required: true },
    { key: "submissionId", label: "Submission ID", required: true },
    {
      key: "presenterEmail",
      label: "Presenter email",
      type: "email",
      required: true,
    },
    { key: "abstractText", label: "Abstract", type: "textarea" },
    {
      key: "authors",
      label: "Authors (one per line)",
      type: "textarea",
      required: true,
    },
    { key: "discipline", label: "Discipline", required: true },
    { key: "category", label: "Category", options: ["I", "II", "III", "IV"] },
    { key: "presentationType", label: "Presentation", options: ["O", "P"] },
  ],
  meals: [
    { key: "day", label: "Date", type: "date", required: true },
    { key: "meal", label: "Meal", options: ["breakfast", "lunch", "dinner"] },
    {
      key: "window",
      label: "Display window (e.g. 08:00–09:30)",
      required: true,
    },
    { key: "opensAt", label: "Opens at (ISO with timezone)", required: true },
    { key: "closesAt", label: "Closes at (ISO with timezone)", required: true },
  ],
};
const navigation = [
  {
    label: "Overview",
    key: "overview",
    icon: LayoutDashboard,
    permission: "reports",
  },
  { label: "My account", key: "profile", icon: Users, permission: "self" },
  {
    label: "Control Center",
    key: "control",
    icon: ShieldCheck,
    permission: "control",
  },
  {
    label: "Participants",
    key: "participants",
    icon: Users,
    permission: "participants",
  },
  {
    label: "Users & access",
    key: "users",
    icon: ShieldCheck,
    permission: "users",
  },
  {
    label: "Programme",
    key: "sessions",
    icon: CalendarDays,
    permission: "sessions",
  },
  {
    label: "Disciplines",
    key: "disciplines",
    icon: Layers,
    permission: "disciplines",
  },
  {
    label: "Papers & authors",
    key: "submissions",
    icon: BookOpen,
    permission: "submissions",
  },
  {
    label: "Meals & coupons",
    key: "meals",
    icon: Utensils,
    permission: "meals",
  },
  {
    label: "Passes & entry",
    key: "passes",
    icon: Ticket,
    permission: "passes",
  },
  {
    label: "Meal desk",
    key: "redemptions",
    icon: Ticket,
    permission: "redemptions",
  },
  { label: "Venues", key: "venues", icon: Layers, permission: "venues" },
  {
    label: "Staff & VIP hosts",
    key: "staff",
    icon: Users,
    permission: "staff",
  },
  { label: "Fee records", key: "fees", icon: BookOpen, permission: "fees" },
  { label: "Media library", key: "media", icon: Image, permission: "media" },
  {
    label: "Excel imports",
    key: "imports",
    icon: FileSpreadsheet,
    permission: "imports",
  },
  { label: "Email / SMTP", key: "email", icon: Mail, permission: "email" },
  {
    label: "Code & system health",
    key: "analysis",
    icon: Activity,
    permission: "analysis",
  },
  {
    label: "Conference",
    key: "conference",
    icon: GraduationCap,
    permission: "conference",
  },
  { label: "Audit log", key: "audit", icon: ScrollText, permission: "audit" },
  {
    label: "Application settings",
    key: "settings",
    icon: Settings,
    permission: "settings",
  },
];
function label(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value).replaceAll("_", " ");
}
function Message({ error }: { error: string }) {
  return error ? (
    <div className="message" role="alert">
      <AlertCircle size={18} />
      {error}
    </div>
  ) : null;
}
function Loading() {
  return (
    <div className="loading">
      <LoaderCircle className="spin" size={22} /> Loading conference data…
    </div>
  );
}
function Empty({
  title = "No records yet",
  description = "Add your first record to get started.",
}) {
  return (
    <div className="empty">
      <Layers size={30} />
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}
export default function App() {
  const { branding } = useBranding();
  const [actor, setActor] = useState<Actor | null>(null),
    [checking, setChecking] = useState(true),
    [error, setError] = useState(""),
    [page, setPage] = useState("overview"),
    [mobile, setMobile] = useState(false),
    [revision, setRevision] = useState(0);
  const [participantFilter, setParticipantFilter] = useState<ParticipantFilter>(
    {},
  );
  const [navSearch, setNavSearch] = useState("");
  // Each page change is a browser history entry, so the toolbar arrows and the
  // browser's own Back/Forward move between dashboard pages.
  const [history, setHistory] = useState({ index: 0, last: 0 });
  function go(next: string) {
    if (next === page) return;
    const index = history.index + 1;
    window.history.pushState({ conePage: next, index }, "");
    setHistory({ index, last: index });
    setPage(next);
  }
  function landOn(next: string) {
    const index = Number(window.history.state?.index) || 0;
    window.history.replaceState({ conePage: next, index }, "");
    setHistory((h) => ({ index, last: Math.max(h.last, index) }));
    setPage(next);
  }
  useEffect(() => {
    const onPop = (event: PopStateEvent) => {
      const state = event.state as { conePage?: string; index?: number } | null;
      if (!state?.conePage) return;
      setPage(state.conePage);
      setHistory((h) => ({ ...h, index: state.index ?? 0 }));
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  const [compact, setCompact] = useState(
    () => window.matchMedia("(max-width:980px)").matches,
  );
  const sidebarRef = useRef<HTMLElement>(null);
  const landedUid = useRef<string | null>(null);
  useEffect(() => {
    const query = window.matchMedia("(max-width:980px)");
    const update = () => {
      setCompact(query.matches);
      if (!query.matches) setMobile(false);
    };
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "auto" });
  }, [page]);
  useEffect(() => {
    if (!mobile) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const toggle = document.querySelector<HTMLButtonElement>(
      '[aria-label="Toggle navigation"]',
    );
    const focusable = () =>
      Array.from(
        sidebarRef.current?.querySelectorAll<HTMLElement>(
          "a[href],button:not([disabled]),input",
        ) || [],
      ).filter((el) => el.offsetParent !== null);
    focusable()[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMobile(false);
      if (event.key === "Tab") {
        const elements = focusable();
        const first = elements[0],
          last = elements.at(-1);
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault();
          last?.focus();
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault();
          first?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
      toggle?.focus();
    };
  }, [mobile]);
  const [workspace, setWorkspace] = useState({
    applicationName: "CONE",
    announcement: "",
  });
  useEffect(() => {
    if (!actor) return;
    let active = true;
    const refresh = async () => {
      try {
        const [me, settings] = await Promise.all([
          request<Actor>("/me"),
          request<typeof workspace>("/workspace-settings"),
        ]);
        if (!active) return;
        setActor(me);
        if (settings.applicationName) setWorkspace(settings);
        const entry = navigation.find((n) => n.key === page);
        if (entry && !can(me, entry.permission))
          landOn(
            navigation.find((n) => can(me, n.permission))?.key || "profile",
          );
      } catch {
        /* A protected page still reports API errors through its existing UI. */
      }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 60000);
    const focus = () => void refresh();
    window.addEventListener("focus", focus);
    return () => {
      active = false;
      clearInterval(timer);
      window.removeEventListener("focus", focus);
    };
  }, [actor?.uid, page]);
  useEffect(() => {
    if (!auth) {
      setChecking(false);
      return;
    }
    // Results from a superseded listener (the retry after sign-in, or a
    // development re-run) are ignored, and only a newly signed-in user is sent
    // to their home page, so a page opened meanwhile is never replaced.
    let active = true;
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!(user && user.uid === landedUid.current)) setChecking(true);
      setError("");
      try {
        if (user) {
          const me = await request<Actor>("/me");
          if (!active) return;
          setActor(me);
          if (landedUid.current !== user.uid) {
            landedUid.current = user.uid;
            landOn(
              navigation.find((n) => can(me, n.permission))?.key || "profile",
            );
          }
        } else {
          landedUid.current = null;
          setActor(null);
        }
      } catch (e) {
        if (!active) return;
        landedUid.current = null;
        setActor(null);
        setError((e as Error).message);
      } finally {
        if (active) setChecking(false);
      }
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [revision]);
  if (checking)
    return (
      <div className="login-screen">
        <Loading />
      </div>
    );
  if (!actor)
    return <Login error={error} retry={() => setRevision((r) => r + 1)} />;
  const current = navigation.find((n) => n.key === page);
  const design = roleDesign(actor.role);
  const allowedNavigation = navigation.filter((n) => can(actor, n.permission));
  const homePage = allowedNavigation[0]?.key || "profile";
  const groups = sectionGroups
    .map((group) => ({
      ...group,
      items: group.pages
        .map((key) => allowedNavigation.find((n) => n.key === key))
        .filter(
          (n): n is (typeof navigation)[number] =>
            !!n && n.label.toLowerCase().includes(navSearch.toLowerCase()),
        ),
    }))
    .filter((group) => group.items.length);
  return (
    <div
      className="shell"
      data-role={actor.role}
      style={
        {
          "--role-accent": design.accent,
          "--role-soft": design.soft,
        } as CSSProperties
      }
    >
      <a className="skip-link" href="#dashboard-content">
        Skip to content
      </a>
      {mobile && (
        <button
          className="navigation-backdrop"
          aria-label="Close navigation"
          onClick={() => setMobile(false)}
        />
      )}
      <aside
        id="dashboard-navigation"
        ref={sidebarRef}
        inert={compact && !mobile}
        className={mobile ? "sidebar open" : "sidebar"}
      >
        <a
          className="brand"
          href="#workspace"
          onClick={(event) => {
            event.preventDefault();
            go(homePage);
            setMobile(false);
          }}
        >
          <BrandLogo />
          <span>
            {branding.applicationName}
            <small>CONFERENCE OPERATIONS</small>
          </span>
        </a>
        <div className="workspace">
          <span className="event-mark">21</span>
          <div>
            <strong>USSTC 2026–27</strong>
            <small>Conference workspace</small>
          </div>
          <ChevronRight size={16} />
        </div>
        <div className="nav-search">
          <Search size={16} />
          <input
            aria-label="Find a feature"
            placeholder="Find a feature…"
            value={navSearch}
            onChange={(e) => setNavSearch(e.target.value)}
          />
          {navSearch && (
            <button
              className="icon-button"
              aria-label="Clear navigation search"
              onClick={() => setNavSearch("")}
            >
              <X size={14} />
            </button>
          )}
        </div>
        <nav aria-label="Main navigation">
          {groups.map((group) => (
            <div className="nav-group" key={group.title}>
              <p className="nav-caption">{group.title}</p>
              {group.items.map((n) => (
                <button
                  key={n.key}
                  className={page === n.key ? "nav-item active" : "nav-item"}
                  aria-current={page === n.key ? "page" : undefined}
                  onClick={() => {
                    go(n.key);
                    setMobile(false);
                    setNavSearch("");
                  }}
                >
                  <n.icon size={18} />
                  {n.label}
                  {page === n.key && <span className="nav-dot" />}
                </button>
              ))}
            </div>
          ))}
          {!groups.length && (
            <p className="nav-empty">
              No matching features. Try a different name.
            </p>
          )}
        </nav>
        <div className="sidebar-footer">
          <div className="secure-label">
            <ShieldCheck size={16} />
            Permission-controlled workspace
          </div>
          <button
            className="account"
            onClick={() => void signOut(auth!)}
            title="Sign out"
          >
            <span className="avatar">{actor.fullName.slice(0, 1)}</span>
            <span>
              <strong>{actor.fullName}</strong>
              <small>{label(actor.role)}</small>
            </span>
            <LogOut size={16} />
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button
            className="icon-button mobile-toggle"
            onClick={() => setMobile(!mobile)}
            aria-label="Toggle navigation"
            aria-expanded={mobile}
            aria-controls="dashboard-navigation"
          >
            <Menu size={22} />
          </button>
          <div className="history-nav">
            <button
              className="icon-button"
              aria-label="Go back"
              title="Back"
              disabled={history.index <= 0}
              onClick={() => window.history.back()}
            >
              <ArrowLeft size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="Go forward"
              title="Forward"
              disabled={history.index >= history.last}
              onClick={() => window.history.forward()}
            >
              <ArrowRight size={17} />
            </button>
          </div>
          <span className="breadcrumb">
            <BrandLogo className="header-brand-logo" />
            <span className="header-app-name">
              {branding.applicationName}
            </span>{" "}
            <ChevronRight size={14} />{" "}
            <strong>{current?.label || "My account"}</strong>
          </span>
          <div className="topbar-right">
            <span className="workspace-role-pill">
              <ShieldCheck size={14} />
              {design.label}
            </span>
            <span className="connection-status">
              <span className="live-dot" /> Signed in securely
            </span>
            <span className="top-avatar">{actor.fullName.slice(0, 1)}</span>
          </div>
        </header>
        <main id="dashboard-content" className="content" tabIndex={-1}>
          <div className="page-heading">
            <div>
              <p className="eyebrow">{design.label} WORKSPACE</p>
              <h1>{current?.label || "My account"}</h1>
              <p className="subtitle">
                {pageDescriptions[page] ||
                  "Your conference workspace, organized around your responsibilities."}
              </p>
            </div>
            <span className="date-chip">
              {new Date().toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
                year: "numeric",
                timeZone: "Asia/Kolkata",
              })}
            </span>
          </div>
          {workspace.announcement && (
            <div className="workspace-announcement" role="status">
              {workspace.announcement}
            </div>
          )}
          <div key={page}>
            {page !== "overview" && page === homePage && (
              <RoleWorkspace
                actor={actor}
                navigate={go}
                links={navigation}
                page={page}
              />
            )}
            <div className="module-area">
              <Suspense fallback={<Loading />}>
                {page === "control" ? (
                  <Suspense fallback={<Loading />}>
                    <ControlCenter navigate={go} />
                  </Suspense>
                ) : page === "overview" ? (
                  <Overview
                    actor={actor}
                    navigate={go}
                    openParticipants={(filter) => {
                      setParticipantFilter(filter);
                      go("participants");
                    }}
                  />
                ) : page in fields ? (
                  <Records
                    module={page as Module}
                    actor={actor}
                    participantFilter={participantFilter}
                    clearFilter={() => setParticipantFilter({})}
                  />
                ) : page === "imports" ? (
                  <ImportCenter />
                ) : page === "media" ? (
                  <Media />
                ) : page === "email" ? (
                  <EmailCenter isSuperAdmin={actor.role === "superadmin"}>
                    <Email />
                  </EmailCenter>
                ) : page === "conference" ? (
                  <ConferenceEditor />
                ) : page === "passes" ? (
                  <PassCenter />
                ) : page === "settings" ? (
                  <SettingsPage />
                ) : page === "analysis" ? (
                  <Analysis />
                ) : page === "redemptions" ? (
                  <Redemptions />
                ) : page === "audit" ? (
                  <LogTable endpoint="audit" />
                ) : (
                  <ParticipantWorkspace actor={actor} />
                )}
              </Suspense>
            </div>
          </div>
          <footer className="page-footer">
            {branding.applicationName} · Conference Operations & Networking
            Environment
            <span>USSTC · Administrative workspace</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
function Login({
  error: externalError,
  retry,
}: {
  error: string;
  retry: () => void;
}) {
  const { branding } = useBranding();
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [note, setNote] = useState(""),
    [resolver, setResolver] = useState<MultiFactorResolver | null>(null),
    [verification, setVerification] = useState("");
  async function loginAsRole(role: AccessRole) {
    if (!auth || busy) return;
    setBusy(true);
    setError("");
    setNote("");
    try {
      const response = await fetch(
        `${import.meta.env.VITE_API_BASE_URL || "/api"}/dev/role-login`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ role }),
        },
      );
      const credentials = (await response.json()) as {
        email: string;
        password: string;
        error?: string;
      };
      if (!response.ok)
        throw new Error(
          credentials.error ||
            "One-click login is unavailable. Check the development flags and restart the API.",
        );
      setResolver(null);
      setVerification("");
      await signInWithEmailAndPassword(
        auth,
        credentials.email,
        credentials.password,
      );
      retry();
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!auth) return;
    setBusy(true);
    setError("");
    const values = new FormData(e.currentTarget);
    try {
      if (resolver) {
        const credential = PhoneAuthProvider.credential(
          verification,
          String(values.get("code")),
        );
        await resolver.resolveSignIn(
          PhoneMultiFactorGenerator.assertion(credential),
        );
        retry();
      } else {
        await signInWithEmailAndPassword(
          auth,
          String(values.get("email")),
          String(values.get("password")),
        );
        retry();
      }
    } catch (err) {
      if ((err as AuthError).code === "auth/multi-factor-auth-required") {
        try {
          const next = getMultiFactorResolver(auth, err as MultiFactorError);
          const verifier = new RecaptchaVerifier(auth, "recaptcha", {
            size: "invisible",
          });
          const id = await new PhoneAuthProvider(auth).verifyPhoneNumber(
            { multiFactorHint: next.hints[0], session: next.session },
            verifier,
          );
          setResolver(next);
          setVerification(id);
        } catch (mfaError) {
          setError((mfaError as Error).message);
        }
      } else setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="login-screen">
      <div className="login-art">
        <BrandLogo />
        <p className="eyebrow">CONFERENCE OPERATIONS & NETWORKING</p>
        <h1>
          A thoughtful space
          <br />
          for every detail.
        </h1>
        <p>
          People. Programme. Possibilities.
          <br />
          Bring your conference together with {branding.applicationName}.
        </p>
        <div className="orbit orbit-one" />
        <div className="orbit orbit-two" />
        <span className="login-art-footer">
          21st Uttarakhand State Science & Technology Congress
        </span>
      </div>
      <div className="login-form">
        <span className="tag">
          <ShieldCheck size={15} /> ADMINISTRATIVE WORKSPACE
        </span>
        <h1>Welcome back.</h1>
        <p className="subtitle">Sign in to manage your conference.</p>
        {!configured && (
          <div className="setup-note">
            <strong>Connect your Firebase project</strong>
            <p>
              Copy <code>.env.example</code> to <code>.env</code>, add your
              Firebase web configuration and server credentials, then restart.
              See the dashboard README for setup.
            </p>
          </div>
        )}
        <Message error={error || externalError} />
        {externalError.includes("second factor") && <MfaEnrollment />}
        <form onSubmit={submit}>
          {resolver ? (
            <label>
              Verification code
              <input name="code" autoComplete="one-time-code" required />
            </label>
          ) : (
            <>
              <label>
                Email address
                <input
                  type="email"
                  name="email"
                  placeholder="you@organization.org"
                  autoComplete="username"
                  required
                />
              </label>
              <label>
                Password
                <input
                  type="password"
                  name="password"
                  autoComplete="current-password"
                  required
                  minLength={6}
                />
              </label>
            </>
          )}
          <button className="primary wide" disabled={!configured || busy}>
            {busy ? <LoaderCircle className="spin" size={18} /> : null}
            {resolver ? "Verify & continue" : "Sign in to workspace"}
            <ArrowUpRight size={18} />
          </button>
        </form>
        <button
          className="text-button"
          onClick={async () => {
            const email = window.prompt("Your Firebase account email");
            if (email && auth)
              try {
                await sendPasswordResetEmail(auth, email);
                setNote("If this account exists, a reset email will be sent.");
              } catch (e) {
                setError((e as Error).message);
              }
          }}
        >
          Forgot your password?
        </button>
        {note && <p className="success">{note}</p>}
        <div id="recaptcha" />
        {DevRoleLogins && (
          <Suspense fallback={null}>
            <DevRoleLogins busy={busy || !configured} onLogin={loginAsRole} />
          </Suspense>
        )}
        <p className="login-hint">
          Access is assigned by your Super Admin. Your mobile app sign-in
          remains unchanged.
        </p>
      </div>
    </div>
  );
}
function Overview({
  navigate,
  actor,
  openParticipants,
}: {
  navigate: (p: string) => void;
  actor: Actor;
  openParticipants: (filter: ParticipantFilter) => void;
}) {
  const [data, setData] = useState<Record<string, unknown> | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    request("/overview")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  if (error) return <Message error={error} />;
  if (!data) return <Loading />;
  const metrics = [
    {
      label: "Total registrations",
      value: data.registrations,
      icon: Users,
      color: "green",
      note: "Excludes demo records",
      target: "participants",
      filter: {},
    },
    {
      label: "Confirmed participants",
      value: data.confirmed,
      icon: CheckCircle2,
      color: "blue",
      note: "Ready for the conference",
      target: "participants",
      filter: { status: "confirmed" },
    },
    {
      label: "Presenters",
      value: data.presenters,
      icon: GraduationCap,
      color: "purple",
      note: "Scientific contributions",
      target: "participants",
      filter: { role: "presenter" },
    },
    {
      label: "Meals served",
      value: data.mealsServed,
      icon: Utensils,
      color: "orange",
      note: "Recorded redemptions",
      target: can(actor, "redemptions", "read") ? "redemptions" : "meals",
      filter: {},
    },
  ];
  const roles = data.byRole as Record<string, number>;
  const max = Math.max(1, ...Object.values(roles));
  return (
    <>
      <RoleWorkspace actor={actor} navigate={navigate} links={navigation} />
      <div className="metrics">
        {metrics.map((m) => (
          <button
            type="button"
            className="metric overview-link"
            key={m.label}
            disabled={!can(actor, m.target, "read")}
            onClick={() =>
              m.target === "participants"
                ? openParticipants({ ...m.filter, excludeDemo: true })
                : navigate(m.target)
            }
            aria-label={`View ${m.label.toLowerCase()}`}
          >
            <div className="metric-copy">
              <div className="metric-top">
                <span className={`metric-icon ${m.color}`}>
                  <m.icon size={19} />
                </span>
                <span>{m.label}</span>
              </div>
              <small>{m.note}</small>
            </div>
            <strong>{label(m.value)}</strong>
          </button>
        ))}
      </div>
      <div className="overview-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>People at the centre</h2>
              <p>Registration breakdown by conference role</p>
            </div>
            <Users size={20} />
          </div>
          <div className="bars">
            {Object.entries(roles).map(([role, count]) => (
              <button
                type="button"
                className="bar-row overview-link"
                key={role}
                disabled={!can(actor, "participants", "read")}
                onClick={() => openParticipants({ role, excludeDemo: true })}
                aria-label={`View ${role === "organiser" ? "organizer" : role} participants`}
              >
                <span>{role === "organiser" ? "Organizer" : role}</span>
                <div className="bar-track">
                  <div style={{ width: `${(count / max) * 100}%` }} />
                </div>
                <strong>{count}</strong>
              </button>
            ))}
          </div>
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Your next steps</h2>
              <p>Shortcuts for your responsibilities</p>
            </div>
          </div>
          {permittedShortcuts(actor, navigation).map((link) => {
            const Icon =
              navigation.find((item) => item.key === link.key)?.icon || Layers;
            return (
              <button
                className="quick-action"
                key={link.key}
                onClick={() => navigate(link.key)}
              >
                <span className="quick-icon">
                  <Icon size={20} />
                </span>
                <span>
                  <strong>{link.label}</strong>
                  <small>{pageDescriptions[link.key]}</small>
                </span>
                <ChevronRight size={18} />
              </button>
            );
          })}
        </section>
      </div>
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>Recent activity</h2>
            <p>
              {can(actor, "audit", "read")
                ? "Latest recorded changes, newest first"
                : "Latest participant imports, newest first"}
            </p>
          </div>
          <button
            className="text-button"
            disabled={
              !can(
                actor,
                can(actor, "audit", "read") ? "audit" : "imports",
                "read",
              )
            }
            onClick={() =>
              navigate(can(actor, "audit", "read") ? "audit" : "imports")
            }
          >
            View {can(actor, "audit", "read") ? "audit log" : "imports"}{" "}
            <ArrowUpRight size={15} />
          </button>
        </div>
        {can(actor, "audit", "read") ? (
          ((data.recentActivity as Row[]) || []).length ? (
            <ol className="activity-list">
              {(data.recentActivity as Row[]).map((item) => {
                const action = String(item.action || "System update");
                const resource = action.split(".")[0];
                const destination = (
                  {
                    user: "users",
                    participants: "participants",
                    sessions: "sessions",
                    submissions: "submissions",
                    import: "imports",
                    imports: "imports",
                    email: "email",
                    smtp: "email",
                    role: "control",
                    runtime: "control",
                    conference: "conference",
                    media: "media",
                    coupons: "meals",
                    fees: "fees",
                    passes: "passes",
                    redemptions: "redemptions",
                  } as Record<string, string>
                )[resource];
                const permitted =
                  destination && can(actor, destination, "read");
                const date = new Date(String(item.createdAt));
                return (
                  <li key={item.id}>
                    <span className="activity-mark">
                      <CheckCircle2 size={18} />
                    </span>
                    <div className="activity-detail">
                      <strong>{action.replace(/[._]/g, " ")}</strong>
                      <span>
                        {String(item.actorName || "System")} ?{" "}
                        {String(item.target || "Application")}
                      </span>
                      <time
                        dateTime={
                          Number.isNaN(date.getTime())
                            ? undefined
                            : date.toISOString()
                        }
                      >
                        {Number.isNaN(date.getTime())
                          ? "Time unavailable"
                          : date.toLocaleString("en-IN", {
                              timeZone: "Asia/Kolkata",
                              day: "numeric",
                              month: "short",
                              hour: "2-digit",
                              minute: "2-digit",
                            })}{" "}
                        IST
                      </time>
                    </div>
                    {permitted && (
                      <button
                        className="text-button"
                        onClick={() =>
                          destination === "participants"
                            ? openParticipants({ excludeDemo: true })
                            : navigate(destination)
                        }
                      >
                        Open <ChevronRight size={15} />
                      </button>
                    )}
                  </li>
                );
              })}
            </ol>
          ) : (
            <Empty
              title="No activity yet"
              description="Recorded administrative changes will appear here."
            />
          )
        ) : ((data.recentImports as Row[]) || []).length ? (
          <Table
            rows={data.recentImports as Row[]}
            columns={["fileName", "status", "total", "createdAt"]}
          />
        ) : (
          <Empty
            title="No activity yet"
            description="Your workbook imports will appear here once you upload them."
          />
        )}
      </section>
    </>
  );
}
function Table({
  rows,
  columns,
  onEdit,
  onDelete,
  deleting,
  deleteBlocked,
  ownUid,
}: {
  rows: Row[];
  columns: string[];
  onEdit?: (r: Row) => void;
  onDelete?: (r: Row) => void;
  deleting?: string;
  deleteBlocked?: string;
  ownUid?: string;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c.replace(/([A-Z])/g, " $1")}</th>
            ))}
            {(onEdit || onDelete) && (
              <th>
                <span className="sr-only">Actions</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((c) => (
                <td key={c}>
                  {[
                    "status",
                    "registrationStatus",
                    "role",
                    "accessRole",
                  ].includes(c) ? (
                    <span
                      className={`badge ${row[c] === "confirmed" || row[c] === "active" || row[c] === "completed" ? "positive" : ""}`}
                    >
                      {label(row[c])}
                    </span>
                  ) : (
                    <span
                      className={
                        c === "fullName" || c === "title" ? "cell-name" : ""
                      }
                    >
                      {label(row[c])}
                    </span>
                  )}
                </td>
              ))}
              {(onEdit || onDelete) && (
                <td>
                  <div className="user-row-actions">
                    {onEdit && (
                      <button
                        className="text-button"
                        disabled={
                          Boolean(deleting) || Boolean(row.deletionPending)
                        }
                        onClick={() => onEdit(row)}
                      >
                        Edit <ChevronRight size={14} />
                      </button>
                    )}
                    {onDelete && (
                      <button
                        className="text-button delete-user-button"
                        disabled={
                          Boolean(deleting) ||
                          Boolean(deleteBlocked) ||
                          row.id === ownUid
                        }
                        aria-label={`Delete ${String(row.fullName || row.title || row.name || row.email || row.id)}`}
                        title={
                          row.id === ownUid
                            ? "You cannot delete your own account"
                            : deleteBlocked || "Delete"
                        }
                        onClick={() => onDelete(row)}
                      >
                        {deleting === row.id
                          ? "Deleting..."
                          : row.deletionPending
                            ? "Retry Delete"
                            : "Delete"}
                      </button>
                    )}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Records({
  module,
  actor,
  participantFilter = {},
  clearFilter,
}: {
  module: Module;
  actor: Actor;
  participantFilter?: ParticipantFilter;
  clearFilter?: () => void;
}) {
  const [deleting, setDeleting] = useState<string>();
  const [success, setSuccess] = useState("");
  const [rows, setRows] = useState<Row[]>([]),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(""),
    [search, setSearch] = useState(""),
    [selected, setSelected] = useState<Row | null | undefined>(),
    [next, setNext] = useState<string | null>(null);
  async function load(after?: string) {
    setLoading(true);
    setError("");
    try {
      const query = new URLSearchParams();
      if (after) query.set("after", after);
      if (module === "participants") {
        if (participantFilter.role) query.set("role", participantFilter.role);
        if (participantFilter.status)
          query.set("status", participantFilter.status);
        if (participantFilter.excludeDemo) query.set("excludeDemo", "true");
      }
      const data = await request<{ rows: Row[]; next: string | null }>(
        `/records/${module}${query.size ? `?${query}` : ""}`,
      );
      setRows((old) => (after ? [...old, ...data.rows] : data.rows));
      setNext(data.next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, [
    module,
    participantFilter.role,
    participantFilter.status,
    participantFilter.excludeDemo,
  ]);
  const columns =
    module === "participants"
      ? ["fullName", "email", "role", "registrationStatus"]
      : module === "users"
        ? ["fullName", "email", "accessRole", "status"]
        : fields[module].slice(0, 4).map((f) => f.key);
  const filtered = rows.filter((r) =>
    Object.values(r).some((v) =>
      String(v).toLowerCase().includes(search.toLowerCase()),
    ),
  );
  return (
    <>
      <Message error={error} />
      {success && (
        <p className="success" role="status">
          {success}
        </p>
      )}
      <section className="panel">
        <div className="toolbar">
          <div className="search">
            <Search size={18} />
            <input
              aria-label="Search loaded records"
              placeholder="Search loaded records…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <span className="record-count">{rows.length} loaded</span>
          {module === "participants" &&
            Object.keys(participantFilter).length > 0 && (
              <div className="filter-summary" role="status">
                <span>
                  Showing:{" "}
                  {participantFilter.role ||
                    participantFilter.status ||
                    "all registrations"}{" "}
                  ? excluding demo records
                </span>
                <button className="text-button" onClick={clearFilter}>
                  Clear filters
                </button>
              </div>
            )}
          {module === "participants" && can(actor, "reports", "read") && (
            <button
              className="secondary"
              onClick={async () => {
                try {
                  download(
                    await request<Blob>("/reports/participants"),
                    "cone-registrations.xlsx",
                  );
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <Download size={16} />
              Export
            </button>
          )}
          <button
            className="primary"
            disabled={!can(actor, module, "write")}
            onClick={() => setSelected(null)}
          >
            <Plus size={17} />
            Add{" "}
            {module === "users"
              ? "user"
              : module === "participants"
                ? "participant"
                : module === "sessions"
                  ? "session"
                  : module === "disciplines"
                    ? "discipline"
                    : module === "submissions"
                      ? "paper"
                      : module === "meals"
                        ? "meal"
                        : "record"}
          </button>
        </div>
        {module === "users" && (
          <p className="inline-note">
            Create a Firebase login with a password, or invite a user by email.
            Dashboard access and conference roles are managed separately.
          </p>
        )}
        {loading && !rows.length ? (
          <Loading />
        ) : filtered.length ? (
          <Table
            rows={filtered}
            columns={columns}
            onEdit={can(actor, module, "write") ? setSelected : undefined}
            ownUid={actor.uid}
            deleting={deleting}
            deleteBlocked={
              ["staff", "submissions"].includes(module)
                ? "Linked duties and papers must be reassigned before deletion"
                : undefined
            }
            onDelete={
              actor.role === "superadmin"
                ? async (row) => {
                    const name = String(
                      row.fullName ||
                        row.title ||
                        row.name ||
                        row.email ||
                        row.id,
                    );
                    if (
                      !window.confirm(
                        module === "users"
                          ? `Permanently delete ${name} (${String(row.email)})? This removes their Firebase login and dashboard access. Conference registration and history are retained. This cannot be undone.`
                          : `Delete ${name}? It will be removed from all lists and the app. Its history stays in the audit log.`,
                      )
                    )
                      return;
                    setDeleting(row.id);
                    setError("");
                    setSuccess("");
                    try {
                      if (module === "users")
                        await request(
                          `/control/users/${encodeURIComponent(row.id)}/delete`,
                          {
                            method: "POST",
                            body: JSON.stringify({
                              version: Number(row.version || 1),
                            }),
                          },
                        );
                      else
                        await request(
                          `/records/${module}/${encodeURIComponent(row.id)}/archive`,
                          { method: "POST" },
                        );
                      setSuccess(
                        module === "users"
                          ? "User login and dashboard access deleted. Conference history retained."
                          : `${name} deleted. Its history is kept in the audit log.`,
                      );
                      await load();
                    } catch (error) {
                      const message = (error as Error).message;
                      await load();
                      setError(message);
                    } finally {
                      setDeleting(undefined);
                    }
                  }
                : undefined
            }
          />
        ) : (
          <Empty
            description={
              can(actor, module, "write")
                ? "Add your first record to get started."
                : "Records will appear here when your administrator publishes them."
            }
          />
        )}
        {next && (
          <button
            className="secondary load-more"
            disabled={loading}
            onClick={() => void load(next)}
          >
            Load more
          </button>
        )}
      </section>
      {module === "users" && <InviteUser />}
      {module === "meals" && <CouponTools />}
      {selected !== undefined && (
        <Editor
          actor={actor}
          module={module}
          row={selected}
          close={() => setSelected(undefined)}
          saved={() => {
            setSuccess("Record and login setup saved successfully.");
            setSelected(undefined);
            void load();
          }}
        />
      )}
    </>
  );
}
function Editor({
  actor,
  module,
  row,
  close,
  saved,
}: {
  module: Module;
  actor: Actor;
  row: Row | null;
  close: () => void;
  saved: () => void;
}) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const [roleOptions, setRoleOptions] = useState<string[]>([...accessRoles]);
  useEffect(() => {
    if (module === "users")
      request<{ id: string; active: boolean }[]>("/control/roles")
        .then((roles) =>
          setRoleOptions(roles.filter((r) => r.active).map((r) => r.id)),
        )
        .catch((e) => setError(e.message));
  }, [module]);
  const editorFields = fields[module].map((f) =>
    f.key === "accessRole" ? { ...f, options: roleOptions } : f,
  );
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    const data = Object.fromEntries(
      editorFields.map((f) => [
        f.key,
        f.type === "number"
          ? Number(form.get(f.key) || 0)
          : form.get(f.key) || "",
      ]),
    );
    try {
      await request(`/records/${module}`, {
        method: "POST",
        body: JSON.stringify({
          id: row?.id,
          version: row?.version || 1,
          data,
        }),
      });
      saved();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="modal-backdrop">
      <section
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="editor-title"
      >
        <div className="panel-heading">
          <div>
            <p className="eyebrow">CONFERENCE DATA</p>
            <h2 id="editor-title">{row ? "Edit record" : "Create a record"}</h2>
          </div>
          <button className="icon-button" onClick={close} aria-label="Close">
            <X />
          </button>
        </div>
        <Message error={error} />
        <form onSubmit={submit}>
          <div className="form-grid">
            {editorFields.map((f) => (
              <label
                key={f.key}
                className={f.type === "textarea" ? "full-width" : ""}
              >
                {f.label}
                {f.required && " *"}
                {f.options ? (
                  <select
                    name={f.key}
                    defaultValue={String(row?.[f.key] ?? f.options[0])}
                  >
                    {f.options.map((o) => (
                      <option key={o} value={o}>
                        {o || "Not set"}
                      </option>
                    ))}
                  </select>
                ) : f.type === "textarea" ? (
                  <textarea
                    name={f.key}
                    required={f.required}
                    defaultValue={String(row?.[f.key] || "")}
                    rows={4}
                  />
                ) : (
                  <input
                    name={f.key}
                    type={f.type || "text"}
                    required={f.required}
                    min={f.type === "number" ? 0 : undefined}
                    defaultValue={String(row?.[f.key] || "")}
                    readOnly={Boolean(row && f.key === "email")}
                  />
                )}
              </label>
            ))}
          </div>
          <div className="form-actions">
            <button type="button" className="secondary" onClick={close}>
              Cancel
            </button>
            {row &&
              can(actor, module, "archive") &&
              !["staff", "submissions"].includes(module) && (
                <button
                  type="button"
                  className="secondary"
                  disabled={busy}
                  onClick={async () => {
                    if (
                      !window.confirm(
                        "Archive this record? Its history will be retained.",
                      )
                    )
                      return;
                    setBusy(true);
                    try {
                      await request(
                        `/records/${module}/${encodeURIComponent(row.id)}/archive`,
                        { method: "POST" },
                      );
                      saved();
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Archive record
                </button>
              )}
            <button className="primary" disabled={busy}>
              {busy ? "Saving…" : "Save record"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function Media() {
  const [rows, setRows] = useState<Row[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [query, setQuery] = useState("");
  const shown = rows.filter((row) => matchesSearch(query, row.name));
  async function load() {
    try {
      setRows(await request<Row[]>("/media"));
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    void load();
  }, []);
  return (
    <>
      <Message error={error} />
      <section className="panel">
        <div className="panel-heading">
          <div>
            <h2>A home for your conference visuals</h2>
            <p>
              Private images stored on your VPS. JPEG, PNG or WebP · up to 5 MB.
            </p>
          </div>
        </div>
        <form
          className="toolbar"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError("");
            const form = e.currentTarget;
            try {
              await request("/media", {
                method: "POST",
                body: new FormData(form),
              });
              form.reset();
              await load();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <input
            type="file"
            name="file"
            accept="image/jpeg,image/png,image/webp"
            required
          />
          <button className="primary" disabled={busy}>
            <Upload size={17} />
            {busy ? "Uploading…" : "Upload image"}
          </button>
        </form>
        {rows.length ? (
          <>
            <SearchBox
              value={query}
              onChange={setQuery}
              label="images by file name"
              shown={shown.length}
              total={rows.length}
            />
            <div className="media-grid">
              {shown.map((row) => (
                <MediaCard
                  key={row.id}
                  row={row}
                  onArchived={() => void load()}
                />
              ))}
            </div>
            {!shown.length && <NoMatches what="images" query={query} />}
          </>
        ) : (
          <Empty
            title="Your media library is ready"
            description="Upload conference branding and other images to your private VPS storage."
          />
        )}
      </section>
    </>
  );
}
function MediaCard({ row, onArchived }: { row: Row; onArchived: () => void }) {
  const [url, setUrl] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let objectUrl = "";
    request<Blob>(`/media/${row.id}/file`)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob);
        if (active) setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [row.id]);
  return (
    <div className="media-card">
      {url ? <img src={url} alt={String(row.name)} /> : <Image size={28} />}
      <strong>{label(row.name)}</strong>
      <small>Private · VPS storage</small>
      <button
        className="text-button"
        onClick={async () => {
          if (
            !window.confirm(
              "Archive this image? Its file will be retained for recovery.",
            )
          )
            return;
          try {
            await request(`/media/${row.id}/archive`, { method: "POST" });
            onArchived();
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        Archive image
      </button>
      {error && <small role="alert">{error}</small>}
    </div>
  );
}
function Email() {
  const [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false);
  return (
    <section className="panel narrow">
      <span className="feature-icon">
        <Mail size={26} />
      </span>
      <h2>Make sure your message arrives.</h2>
      <p className="subtitle">
        Send a connection test using the server's SMTP settings.
      </p>
      <Message error={error} />
      {note && <p className="success">{note}</p>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await request("/email/test", {
              method: "POST",
              body: JSON.stringify({
                email: new FormData(e.currentTarget).get("email"),
              }),
            });
            setNote("Test email sent successfully.");
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label>
          Test recipient
          <input
            type="email"
            name="email"
            required
            placeholder="you@organization.org"
          />
        </label>
        <button className="primary" disabled={busy}>
          {busy ? "Sending…" : "Send test email"}
          <ArrowUpRight size={17} />
        </button>
      </form>
      <p className="inline-note">
        SMTP credentials are configured on the server. Firebase continues to
        handle the mobile app's sign-in emails.
      </p>
    </section>
  );
}
function SettingsPage() {
  return (
    <>
      <BrandingEditor />
      <ApplicationControls />
    </>
  );
}
function ApplicationControls() {
  const [data, setData] = useState<Record<string, unknown> | null>(null),
    [error, setError] = useState(""),
    [note, setNote] = useState("");
  useEffect(() => {
    request("/settings")
      .then(setData)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="panel narrow">
      <h2>Application controls</h2>
      <p className="subtitle">Global settings available to the Super Admin.</p>
      <Message error={error} />
      {note && <p className="success">{note}</p>}
      {data ? (
        <>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              const form = new FormData(e.currentTarget);
              try {
                await request("/settings", {
                  method: "PUT",
                  body: JSON.stringify({
                    maintenanceMode: form.has("maintenanceMode"),
                    registrationOpen: form.has("registrationOpen"),
                  }),
                });
                setNote("Settings saved.");
              } catch (e) {
                setError((e as Error).message);
              }
            }}
          >
            <label className="checkbox">
              <input
                type="checkbox"
                name="maintenanceMode"
                defaultChecked={Boolean(data.maintenanceMode)}
              />
              Maintenance mode
            </label>
            <label className="checkbox">
              <input
                type="checkbox"
                name="registrationOpen"
                defaultChecked={Boolean(data.registrationOpen)}
              />
              Registration open
            </label>
            <button className="primary">Save settings</button>
          </form>
          <p className="inline-note">
            URLs, storage directories, and Firebase configuration are managed
            through the deployment environment. Configure mail in Email / SMTP.
            Maintenance mode applies to this dashboard; registration-open is
            metadata for future public/mobile integration.
          </p>
          <pre>
            {JSON.stringify(
              { smtp: data.smtp, mfaRequired: data.mfaRequired },
              null,
              2,
            )}
          </pre>
        </>
      ) : (
        !error && <Loading />
      )}
    </section>
  );
}
function Analysis() {
  const [health, setHealth] = useState<Record<string, unknown> | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    request("/system-health")
      .then(setHealth)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <>
      <Message error={error} />
      <section className="panel">
        <h2>System health</h2>
        <p className="subtitle">Live checks from your administrative API.</p>
        {health ? (
          <div className="health-grid">
            {Object.entries(health).map(([key, value]) => (
              <div className="health-item" key={key}>
                <Activity size={20} />
                <strong>{key}</strong>
                <span>{label(value)}</span>
              </div>
            ))}
          </div>
        ) : (
          !error && <Loading />
        )}
      </section>
      <LogTable endpoint="analysis" />
      <p className="inline-note">
        Analysis reports are written by trusted CI or operations tooling.
        Missing reports do not imply passing checks. The dashboard does not
        execute shell commands.
      </p>
    </>
  );
}
function LogTable({
  endpoint,
}: {
  endpoint: "audit" | "analysis" | "imports" | "redemptions";
}) {
  const [rows, setRows] = useState<Row[] | null>(null),
    [error, setError] = useState(""),
    [query, setQuery] = useState("");
  useEffect(() => {
    request<Row[]>(`/${endpoint}`)
      .then(setRows)
      .catch((e) => setError(e.message));
  }, [endpoint]);
  const columns =
    endpoint === "audit"
      ? ["actorName", "action", "target", "createdAt"]
      : endpoint === "analysis"
        ? ["tool", "result", "buildId", "generatedAt"]
        : endpoint === "imports"
          ? ["fileName", "status", "total", "createdAt"]
          : ["couponId", "participantEmail", "meal", "day"];
  const shownRows = (rows || []).filter((row) =>
    matchesSearch(query, ...columns.map((c) => row[c])),
  );
  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>
          {endpoint === "audit"
            ? "Activity history"
            : endpoint === "analysis"
              ? "Code analysis reports"
              : endpoint === "imports"
                ? "Import history"
                : "Meal redemption history"}
        </h2>
        <span className="record-count">Up to 100 records</span>
      </div>
      <Message error={error} />
      {rows ? (
        rows.length ? (
          <>
            <SearchBox
              value={query}
              onChange={setQuery}
              label={
                endpoint === "audit"
                  ? "activity by person, action or target"
                  : endpoint === "analysis"
                    ? "reports by tool, result or build"
                    : endpoint === "imports"
                      ? "imports by workbook or status"
                      : "redemptions by coupon, email or meal"
              }
              shown={shownRows.length}
              total={rows.length}
            />
            <Table rows={shownRows} columns={columns} />
            {!shownRows.length && <NoMatches what="records" query={query} />}
          </>
        ) : (
          <Empty
            title="No activity recorded"
            description="Records will appear here when operations are completed."
          />
        )
      ) : (
        !error && <Loading />
      )}
    </section>
  );
}
function CouponTools() {
  const [error, setError] = useState(""),
    [note, setNote] = useState("");
  return (
    <section className="panel">
      <h2>Issue meal coupons</h2>
      <p className="subtitle">
        Issue configured meal slots to a confirmed participant. Already-issued
        slots are preserved.
      </p>
      <Message error={error} />
      {note && <p className="success">{note}</p>}
      <form
        className="toolbar"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            const result = await request<{ issued: number }>("/coupons/issue", {
              method: "POST",
              body: JSON.stringify({
                email: new FormData(e.currentTarget).get("email"),
              }),
            });
            setNote(`${result.issued} new coupons issued.`);
          } catch (e) {
            setError((e as Error).message);
          }
        }}
      >
        <input
          type="email"
          name="email"
          placeholder="Participant email"
          aria-label="Participant email"
          required
        />
        <button className="primary">Issue coupons</button>
      </form>
    </section>
  );
}
function Redemptions() {
  const [error, setError] = useState(""),
    [note, setNote] = useState("");
  return (
    <>
      <section className="panel narrow">
        <h2>Meal desk</h2>
        <p className="subtitle">
          Enter the coupon ID from the participant's QR code.
        </p>
        <Message error={error} />
        {note && <p className="success">{note}</p>}
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setError("");
            setNote("");
            try {
              await request("/coupons/redeem", {
                method: "POST",
                body: JSON.stringify({
                  couponId: new FormData(e.currentTarget).get("couponId"),
                }),
              });
              setNote("Meal served. This coupon is now used.");
            } catch (e) {
              setError((e as Error).message);
            }
          }}
        >
          <label>
            Coupon ID
            <input name="couponId" required />
          </label>
          <button className="primary">Mark as served</button>
        </form>
      </section>
      <LogTable endpoint="redemptions" />
    </>
  );
}
