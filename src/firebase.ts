import { initializeApp } from "firebase/app";
import { getAuth, connectAuthEmulator } from "firebase/auth";
export const configured = Boolean(
  import.meta.env.VITE_FIREBASE_API_KEY &&
  import.meta.env.VITE_FIREBASE_PROJECT_ID,
);
export const auth = configured
  ? getAuth(
      initializeApp({
        apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
        authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
        projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
        appId: import.meta.env.VITE_FIREBASE_APP_ID,
        storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
        messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
      }),
    )
  : null;
if (auth && import.meta.env.DEV && import.meta.env.VITE_AUTH_EMULATOR_URL)
  connectAuthEmulator(auth, import.meta.env.VITE_AUTH_EMULATOR_URL, {
    disableWarnings: true,
  });
export async function request<T = Record<string, unknown>>(
  endpoint: string,
  init: RequestInit = {},
): Promise<T> {
  if (!auth?.currentUser) throw new Error("Sign in to continue");
  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${await auth.currentUser.getIdToken()}`);
  if (init.body && !(init.body instanceof FormData))
    headers.set("Content-Type", "application/json");
  const response = await fetch(
    `${import.meta.env.VITE_API_BASE_URL || "/api"}${endpoint}`,
    { ...init, headers },
  );
  if (!response.ok) {
    const body = await response
      .json()
      .catch(() => ({ error: "Request failed" }));
    throw new Error(body.error);
  }
  if (response.headers.get("content-type")?.includes("application/json"))
    return response.json();
  return (await response.blob()) as T;
}
