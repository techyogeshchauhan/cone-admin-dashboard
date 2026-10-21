import { useEffect, useState } from "react";
import {
  Atom,
  CalendarDays,
  Globe,
  GraduationCap,
  Lightbulb,
  MapPin,
  Settings2,
  Share2,
  Users,
} from "lucide-react";

// The conference as published from the Conference page; the sign-in screen
// reads it before anyone is signed in.
export type PublicConference = {
  published: boolean;
  edition?: string;
  name?: string;
  shortName?: string;
  theme?: string;
  tagline?: string;
  startDate?: string;
  endDate?: string;
  venue?: string;
  organizer?: string;
  organizerAddress?: string;
  website?: string;
  highlights?: string[];
  logos?: { src: string; label: string }[];
};

export function usePublicConference() {
  const [conference, setConference] = useState<PublicConference | null>(null);
  useEffect(() => {
    let active = true;
    fetch(`${import.meta.env.VITE_API_BASE_URL || "/api"}/public/conference`)
      .then((response) => (response.ok ? response.json() : null))
      .then((value) => active && setConference(value))
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);
  return conference?.published ? conference : null;
}

// "23 – 24 October 2026", "30 October – 2 November 2026", or one date.
export function dateRange(start?: string, end?: string) {
  if (!start) return "";
  const format = (date: string, options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en-IN", { timeZone: "UTC", ...options }).format(
      new Date(`${date}T00:00:00Z`),
    );
  const full = { day: "numeric", month: "long", year: "numeric" } as const;
  if (!end || end === start) return format(start, full);
  const [startYear, startMonth] = start.split("-");
  const [endYear, endMonth] = end.split("-");
  if (startYear === endYear && startMonth === endMonth)
    return `${format(start, { day: "numeric" })} – ${format(end, full)}`;
  if (startYear === endYear)
    return `${format(start, { day: "numeric", month: "long" })} – ${format(end, full)}`;
  return `${format(start, full)} – ${format(end, full)}`;
}

const highlightIcons = [
  Lightbulb,
  Users,
  Settings2,
  Atom,
  GraduationCap,
  Share2,
];

// "21st" → 21 with a raised "st".
function Edition({ value }: { value: string }) {
  const match = /^(\d+)(.*)$/.exec(value);
  const number = match ? match[1] : value,
    suffix = match ? match[2] : "";
  return (
    <span className="conference-edition" aria-label={`${value} edition`}>
      {number}
      {suffix && <sup>{suffix}</sup>}
    </span>
  );
}

function Logos({ logos }: { logos: PublicConference["logos"] }) {
  if (!logos?.length) return null;
  return (
    <ul className="conference-logos" aria-label="Organisers">
      {logos.map((logo) => (
        <li key={logo.src}>
          <img src={logo.src} alt={logo.label} />
          <span>{logo.label}</span>
        </li>
      ))}
    </ul>
  );
}

// The left side of the sign-in screen.
export function ConferenceShowcase({
  conference,
}: {
  conference: PublicConference;
}) {
  const dates = dateRange(conference.startDate, conference.endDate);
  const website = conference.website?.replace(/^https?:\/\//, "");
  // "21st Uttarakhand …" beside a large "21st" would say it twice.
  const edition = conference.edition?.trim();
  const name =
    edition &&
    conference.name?.toLowerCase().startsWith(`${edition.toLowerCase()} `)
      ? conference.name.slice(edition.length + 1)
      : conference.name;
  return (
    <div className="conference-showcase">
      <Logos logos={conference.logos} />
      <div className="conference-heading">
        {conference.edition && <Edition value={conference.edition} />}
        <h1>{name}</h1>
      </div>
      {conference.theme && (
        <div className="conference-theme">
          <span>Theme</span>
          <p>{conference.theme}</p>
        </div>
      )}
      {(dates || conference.venue) && (
        <div className="conference-facts">
          {dates && (
            <span>
              <CalendarDays size={17} aria-hidden="true" />
              {dates}
            </span>
          )}
          {conference.venue && (
            <span>
              <MapPin size={17} aria-hidden="true" />
              {conference.venue}
            </span>
          )}
        </div>
      )}
      {!!conference.highlights?.length && (
        <ul className="conference-highlights">
          {conference.highlights.map((item, i) => {
            const Icon = highlightIcons[i % highlightIcons.length];
            return (
              <li key={item}>
                <Icon size={18} aria-hidden="true" />
                {item}
              </li>
            );
          })}
        </ul>
      )}
      {conference.tagline && (
        <p className="conference-tagline">{conference.tagline}</p>
      )}
      {(conference.organizer || website) && (
        <footer className="conference-organizer">
          {conference.organizer && (
            <p>
              <span>Organised by</span>
              <strong>{conference.organizer}</strong>
              {conference.organizerAddress && (
                <small>{conference.organizerAddress}</small>
              )}
            </p>
          )}
          {website && (
            <a href={conference.website} target="_blank" rel="noreferrer">
              <Globe size={14} aria-hidden="true" />
              {website}
            </a>
          )}
        </footer>
      )}
    </div>
  );
}

// On narrow screens the left side is hidden: a compact line above the form.
export function ConferenceStrip({
  conference,
}: {
  conference: PublicConference;
}) {
  const dates = dateRange(conference.startDate, conference.endDate);
  return (
    <div className="conference-strip">
      <img src="/cone-mark.webp" alt="" />
      <div>
        <strong>
          {conference.edition ? `${conference.edition} ` : ""}
          {conference.shortName || conference.name}
        </strong>
        <span>{[dates, conference.venue].filter(Boolean).join(" · ")}</span>
      </div>
    </div>
  );
}
