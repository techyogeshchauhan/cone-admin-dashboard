import "dotenv/config";
import { readFileSync } from "node:fs";
import { initializeApp, applicationDefault, cert } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
// A service-account key signs custom tokens locally; plain ADC needs the IAM
// Service Account Credentials API (signBlob) for the same operation.
function credential() {
  const file = process.env.GOOGLE_APPLICATION_CREDENTIALS;
  if (file) {
    const key = JSON.parse(readFileSync(file, "utf8"));
    if (key.type === "service_account") return cert(key);
  }
  return applicationDefault();
}
initializeApp({
  projectId: process.env.FIREBASE_PROJECT_ID,
  ...(process.env.FIREBASE_SERVICE_ACCOUNT_ID
    ? { serviceAccountId: process.env.FIREBASE_SERVICE_ACCOUNT_ID }
    : {}),
  ...(process.env.FIRESTORE_EMULATOR_HOST ? {} : { credential: credential() }),
});
export const db = getFirestore();
export const auth = getAuth();
