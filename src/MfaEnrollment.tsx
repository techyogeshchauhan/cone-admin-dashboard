import { useState } from "react";
import {
  multiFactor,
  PhoneAuthProvider,
  PhoneMultiFactorGenerator,
  RecaptchaVerifier,
  signOut,
} from "firebase/auth";
import { auth } from "./firebase";
export default function MfaEnrollment() {
  const [verification, setVerification] = useState(""),
    [error, setError] = useState(""),
    [note, setNote] = useState(""),
    [busy, setBusy] = useState(false);
  if (!auth?.currentUser) return null;
  return (
    <div className="setup-note">
      <strong>Protect your Super Admin account</strong>
      <p>
        Enroll an SMS second factor, then sign in again. Firebase Identity
        Platform and SMS authentication must be enabled for your project.
      </p>
      {error && <p role="alert">{error}</p>}
      {note && <p>{note}</p>}
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          const form = new FormData(e.currentTarget);
          setBusy(true);
          setError("");
          try {
            if (!verification) {
              const session = await multiFactor(
                auth!.currentUser!,
              ).getSession();
              const verifier = new RecaptchaVerifier(
                auth!,
                "enrollment-captcha",
                { size: "invisible" },
              );
              try {
                setVerification(
                  await new PhoneAuthProvider(auth!).verifyPhoneNumber(
                    { phoneNumber: String(form.get("phone")), session },
                    verifier,
                  ),
                );
              } finally {
                verifier.clear();
              }
            } else {
              await multiFactor(auth!.currentUser!).enroll(
                PhoneMultiFactorGenerator.assertion(
                  PhoneAuthProvider.credential(
                    verification,
                    String(form.get("code")),
                  ),
                ),
                "Administrative SMS",
              );
              await signOut(auth!);
              setNote(
                "MFA enrolled. Sign in again to complete your SMS challenge.",
              );
            }
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {verification ? (
          <label>
            SMS code
            <input name="code" required autoComplete="one-time-code" />
          </label>
        ) : (
          <label>
            Phone with country code
            <input
              type="tel"
              name="phone"
              required
              placeholder="+919876543210"
            />
          </label>
        )}
        <button className="primary" disabled={busy}>
          {verification ? "Enroll SMS factor" : "Send enrollment code"}
        </button>
      </form>
      <div id="enrollment-captcha" />
    </div>
  );
}
