# Workbook fields and dashboard access

Source: `USSTC 21 Final116 (1).xlsx`, reviewed 22 October 2026. The workbook
contains two summary sheets and 13 discipline sheets. It supplies registration
data, not an authorization policy. The existing dashboard access presets remain
authoritative; conference roles (presenter, attendee, speaker, VIP, organiser,
volunteer) do not grant dashboard administration rights.

| Dashboard role       | Relevant information and management                                                                                                                                                                                                                                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Super Admin          | All registration, programme, operations and Fee Records fields; account, role and system controls.                                                                                                                                                                                                                                   |
| Conference Admin     | Registration details, programme, disciplines, venues, staffing, imports, fees, passes, meals and conference communications. No global access/system controls.                                                                                                                                                                        |
| Organizer            | The existing conference operations preset: registration, programme, logistics, imports, Fee Records and communications. No account/system administration.                                                                                                                                                                            |
| Registration Manager | Identity/contact, affiliation, working as, discipline/category, presentation type, gender, DOB, district, roll number, soft-copy/accommodation/travel requirements, prior awardee and remarks; registration fees, source payment references, Fee Records, imports and passes. No programme editing, staffing or meal administration. |
| Programme Manager    | Session schedule, venues, disciplines, paper titles/abstracts/authors, presenter email, category and oral/poster type. No participant directory, demographic fields or Fee Records.                                                                                                                                                  |
| Meal Desk            | Coupon redemption and its operational history. No registration directory, demographic or fee fields.                                                                                                                                                                                                                                 |
| Participant          | Own identity, registration and applicable presentation details, own schedule, issued meals, registration fee, workbook payment reference and own Fee Records. Read-only; no directory or administrative tools.                                                                                                                       |

Custom roles use their effective resource/action grants, including read-only
grants. Write-only grants do not expose navigation or data. Participants require
`participants:read`; financial fields additionally require `fees:read` and fee
changes additionally require `fees:write`. Raw workbook previews and exports
contain registration and fee data, so imports require both read grants; commits
also require both write grants. Participant exports require `reports:read` and
`participants:read`, and exclude financial columns without `fees:read`.

## Workbook interpretation

- `CT.` is category; `M/F` is gender; `O/P` is oral/poster presentation type.
- `Working as`, district, DOB, roll number, earlier-awardee variants and remarks
  are registration fields. `TA required` is retained separately from accommodation.
- Registration Fee / Ammount Received is the workbook's amount column. It is not
  evidence of a verified payment. Existing blank/invalid amount normalization is
  retained; the original workbook remains available through protected imports.
- Fees Received / DD Received frequently contains a transaction/DD reference.
  It remains source text, separate from manually managed payment status. A blank
  reference does not establish unpaid status, and a populated reference does not
  establish received status.
- Fee Records shows managed fee records and a separately labelled read-only list
  of workbook fee details. Source rows are not fabricated payment transactions.
- Participant self-service returns only an allowlisted own profile and own
  non-archived fee records; supplied email/ID query parameters cannot select
  another person. Internal registration remarks and import metadata are excluded.

Authorization is enforced by the API as well as dashboard visibility. Overview
sections and cached responses are scoped to effective read grants. No source
workbook is imported into live Firebase by this change.

## API contract changes

### Department records from the source workbook

The sidebar's **Department records** tab reads a separate, local
workbook snapshot (`storage/department-source.json`, ignored by Git). This view
preserves all detected source author rows, including incomplete and duplicate
registrations; it does not create Firebase people or alter live registrations.
Blank cells remain blank and payment references remain source text.

- `GET /api/department-records`: requires participants read; returns source
  filename/revision, department names/counts and total source author rows.
- `GET /api/department-records/rows`: requires participants read. Required
  `department`; optional `revision`, author `q`, `after`, and `limit` (default 50,
  cap 100). Returns `{rows,next}` using source IDs, not Firebase IDs. Only the
  selected department is included. Financial fields require fees read.
- `GET /api/reports/department-records`: requires participants and reports read;
  required `department`, optional `revision`. Downloads all rows for that
  department as XLSX, regardless of the current search/page. Fee columns require
  fees read. Unknown departments return 404; stale revisions return 409.
- `POST /api/imports/department-source`: `.xlsx` multipart `file`, max 5 MB.
  Requires imports read/write plus participants/fees read/write. Replaces only the source
  snapshot atomically after workbook validation; rejected uploads retain the
  previous source. Returns the refreshed catalog.

The development server also blocks direct static access to `storage/` and
`logs/`; the source snapshot is accessible through the authorized API only.

All endpoints require a verified Firebase bearer token and an active dashboard
account in conference `main` (Super Admin retains global access). Missing tokens
return 401; absent permissions return 403. Data reads do not grant write access.

| Endpoint                         | Authorization and response                                                                                                                                                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/records/participants`  | Existing paginated registration list, now with an allowlist. Financial fields require `fees:read`; raw import data and account markers are excluded (Super Admin retains the test-account marker).                                                   |
| `POST /api/records/participants` | Existing versioned write. Optional workingAs, gender, district, dob, rollNo, travelAssistance and remark strings are accepted. A supplied registrationFee requires `fees:write`; an omitted fee stays unchanged for registration-only editors.       |
| `GET /api/fees/workbook`         | Requires `fees:read`. Returns source rows with only id, fullName, email, registrationId, registrationFee and feesReceived. Archived/demo registrations are excluded. Optional `q` matches name/email/registration ID/reference.                      |
| `GET /api/profile`               | Requires `self:read`. Own allowlisted registration, including fee source fields and presenter's abstract title, plus own/published schedule. Archived/cancelled/suspended registrations return null profile.                                         |
| `GET /api/profile/fees`          | Requires `self:read`. Only feeRecords whose participantEmail matches the authenticated normalized email; archived records excluded. Rows contain id, amount, currency, status and reference. Query email/participantEmail cannot override ownership. |
| `GET /api/overview`              | Requires `reports:read`. Registrations/byRole, mealsServed, feeRecords/feesReceivedAmount, recentImports and recentActivity are included only with the respective effective read grants. Absent access omits sections rather than returning zeroes.  |
| `GET /api/reports/participants`  | Requires reports and participants read; financial columns additionally require fee read. Archived registrations are excluded. Returns XLSX.                                                                                                          |

Both new list endpoints follow the existing `{ rows: [...], next: string | null }`
pagination contract. `limit` defaults to 25 and is capped at 100; pass `next` as
`after` for the next page. A page may be empty with a non-null cursor while
filtering source rows; continue until `next` is null. Malformed cursors return 400. Lists are read-only and never create or verify a payment. Fee edits retain
existing version checks (409 on stale writes), validate the participant, normalize
its email and preserve the original workbook payment reference.
