import { useState } from "react";
import { LoadMore, useDebounced, usePagedList } from "./paging";

type SourceFee = {
  id: string;
  fullName?: string;
  email?: string;
  registrationId?: string;
  registrationFee?: number;
  feesReceived?: string;
};

export default function WorkbookFees({
  writable = false,
}: {
  writable?: boolean;
}) {
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim());
  const list = usePagedList<SourceFee>("/fees/workbook", {
    q: q.length >= 2 ? q : undefined,
  });
  return (
    <section className="panel" aria-label="Workbook fee details">
      <div className="panel-heading">
        <div>
          <h2>Workbook fee details</h2>
          <p>Source registration amounts and payment / DD references</p>
        </div>
      </div>
      <p className="inline-note">
        These source details are read-only. A payment reference does not confirm
        receipt.{" "}
        {writable
          ? "Use Fee Records above to record a verified payment and its status."
          : "Registration staff manage verified payments and their status."}
      </p>
      <div className="toolbar">
        <div className="search">
          <input
            aria-label="Search workbook fees"
            placeholder="Search name, email or payment reference"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>
      {list.error && (
        <p className="message" role="alert">
          {list.error}
        </p>
      )}
      {list.loading && !list.rows.length ? (
        <p className="loading">Loading workbook fee details…</p>
      ) : list.rows.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Participant</th>
                <th>Email</th>
                <th>Registration ID</th>
                <th>Registration fee (INR)</th>
                <th>Workbook payment / DD reference</th>
              </tr>
            </thead>
            <tbody>
              {list.rows.map((row) => (
                <tr key={row.id}>
                  <td>{row.fullName || "—"}</td>
                  <td>{row.email || "—"}</td>
                  <td>{row.registrationId || "—"}</td>
                  <td>
                    {row.registrationFee === undefined
                      ? "Not recorded"
                      : row.registrationFee.toLocaleString("en-IN")}
                  </td>
                  <td>{row.feesReceived || "Not recorded"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p>No matching workbook fee details.</p>
      )}
      <LoadMore
        next={list.next}
        loading={list.loading}
        onLoad={list.loadMore}
      />
    </section>
  );
}
