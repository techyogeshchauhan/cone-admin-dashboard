// Firebase Admin reports Firestore failures with gRPC status codes. These
// mean the backend itself is unavailable, not that a request was wrong, so
// they get a message that names the real cause instead of a generic one.
const quotaCodes = [8, "resource-exhausted"];
const networkCodes = [4, 14, "deadline-exceeded", "unavailable"];
const credentialCodes = [7, 16, "permission-denied", "unauthenticated"];

export function firebaseOutage(error: unknown) {
  const code = (error as { code?: unknown } | null)?.code;
  if (quotaCodes.includes(code as never))
    return {
      kind: "quota" as const,
      message:
        "Firebase reports quota or rate exhaustion. Data is temporarily unavailable. Check Firestore usage and service quota metrics to identify the exhausted limit; retry after the backoff period.",
    };
  if (networkCodes.includes(code as never))
    return {
      kind: "network" as const,
      message:
        "Firebase could not be reached. Check this server's internet connection and try again.",
    };
  if (credentialCodes.includes(code as never))
    return {
      kind: "credentials" as const,
      message:
        "Firebase rejected this server's service account. Check GOOGLE_APPLICATION_CREDENTIALS and the account's permissions.",
    };
  return null;
}
