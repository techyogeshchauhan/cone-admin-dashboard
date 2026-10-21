import { describe, expect, it } from "vitest";
import { firebaseOutage } from "../server/firebase-errors.js";

describe("Firebase outage messages", () => {
  it("recognises Firestore's gRPC and client status codes", () => {
    expect(firebaseOutage({ code: 8 })?.kind).toBe("quota");
    expect(firebaseOutage({ code: "resource-exhausted" })?.kind).toBe("quota");
    expect(firebaseOutage({ code: 14 })?.kind).toBe("network");
    expect(firebaseOutage({ code: 4 })?.kind).toBe("network");
    expect(firebaseOutage({ code: 7 })?.kind).toBe("credentials");
    expect(firebaseOutage({ code: 16 })?.kind).toBe("credentials");
  });
  it("leaves every other error to the normal handling", () => {
    expect(firebaseOutage({ code: 5 })).toBeNull();
    expect(firebaseOutage({ code: "auth/user-not-found" })).toBeNull();
    expect(firebaseOutage(new Error("plain"))).toBeNull();
    expect(firebaseOutage(null)).toBeNull();
  });
});
