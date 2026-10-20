import { useBranding } from "./Branding";
import { useEffect, useState } from "react";
import {
  Mail,
  Phone,
  Building2,
  Ticket,
  CalendarDays,
  Utensils,
  CheckCircle2,
  UserRound,
} from "lucide-react";
import { request } from "./firebase";
import type { Actor } from "../shared/schema";
type Schedule = {
  title: string;
  day: string;
  start: string;
  end: string;
  venue?: string;
};
type Profile = {
  fullName?: string;
  email?: string;
  mobile?: string;
  affiliation?: string;
  registrationId?: string;
  registrationStatus?: string;
  role?: string;
  coupons?: { couponId: string; meal: string; day: string; window: string }[];
};
export default function ParticipantWorkspace({ actor }: { actor: Actor }) {
  const { branding } = useBranding();
  const [data, setData] = useState<{
      profile?: Profile | null;
      schedule?: Schedule[];
    } | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    request<{ profile: Profile | null; schedule: Schedule[] }>("/profile")
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, []);
  const profile = data?.profile || {};
  const schedule = data?.schedule || [];
  const coupons = profile.coupons || [];
  return (
    <>
      <div className="participant-summary">
        <div className="panel identity-card">
          <div className="identity-card-top">
            <span className="identity-avatar">
              <UserRound size={30} />
            </span>
            <span className="badge positive">
              <CheckCircle2 size={13} />
              Your account
            </span>
          </div>
          <h2>{profile.fullName || actor.fullName}</h2>
          <p className="identity-role">
            {profile.role || actor.role.replaceAll("_", " ")}
          </p>
          <dl className="identity-details">
            <div>
              <Mail size={16} />
              <dt>Email</dt>
              <dd>{profile.email || actor.email}</dd>
            </div>
            {profile.mobile && (
              <div>
                <Phone size={16} />
                <dt>Mobile</dt>
                <dd>{profile.mobile}</dd>
              </div>
            )}
            {profile.affiliation && (
              <div>
                <Building2 size={16} />
                <dt>Affiliation</dt>
                <dd>{profile.affiliation}</dd>
              </div>
            )}
          </dl>
        </div>
        <div className="panel registration-card">
          <span className="feature-icon">
            <Ticket size={24} />
          </span>
          <p className="eyebrow">YOUR REGISTRATION</p>
          <h2>{profile.registrationId || "Conference account"}</h2>
          <p className="subtitle">
            {profile.registrationStatus
              ? `Status: ${profile.registrationStatus}`
              : "Your account is connected to the conference workspace."}
          </p>
          <div className="participant-note">
            {profile.registrationId
              ? `Open the ${branding.applicationName} mobile app to display your QR pass and redeemable meal coupons.`
              : "Your dashboard access is active. Conference registrations are managed separately by your organizer."}
          </div>
        </div>
      </div>
      {error && (
        <div className="message" role="alert">
          {error}
        </div>
      )}
      <div className="overview-grid">
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Your programme</h2>
              <p>Conference sessions and personal schedule items</p>
            </div>
            <CalendarDays size={20} />
          </div>
          {!data && !error ? (
            <p className="loading">Loading your programme…</p>
          ) : schedule.length ? (
            <div className="personal-schedule">
              {schedule.map((item, index) => (
                <div
                  className="personal-session"
                  key={`${item.title}-${index}`}
                >
                  <span className="session-time">
                    {item.start}
                    <small>{item.day}</small>
                  </span>
                  <div>
                    <strong>{item.title}</strong>
                    <small>
                      {item.venue || "Venue to be announced"} · Until {item.end}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">
              <CalendarDays size={28} />
              <h3>Your programme will appear here</h3>
              <p>Published sessions will be shown when available.</p>
            </div>
          )}
        </section>
        <section className="panel">
          <div className="panel-heading">
            <div>
              <h2>Meal arrangements</h2>
              <p>Your issued conference meal coupons</p>
            </div>
            <Utensils size={20} />
          </div>
          {coupons.length ? (
            <div className="personal-schedule">
              {coupons.map((coupon) => (
                <div className="personal-session" key={coupon.couponId}>
                  <span className="quick-icon">
                    <Utensils size={18} />
                  </span>
                  <div>
                    <strong>{coupon.meal}</strong>
                    <small>
                      {coupon.day} · {coupon.window}
                    </small>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty">
              <Utensils size={28} />
              <h3>No meal coupons issued yet</h3>
              <p>Your organizer will arrange eligible meal coupons.</p>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
