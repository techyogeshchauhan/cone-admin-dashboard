// Role-based email templates and the per-recipient placeholders they use.
// Placeholders are filled from each recipient's own registration when a
// message is queued, so one template gives every person their own details.

type ScheduleItem = {
  day?: string;
  start?: string;
  end?: string;
  title?: string;
  venue?: string | null;
  kind?: string;
};
type Coupon = { day?: string; meal?: string; window?: string };
export type PersonRecord = {
  fullName?: string;
  role?: string;
  registrationId?: string;
  passId?: string;
  affiliation?: string;
  designation?: string | null;
  discipline?: string | null;
  disciplineShort?: string | null;
  presentationType?: string | null;
  paper?: { title?: string } | null;
  talk?: {
    title?: string;
    session?: string;
    day?: string;
    start?: string;
    end?: string;
    venue?: string;
  } | null;
  host?: { name?: string; role?: string; mobile?: string } | null;
  duties?: string[];
  personalSchedule?: ScheduleItem[];
  coupons?: Coupon[];
};
export type ConferenceRecord = { name?: string; shortName?: string };

export const templateVariables: [string, string][] = [
  ["name", "Full name"],
  ["role", "Conference role"],
  ["conference", "Conference name"],
  ["registrationId", "Registration ID"],
  ["passId", "Entry pass ID"],
  ["affiliation", "Institution or organisation"],
  ["designation", "Designation"],
  ["discipline", "Discipline"],
  ["paperTitle", "Presenter's paper title"],
  ["presentationType", "Oral or poster"],
  ["presentationSlot", "Presenter's day, time and hall"],
  ["talkTitle", "Speaker's talk title"],
  ["talkSession", "Speaker's session"],
  ["talkSlot", "Speaker's day, time and hall"],
  ["hostName", "VIP's host"],
  ["hostMobile", "VIP host's mobile"],
  ["duties", "Assigned duties (list)"],
  ["schedule", "Personal schedule (list)"],
  ["meals", "Meal coupons (list)"],
];

const roleLabels: Record<string, string> = {
  presenter: "Presenter",
  attendee: "Attendee",
  speaker: "Speaker",
  vip: "VIP guest",
  organiser: "Organiser",
  volunteer: "Volunteer",
};
const slot = (s: {
  day?: string;
  start?: string;
  end?: string;
  venue?: string | null;
}) =>
  [s.day, [s.start, s.end].filter(Boolean).join("-"), s.venue]
    .filter(Boolean)
    .join(", ");
const list = (items: string[], empty: string) =>
  items.length ? items.map((i) => `- ${i}`).join("\n") : empty;

/** Placeholder values for one recipient, with readable fallbacks. */
export function personVariables(
  person: PersonRecord,
  conference: ConferenceRecord = {},
): Record<string, string> {
  const schedule = person.personalSchedule || [];
  const presentation = schedule.find((s) => s.kind === "presentation");
  const talk = person.talk;
  return {
    name: person.fullName || "Participant",
    role: roleLabels[person.role || ""] || "Participant",
    conference:
      conference.name ||
      "21st Uttarakhand State Science & Technology Congress 2026-27",
    registrationId: person.registrationId || "shown in the CONE app",
    passId: person.passId || "shown in the CONE app",
    affiliation: person.affiliation || "your institution",
    designation: person.designation || "",
    discipline:
      person.disciplineShort || person.discipline || "your discipline",
    paperTitle: person.paper?.title || "your submitted paper",
    presentationType:
      person.presentationType === "P"
        ? "Poster"
        : person.presentationType === "O"
          ? "Oral"
          : "Oral/Poster",
    presentationSlot: presentation
      ? slot(presentation)
      : "to be announced in the CONE app",
    talkTitle: talk?.title || "your talk",
    talkSession: talk?.session || "your session",
    talkSlot: talk ? slot(talk) : "to be announced in the CONE app",
    hostName: person.host?.name || "a member of the organising committee",
    hostMobile: person.host?.mobile || "shared on arrival",
    duties: list(
      person.duties || [],
      "- Your coordinator will confirm your duties.",
    ),
    schedule: list(
      schedule.map(
        (s) =>
          `${slot({ ...s, venue: null })}: ${s.title || "Session"}${s.venue ? ` (${s.venue})` : ""}`,
      ),
      "- Your personal schedule will appear in the CONE app.",
    ),
    meals: list(
      (person.coupons || []).map(
        (c) =>
          [c.day, c.meal].filter(Boolean).join(" ") +
          (c.window ? ` (${c.window})` : ""),
      ),
      "- Your meal coupons will appear in the CONE app.",
    ),
  };
}

/** Replaces every {{key}} with the recipient's value; unknown keys stay as written. */
export function renderTemplate(text: string, values: Record<string, string>) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, key: string) =>
    key in values ? values[key] : match,
  );
}

const signIn =
  "Sign in to the CONE app with the name, email and mobile number you registered with to see your pass, schedule and meal coupons.";
const signOff = "Warm regards,\nOrganising Committee\n{{conference}}";

export const roleTemplates: {
  role: string;
  name: string;
  subject: string;
  body: string;
}[] = [
  {
    role: "presenter",
    name: "Presenter - presentation details",
    subject: "Your {{presentationType}} presentation at {{conference}}",
    body: `Dear {{name}},

Thank you for presenting at {{conference}}. Here are your presentation details.

Paper: {{paperTitle}}
Type: {{presentationType}} presentation
Discipline: {{discipline}}
Slot: {{presentationSlot}}
Registration ID: {{registrationId}}

Before your session:
- Reach the hall at least 30 minutes before your slot.
- Bring your slides (PDF or PowerPoint) on a USB drive and hand them to the session coordinator, or bring your poster for display.
- Keep to your allotted time so that every presenter gets a fair hearing.

Your schedule:
{{schedule}}

Your meals:
{{meals}}

${signIn}

${signOff}`,
  },
  {
    role: "attendee",
    name: "Attendee - welcome and essentials",
    subject: "Welcome to {{conference}}",
    body: `Dear {{name}},

Welcome to {{conference}}. We are glad to have you with us.

Registration ID: {{registrationId}}
Entry pass: {{passId}}

At the venue:
- Collect your kit at the registration desk and keep your entry pass with you.
- Show your meal coupon QR code at the dining hall for each meal.

Your meals:
{{meals}}

${signIn}

${signOff}`,
  },
  {
    role: "speaker",
    name: "Speaker - session briefing",
    subject: "Your session at {{conference}}: {{talkTitle}}",
    body: `Dear {{name}},

Thank you for agreeing to speak at {{conference}}. Here is your session briefing.

Talk: {{talkTitle}}
Session: {{talkSession}}
Slot: {{talkSlot}}

Your schedule, including speaker check-in and slide upload:
{{schedule}}

Please bring your slides on a USB drive as a backup. Our team will meet you at the speaker check-in and help you settle in before your session.

Your meals:
{{meals}}

${signIn}

${signOff}`,
  },
  {
    role: "vip",
    name: "VIP guest - welcome and hosting",
    subject: "Welcome, {{name}} - your visit to {{conference}}",
    body: `Dear {{name}},

It is an honour to welcome you to {{conference}}.

Your host, {{hostName}}, will receive you on arrival and stay with you through the programme. You can reach them on {{hostMobile}}.

Your programme:
{{schedule}}

Your entry pass is {{passId}}. Please let your host know of any travel, dietary or accessibility needs, and we will arrange them.

${signIn}

${signOff}`,
  },
  {
    role: "organiser",
    name: "Organiser - duties and briefings",
    subject: "Your organising responsibilities for {{conference}}",
    body: `Dear {{name}},

Thank you for helping to organise {{conference}}. Here are your responsibilities and briefings.

Your duties:
{{duties}}

Your schedule:
{{schedule}}

Please attend the committee briefings, keep your mobile reachable during the event, and report any issue to the conference coordinator straight away.

${signIn} The app also gives you the people list and the meal desk.

${signOff}`,
  },
  {
    role: "volunteer",
    name: "Volunteer - duty roster",
    subject: "Your volunteer duties at {{conference}}",
    body: `Dear {{name}},

Thank you for volunteering at {{conference}}. Here is your duty roster.

Your duties:
{{duties}}

Your shifts:
{{schedule}}

Please report 15 minutes before each shift and wear your volunteer badge. At the meal desk, scan each coupon QR code in the CONE app; a coupon can be served only once.

Your meals:
{{meals}}

${signIn}

${signOff}`,
  },
  {
    role: "",
    name: "All participants - event reminder",
    subject: "Reminder: {{conference}} is almost here",
    body: `Dear {{name}},

This is a reminder that {{conference}} is about to begin. You are registered as: {{role}}.

Registration ID: {{registrationId}}

Your schedule:
{{schedule}}

Your meals:
{{meals}}

${signIn}

${signOff}`,
  },
];
