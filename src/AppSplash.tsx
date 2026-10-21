import { useEffect, useState } from "react";
import { dateRange, usePublicConference } from "./ConferenceShowcase";

// What the wait is for, as it goes on: the sign-in check comes first, the
// workspace after it, and a slow connection is named rather than left silent.
const stages = [
  { after: 0, text: "Checking your sign-in…" },
  { after: 2500, text: "Loading your workspace…" },
  {
    after: 10000,
    text: "This is taking longer than usual. Check your internet connection.",
  },
];

// Shown full screen while the session is checked, at start and after sign-in.
export default function AppSplash() {
  const conference = usePublicConference();
  const [stage, setStage] = useState(0);
  useEffect(() => {
    const timers = stages
      .slice(1)
      .map((s, i) => setTimeout(() => setStage(i + 1), s.after));
    return () => timers.forEach(clearTimeout);
  }, []);
  const dates = conference
    ? dateRange(conference.startDate, conference.endDate)
    : "";
  return (
    <div className="app-splash" role="status" aria-live="polite">
      <div className="app-splash-mark">
        <span className="app-splash-ring" aria-hidden="true" />
        <img src="/cone-mark.webp" alt="" width={88} height={88} />
      </div>
      <p className="app-splash-name">
        <strong>CONE</strong>
        <span>Conference Operations & Networking Environment</span>
      </p>
      <p className={`app-splash-stage${stage === 2 ? " slow" : ""}`}>
        {stages[stage].text}
      </p>
      <div className="app-splash-bar" aria-hidden="true">
        <span />
      </div>
      {conference && (
        <p className="app-splash-conference">
          {[
            [conference.edition, conference.shortName || conference.name]
              .filter(Boolean)
              .join(" "),
            dates,
          ]
            .filter(Boolean)
            .join(" · ")}
        </p>
      )}
    </div>
  );
}
