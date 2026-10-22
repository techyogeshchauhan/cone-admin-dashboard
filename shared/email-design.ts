/** Shared by the delivery worker and dashboard preview. Message content is text,
 * never trusted HTML; old saved templates automatically receive this layout. */
export type EmailBrand = { applicationName?: string; logoUrl?: string | null };
export type EmailDesign = {
  subject: string;
  text: string;
  brand?: EmailBrand;
  code?: string;
};

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
function webUrl(value: string) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : null;
  } catch {
    return null;
  }
}
function inline(value: string) {
  return value
    .split(/(https?:\/\/[^\s<>"']+)/g)
    .map((part) => {
      const url = webUrl(part);
      return url
        ? `<a href="${escape(url)}" style="color:#087f82;text-decoration:underline;overflow-wrap:anywhere;word-break:break-word;">${escape(part)}</a>`
        : escape(part);
    })
    .join("");
}
function messageContent(text: string) {
  return text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .filter(Boolean)
    .map((block) => {
      const lines = block.split("\n");
      // Only an entire URL line becomes an action; arbitrary text stays escaped.
      if (lines.some((line) => webUrl(line.trim()))) {
        return `<div style="margin:0 0 24px;">${lines
          .map((line, index) => {
            const url = webUrl(line.trim());
            if (!url)
              return `<div style="margin:0 0 8px;">${inline(line)}</div>`;
            const label =
              lines[index - 1]?.trim().replace(/:$/, "") || "Open secure link";
            return `<table role="presentation" cellspacing="0" cellpadding="0" style="margin:12px 0;max-width:100%;"><tr><td bgcolor="#087f82" style="border-radius:8px;mso-padding-alt:14px 22px;"><a href="${escape(url)}" style="display:inline-block;padding:14px 22px;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;">${escape(label)}</a></td></tr></table><div style="font-size:12px;line-height:1.7;color:#64748b;">If the button does not open, use this link:<br>${inline(line)}</div>`;
          })
          .join("")}</div>`;
      }
      const firstItem = lines.findIndex((line) => /^- /.test(line));
      if (
        firstItem >= 0 &&
        lines.slice(firstItem).every((line) => /^- /.test(line))
      )
        return `${firstItem ? `<h2 style="margin:26px 0 10px;color:#15334b;font-size:16px;line-height:1.5;">${lines.slice(0, firstItem).map(inline).join("<br>")}</h2>` : ""}<ul style="margin:0 0 24px;padding-left:22px;">${lines
          .slice(firstItem)
          .map(
            (line) =>
              `<li style="padding:0 0 8px;">${inline(line.slice(2))}</li>`,
          )
          .join("")}</ul>`;
      if (
        lines.length > 1 &&
        lines.every((line) => /^[^:]{1,40}: .+/.test(line))
      )
        return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#f1f7f8" style="border:1px solid #dcebed;border-radius:10px;margin:0 0 24px;"><tr><td style="padding:18px 20px;">${lines
          .map((line) => {
            const colon = line.indexOf(":");
            return `<div style="margin:4px 0;"><span style="color:#52677b;">${escape(line.slice(0, colon))}:</span> <strong style="color:#15334b;">${inline(line.slice(colon + 1).trim())}</strong></div>`;
          })
          .join("")}</td></tr></table>`;
      if (lines.length === 1 && block.endsWith(":"))
        return `<h2 style="margin:26px 0 10px;color:#15334b;font-size:16px;line-height:1.5;">${escape(block.slice(0, -1))}</h2>`;
      return `<p style="margin:0 0 20px;">${lines.map(inline).join("<br>")}</p>`;
    })
    .join("");
}

export function renderEmail({ subject, text, brand = {}, code }: EmailDesign) {
  const name = brand.applicationName?.trim() || "CONE";
  const logo = brand.logoUrl && webUrl(brand.logoUrl);
  const otp = code && /^\d{6}$/.test(code) ? code : null;
  const preheader = otp
    ? "Your one-time sign-in code. Valid for 5 minutes."
    : text
        .replace(/https?:\/\/\S+/g, "")
        .replace(/\s+/g, " ")
        .slice(0, 150);
  const content = otp
    ? `<p style="margin:0 0 22px;">Enter this one-time code in the ${escape(name)} app to finish signing in.</p>
       <table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#edf8f7" style="border:1px solid #cce8e5;border-radius:12px;margin:0 0 20px;"><tr><td align="center" style="padding:24px 12px;"><div style="font-size:11px;letter-spacing:2px;font-weight:bold;color:#087f82;">YOUR SIGN-IN CODE</div><div style="font-family:Consolas,'Courier New',monospace;font-size:38px;line-height:1.6;letter-spacing:8px;font-weight:bold;color:#15334b;">${otp}</div><div style="font-size:13px;color:#52677b;">Expires in <strong>5 minutes</strong></div></td></tr></table>
       <p style="margin:0 0 16px;font-weight:bold;color:#15334b;">Keep this code private. Do not share it with anyone.</p><p style="margin:0;color:#64748b;font-size:13px;">If you did not request this code, you can safely ignore this email.</p>`
    : messageContent(text);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escape(subject)}</title>
<style>@media only screen and (max-width:600px){.email-outer{padding:16px 8px!important}.email-pad{padding:26px 20px!important}.email-title{font-size:24px!important}}</style></head>
<body style="margin:0;padding:0;background-color:#edf2f6;color:#334b60;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.75;">
<div style="display:none;font-size:1px;line-height:1px;max-height:0;max-width:0;overflow:hidden;mso-hide:all;">${escape(preheader)}</div>
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" bgcolor="#edf2f6"><tr><td class="email-outer" align="center" style="padding:36px 16px;">
<!--[if mso]><table role="presentation" width="600" cellspacing="0" cellpadding="0"><tr><td><![endif]-->
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;table-layout:fixed;border:1px solid #dce5ed;border-radius:16px;overflow:hidden;background-color:#ffffff;">
<tr><td bgcolor="#102d43" class="email-pad" style="padding:28px 36px;border-bottom:4px solid #24b7ac;">${logo ? `<img src="${escape(logo)}" alt="${escape(name)} logo" width="56" height="56" style="display:block;object-fit:contain;border:0;margin:0 0 14px;background-color:#ffffff;border-radius:8px;">` : ""}<div style="font-size:28px;font-weight:bold;letter-spacing:2px;line-height:1.3;color:#ffffff;">${escape(name)}</div><div style="margin-top:6px;color:#a9ccda;font-size:11px;letter-spacing:1.4px;">CONFERENCE OPERATIONS &amp; NETWORKING</div></td></tr>
<tr><td class="email-pad" style="padding:32px 36px;overflow-wrap:anywhere;word-break:break-word;"><div style="color:#087f82;font-size:11px;letter-spacing:1.6px;font-weight:bold;margin-bottom:10px;">${otp ? "SECURE SIGN-IN" : "CONFERENCE COMMUNICATION"}</div><h1 class="email-title" style="font-size:27px;line-height:1.3;color:#15334b;margin:0 0 26px;font-weight:bold;">${escape(otp ? "Your sign-in code" : subject)}</h1>${content}</td></tr>
<tr><td class="email-pad" bgcolor="#f7fafc" style="padding:22px 36px;border-top:1px solid #e4ecf2;font-size:12px;line-height:1.7;color:#708394;"><strong style="color:#38566c;">${escape(name)} · Conference communications</strong><br>${otp ? "This code is intended only for the person signing in." : "Please keep this email for your reference."}<br>Sent by ${escape(name)}.</td></tr></table>
<!--[if mso]></td></tr></table><![endif]-->
</td></tr></table></body></html>`;
}

export function signInCodeEmail(code: string, brand: EmailBrand = {}) {
  const name = brand.applicationName?.trim() || "CONE";
  const subject = `Your ${name} sign-in code`;
  const text = `Your ${name} sign-in code is ${code}. It expires in 5 minutes. Do not share this code. If you did not request it, ignore this email.`;
  return { subject, text, html: renderEmail({ subject, text, brand, code }) };
}
