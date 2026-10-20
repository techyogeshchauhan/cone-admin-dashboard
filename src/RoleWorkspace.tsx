import {
  ArrowUpRight,
  ShieldCheck,
  CalendarDays,
  Users,
  Utensils,
  GraduationCap,
  ClipboardList,
  Layers,
  type LucideIcon,
} from "lucide-react";
import { can, type Actor } from "../shared/schema";
type RoleDesign = {
  label: string;
  title: string;
  description: string;
  accent: string;
  soft: string;
  icon: LucideIcon;
  priorities: string[];
};
const designs: Record<string, RoleDesign> = {
  superadmin: {
    label: "Super Admin",
    title: "One workspace. Complete oversight.",
    description:
      "Keep your people, access policies, and conference operations working together.",
    accent: "#0d9488",
    soft: "#e7f5f2",
    icon: ShieldCheck,
    priorities: ["control", "users", "analysis"],
  },
  conference_admin: {
    label: "Conference Admin",
    title: "Keep your conference on track.",
    description:
      "A clear view of registrations, programme planning, and the teams bringing it all together.",
    accent: "#2563eb",
    soft: "#edf3ff",
    icon: Layers,
    priorities: ["participants", "sessions", "staff"],
  },
  organizer: {
    label: "Organizer",
    title: "Make every part of the event flow.",
    description:
      "Coordinate your participants, programme, and day-to-day conference operations.",
    accent: "#059669",
    soft: "#e9f6ef",
    icon: Users,
    priorities: ["participants", "sessions", "meals"],
  },
  registration_manager: {
    label: "Registration Manager",
    title: "Keep every registration moving.",
    description:
      "Bring participant records, workbook imports, and fee information into one organized workflow.",
    accent: "#0284c7",
    soft: "#eaf5fc",
    icon: ClipboardList,
    priorities: ["participants", "imports", "fees"],
  },
  programme_manager: {
    label: "Programme Manager",
    title: "Build a programme that runs on time.",
    description:
      "Plan sessions, organize papers, and keep the right presentation in the right venue.",
    accent: "#7c3aed",
    soft: "#f2edff",
    icon: CalendarDays,
    priorities: ["sessions", "submissions", "venues"],
  },
  meal_desk: {
    label: "Meal Desk",
    title: "Keep the meal desk moving.",
    description:
      "Check a participant’s coupon, confirm eligibility, and record each meal once.",
    accent: "#c26b0c",
    soft: "#fff5e6",
    icon: Utensils,
    priorities: ["redemptions"],
  },
  participant: {
    label: "Participant",
    title: "Your conference, all in one place.",
    description:
      "Find your registration details and stay connected with your conference programme.",
    accent: "#4f46e5",
    soft: "#eeefff",
    icon: GraduationCap,
    priorities: ["profile"],
  },
};
export const sectionGroups = [
  { title: "Workspace", pages: ["overview", "profile", "control"] },
  { title: "People & access", pages: ["participants", "users"] },
  {
    title: "Conference planning",
    pages: [
      "sessions",
      "submissions",
      "disciplines",
      "venues",
      "staff",
      "conference",
    ],
  },
  {
    title: "Event operations",
    pages: [
      "meals",
      "redemptions",
      "passes",
      "fees",
      "imports",
      "media",
      "email",
    ],
  },
  { title: "System & settings", pages: ["analysis", "audit", "settings"] },
];
export const pageDescriptions: Record<string, string> = {
  overview: "Your conference activity and the next steps that matter.",
  control: "Manage access, configuration, and operations from one place.",
  participants: "Find participants and keep registration details up to date.",
  users: "Manage workspace accounts, roles, and access.",
  sessions: "Organize your sessions, timings, and presentation venues.",
  disciplines: "Keep conference disciplines and categories organized.",
  submissions: "Manage submissions, abstracts, and author information.",
  venues: "Plan the spaces that bring your programme together.",
  staff: "Coordinate responsibilities and VIP liaison assignments.",
  meals: "Configure meal windows and issue participant coupons.",
  redemptions: "Validate a coupon and mark a meal as served.",
  passes: "Issue signed passes and check participant entry.",
  fees: "Track registration fees and administrative payment records.",
  imports: "Bring your workbook data in with a clear review process.",
  media: "A private, organized home for conference images.",
  email: "Manage templates, delivery, and conference communications.",
  conference: "Keep your official conference information accurate.",
  analysis: "Understand application health and the latest code checks.",
  audit: "Trace important actions and administrative changes.",
  settings: "Manage application-wide controls and maintenance.",
  profile: "Your personal conference information and programme.",
};
export function roleDesign(role: string): RoleDesign {
  return (
    designs[role] || {
      label: role.replaceAll("_", " "),
      title: "Your workspace, organized around you.",
      description:
        "The tools and information available for your conference responsibilities.",
      accent: "#0d9488",
      soft: "#e7f5f2",
      icon: Layers,
      priorities: [],
    }
  );
}
export type WorkspaceLink = { key: string; label: string; permission: string };
export function permittedShortcuts(actor: Actor, links: WorkspaceLink[]) {
  const design = roleDesign(actor.role);
  const allowed = links.filter((link) => can(actor, link.permission));
  const ranked = [...design.priorities, ...allowed.map((link) => link.key)];
  return [...new Set(ranked)]
    .map((key) => allowed.find((link) => link.key === key))
    .filter((link): link is WorkspaceLink => !!link && link.key !== "overview")
    .slice(0, 3);
}
export default function RoleWorkspace({
  actor,
  navigate,
  links,
  page = "overview",
}: {
  actor: Actor;
  navigate: (key: string) => void;
  links: WorkspaceLink[];
  page?: string;
}) {
  const design = roleDesign(actor.role);
  const Icon = design.icon;
  const shortcuts = permittedShortcuts(actor, links);
  const sectionCount = links.filter((link) =>
    can(actor, link.permission),
  ).length;
  function open(key: string) {
    if (key === page) {
      document
        .querySelector(".module-area")
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      document
        .querySelector<HTMLInputElement>('.module-area input[name="couponId"]')
        ?.focus({ preventScroll: true });
    } else navigate(key);
  }
  return (
    <section className="role-welcome" aria-label={`${design.label} workspace`}>
      <div className="role-welcome-content">
        <span className="role-kicker">
          <Icon size={15} />
          {design.label} workspace
        </span>
        <h2>{design.title}</h2>
        <p>{design.description}</p>
        <div className="role-shortcuts">
          {shortcuts.map((link, index) => (
            <button
              key={link.key}
              className={
                index === 0 ? "role-primary-action" : "role-secondary-action"
              }
              onClick={() => open(link.key)}
            >
              {link.label}
              <ArrowUpRight size={16} />
            </button>
          ))}
        </div>
      </div>
      <div className="role-welcome-aside" aria-hidden="true">
        <div className="role-emblem">
          <Icon size={35} />
        </div>
        <span>YOUR WORKSPACE</span>
        <strong>{design.label}</strong>
        <small>
          {sectionCount} available {sectionCount === 1 ? "section" : "sections"}{" "}
          · USSTC 2026–27
        </small>
        <div className="role-aside-line">
          <span />
          Ready when you are
        </div>
      </div>
    </section>
  );
}
