import { db } from "./firebase.js";
import type { EmailBrand } from "../shared/email-design.js";
import { memo } from "./request-cache.js";

const cached = memo<EmailBrand>();

/** Public branding only. Never let an unavailable logo/settings read block mail. */
export async function emailBranding(): Promise<EmailBrand> {
  try {
    return await cached("email-branding", async () => {
      const value = (await db.doc("conference/branding").get()).data();
      const origin = process.env.PUBLIC_API_BASE_URL?.replace(/\/$/, "");
      return {
        applicationName:
          typeof value?.applicationName === "string"
            ? value.applicationName
            : "CONE",
        logoUrl:
          origin?.startsWith("https://") && typeof value?.logoId === "string"
            ? `${origin}/api/branding/logo/${encodeURIComponent(value.logoId)}`
            : null,
      };
    });
  } catch {
    return { applicationName: "CONE" };
  }
}
