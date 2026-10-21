import { useEffect, useRef } from "react";
import { LogOut } from "lucide-react";

// Asked when the browser's Back would leave the dashboard. Staying is the
// default: it has focus, and Escape or the backdrop choose it.
export default function LeaveDialog({
  busy,
  onStay,
  onLeave,
}: {
  busy: boolean;
  onStay: () => void;
  onLeave: () => void;
}) {
  const stay = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    stay.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onStay();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onStay]);
  return (
    <div
      className="modal-backdrop"
      onClick={(event) => event.target === event.currentTarget && onStay()}
    >
      <section
        className="modal leave-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="leave-title"
        aria-describedby="leave-description"
      >
        <span className="leave-icon" aria-hidden="true">
          <LogOut size={22} />
        </span>
        <h2 id="leave-title">Leave the dashboard?</h2>
        <p id="leave-description">
          Going back will sign you out of CONE. You will need to sign in again
          to return.
        </p>
        <div className="form-actions">
          <button
            ref={stay}
            type="button"
            className="secondary"
            onClick={onStay}
            disabled={busy}
          >
            Stay signed in
          </button>
          <button
            type="button"
            className="primary danger"
            onClick={onLeave}
            disabled={busy}
          >
            {busy ? "Signing out…" : "Sign out and go back"}
          </button>
        </div>
      </section>
    </div>
  );
}
