import { describe, expect, it } from "vitest";
import {
  personVariables,
  renderTemplate,
  roleTemplates,
  templateVariables,
} from "../shared/email-templates.js";
import { conferenceRoles } from "../shared/schema.js";

const conference = { name: "USSTC 2026-27" };
const presenter = {
  fullName: "Aarav Mehra",
  role: "presenter",
  registrationId: "USSTC26-CSE-0142",
  presentationType: "O",
  disciplineShort: "Computer Sciences",
  paper: { title: "Low-Cost IoT Sensor Network" },
  personalSchedule: [
    {
      day: "Day 1",
      start: "14:30",
      end: "14:45",
      title: "Your oral presentation",
      venue: "Hall B",
      kind: "presentation",
    },
  ],
  coupons: [{ day: "Day 1", meal: "Lunch", window: "13:00 - 14:00" }],
};

describe("role-based email templates", () => {
  it("covers every conference role plus everyone", () => {
    for (const role of conferenceRoles)
      expect(roleTemplates.some((t) => t.role === role)).toBe(true);
    expect(roleTemplates.some((t) => t.role === "")).toBe(true);
  });
  it("only uses documented placeholders", () => {
    const known = new Set(templateVariables.map(([key]) => key));
    for (const t of roleTemplates)
      for (const [, key] of `${t.subject}\n${t.body}`.matchAll(
        /\{\{\s*(\w+)\s*\}\}/g,
      ))
        expect(known, `${t.name} uses {{${key}}}`).toContain(key);
  });
  it("fills a presenter's own paper, slot and meals", () => {
    const t = roleTemplates.find((x) => x.role === "presenter")!;
    const values = personVariables(presenter, conference);
    const body = renderTemplate(t.body, values);
    expect(renderTemplate(t.subject, values)).toBe(
      "Your Oral presentation at USSTC 2026-27",
    );
    expect(body).toContain("Dear Aarav Mehra,");
    expect(body).toContain("Paper: Low-Cost IoT Sensor Network");
    expect(body).toContain("Slot: Day 1, 14:30-14:45, Hall B");
    expect(body).toContain("- Day 1 Lunch (13:00 - 14:00)");
    expect(body).not.toMatch(/\{\{/);
  });
  it("lists a volunteer's duties and a VIP's host", () => {
    const volunteer = personVariables({
      role: "volunteer",
      duties: ["Meal desk - Dining hall"],
    });
    expect(volunteer.duties).toBe("- Meal desk - Dining hall");
    const vip = personVariables({
      role: "vip",
      host: { name: "Dr. Kavita Negi", mobile: "9876543214" },
    });
    expect(vip.hostName).toBe("Dr. Kavita Negi");
    expect(vip.hostMobile).toBe("9876543214");
  });
  it("renders every template without leftover placeholders for a sparse record", () => {
    for (const t of roleTemplates) {
      const values = personVariables({ fullName: "Riya" });
      expect(renderTemplate(`${t.subject}\n${t.body}`, values)).not.toMatch(
        /\{\{/,
      );
    }
  });
  it("keeps unknown placeholders as written", () => {
    expect(renderTemplate("Hi {{name}} {{unknown}}", { name: "A" })).toBe(
      "Hi A {{unknown}}",
    );
  });
});
