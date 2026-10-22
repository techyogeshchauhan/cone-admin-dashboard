# Email design

Server-sent emails use the responsive navy/teal layout in
`shared/email-design.ts`, alongside a plain-text alternative:

- All seven role/reminder templates and saved custom templates.
- Sign-in OTPs, with a large six-digit code and the existing five-minute expiry.
- Dashboard invitations, admin-triggered password resets and email verification.
- SMTP connection tests.

The worker styles messages when it sends them, so existing saved templates and
queued jobs need no migration. Keep editing templates as text; recipient values
are escaped before HTML rendering. Standalone HTTP(S) action links become buttons
with a visible fallback URL. OTP delivery remains separate from the general queue.

The application name and public logo come from `conference/branding`. The logo
requires an HTTPS `PUBLIC_API_BASE_URL`; without it, emails use the text wordmark.
The dashboard's Email / SMTP page uses the same renderer for message and OTP
previews. Its OTP is a sample, not a valid sign-in code.

Run `npm run build`, then restart the API and email worker to apply the changes
on a deployed installation. No Firebase configuration changes are needed for
these server-sent messages.

`npm run dev` and `npm run worker` watch the worker and its renderer imports, so
local source updates restart email delivery too. Restart an already running
development command once to pick up this script change. Successful new deliveries
record `deliveryFormat: "html"` and `rendererVersion: "cone-branded-v1"` on the
email job. Messages sent earlier do not change in an inbox. A worker on another
machine connected to the same Firebase project must also be updated/restarted;
it competes for the same queued jobs.

The login page's **Forgot your password?** still calls Firebase directly. That
provider-managed email is outside this SMTP renderer and retains its Firebase
template. Legacy Firebase email-link sign-in is also provider-managed.
