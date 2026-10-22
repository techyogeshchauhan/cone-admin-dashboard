// Cache dependencies of API writes. Include failed/partial writes: identity
// operations can disable access before a downstream Auth operation fails.
export function mutationCaches(path: string): string[] {
  const tags = new Set<string>();
  if (/^\/people\/[^/]+\/test-account$/.test(path)) {
    tags.add("sessions");
    tags.add("overview");
  }
  if (/^\/records\/sessions(\/|$)/.test(path)) tags.add("conference");
  if (
    /^\/(control\/(users|roles)|users|test-accounts|testing|dev-role)/.test(
      path,
    ) ||
    /^\/records\/users(\/|$)/.test(path)
  )
    tags.add("sessions");
  if (path === "/settings") tags.add("switches");
  if (/^\/(settings\/branding|control\/runtime)(\/|$)/.test(path)) {
    tags.add("switches");
    tags.add("branding");
  }
  if (/^\/settings\/smtp(\/|$)/.test(path)) tags.add("smtp");
  if (/^\/conference(\/|$)/.test(path)) tags.add("conference");
  // Saving dashboard access can create a linked people record.
  if (/^\/(control\/users|users|records\/users)(\/|$)/.test(path))
    tags.add("overview");
  if (
    /^\/(records\/(participants|fees|meals)|coupons\/redeem)(\/|$)/.test(path)
  )
    tags.add("overview");
  // Inspect only parses an upload. Preview creates a job but grants no access.
  if (/^\/imports(\/|$)/.test(path) && path !== "/imports/inspect")
    tags.add("overview");
  // Only committed imports can provision dashboard identities.
  if (/^\/imports\/(?:workbook\/)?[^/]+\/commit$/.test(path))
    tags.add("sessions");
  return [...tags];
}
