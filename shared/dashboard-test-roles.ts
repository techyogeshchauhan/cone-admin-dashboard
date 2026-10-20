import type { AccessRole } from "./schema.js";
export const dashboardTestRoles: {
  role: AccessRole;
  label: string;
  description: string;
}[] = [
  {
    role: "superadmin",
    label: "Super Admin",
    description: "All application and software controls",
  },
  {
    role: "conference_admin",
    label: "Conference Admin",
    description: "Conference operations and event data",
  },
  {
    role: "organizer",
    label: "Organizer",
    description: "Participants, programme, and event management",
  },
  {
    role: "registration_manager",
    label: "Registration Manager",
    description: "Registrations, fee records, and imports",
  },
  {
    role: "programme_manager",
    label: "Programme Manager",
    description: "Sessions, venues, papers, and disciplines",
  },
  {
    role: "meal_desk",
    label: "Meal Desk",
    description: "Meal coupon lookup and redemption",
  },
  {
    role: "participant",
    label: "Participant",
    description: "Participant account view",
  },
];
