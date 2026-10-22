import { describe, expect, it } from "vitest";
import { renderEmail, signInCodeEmail } from "../shared/email-design.js";
import {
  personVariables,
  renderTemplate,
  roleTemplates,
} from "../shared/email-templates.js";

describe("branded email design", () => {
  it("formats every existing role template without losing recipient details", () => {
    const values = personVariables({
      fullName: "Kiran & Joshi",
      registrationId: "REG-101",
      paper: { title: "Glacier <Lake> Monitoring" },
      duties: ["Registration desk", "Help speakers"],
    });
    for (const template of roleTemplates) {
      const html = renderEmail({
        subject: renderTemplate(template.subject, values),
        text: renderTemplate(template.body, values),
      });
      expect(html).toContain("Kiran &amp; Joshi");
      expect(html).not.toContain("{{");
      expect(html).toContain('name="viewport"');
      if (template.role === "presenter") {
        expect(html).toContain("Glacier &lt;Lake&gt; Monitoring");
        expect(html).toContain("REG-101");
      }
      if (template.role === "volunteer") expect(html).toContain("<li");
    }
  });

  it("escapes template text, subjects and branding instead of trusting HTML", () => {
    const html = renderEmail({
      subject: '<img src=x onerror="alert(1)">',
      text: "<script>alert(1)</script>\n\n<script>: injected",
      brand: {
        applicationName: "Team <script>bad</script>",
        logoUrl: "javascript:alert(1)",
      },
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;script&gt;");
  });

  it("preserves secure action URLs and provides readable button fallbacks", () => {
    const url = "https://example.org/action?oobCode=abc&mode=resetPassword";
    const html = renderEmail({
      subject: "Account setup",
      text: `Hello User,\n\nReset your password:\n${url}\n\nVerify your email:\nhttps://example.org/verify`,
    });
    expect(html).toContain(
      'href="https://example.org/action?oobCode=abc&amp;mode=resetPassword"',
    );
    expect(html).toContain(">Reset your password</a>");
    expect(html).toContain(">Verify your email</a>");
    expect(html).toContain("If the button does not open");
    expect(html.split('<table role="presentation"')[0]).not.toContain(
      "oobCode",
    );
    expect(
      renderEmail({ subject: "Test", text: "javascript:alert(1)" }),
    ).not.toContain('href="javascript:');
  });

  it("keeps OTP in the message body with matching text, expiry and safety instructions", () => {
    const mail = signInCodeEmail("482901", { applicationName: "USSTC" });
    expect(mail.subject).toBe("Your USSTC sign-in code");
    expect(mail.text).toContain("code is 482901");
    expect(mail.html).toContain(">482901</div>");
    expect(mail.html).toContain("5 minutes");
    expect(mail.html).toContain("Do not share it");
    expect(mail.html.split('<table role="presentation"')[0]).not.toContain(
      "482901",
    );
    expect(mail.html).not.toContain("href=");
  });
});
