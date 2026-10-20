import { z } from "zod";
import { accessRoles, permissions, type AccessRole } from "./schema.js";
export const managedResources = [
  "participants",
  "sessions",
  "disciplines",
  "submissions",
  "meals",
  "imports",
  "media",
  "conference",
  "reports",
  "email",
  "venues",
  "staff",
  "fees",
  "passes",
  "redemptions",
  "self",
] as const;
export const permissionActions = ["read", "write", "archive"] as const;
export const permissionKeys = managedResources.flatMap((resource) =>
  permissionActions.map((action) => `${resource}:${action}`),
);
export const roleId = z.string().regex(/^[a-z][a-z0-9_]{2,40}$/);
export const roleDefinitionSchema = z
  .object({
    name: z.string().trim().min(2).max(100),
    description: z.string().trim().max(500),
    active: z.boolean(),
    permissions: z
      .array(
        z
          .string()
          .refine(
            (value) => permissionKeys.includes(value),
            "Unknown or reserved permission",
          ),
      )
      .max(150),
    version: z.number().int().min(0),
  })
  .strict();
export type RoleDefinition = z.infer<typeof roleDefinitionSchema> & {
  id: string;
  builtIn: boolean;
};
export function resolveRole(
  role: string,
  definition?: Record<string, unknown>,
): string[] | null {
  if (role === "superadmin") return ["*"];
  if (definition?.managedRole === true) {
    const result = roleDefinitionSchema.safeParse({
      name: definition.name,
      description: definition.description,
      active: definition.active,
      permissions: definition.permissions,
      version: definition.version,
    });
    return result.success && result.data.active
      ? result.data.permissions
      : null;
  }
  return accessRoles.includes(role as AccessRole)
    ? permissions[role as AccessRole]
    : null;
}
export function defaultRole(id: string): RoleDefinition {
  return {
    id,
    name: id.replaceAll("_", " "),
    description:
      id === "superadmin"
        ? "Protected global application owner"
        : "Built-in conference access preset",
    active: true,
    permissions:
      id === "superadmin"
        ? ["*"]
        : (permissions[id as AccessRole] || []).flatMap((resource) =>
            permissionActions.map((action) => `${resource}:${action}`),
          ),
    version: 0,
    builtIn: true,
  };
}
export const runtimeSchema = z
  .object({
    writesPaused: z.boolean(),
    importsEnabled: z.boolean(),
    mediaUploadsEnabled: z.boolean(),
    emailEnabled: z.boolean(),
    redemptionsEnabled: z.boolean(),
    exportsEnabled: z.boolean(),
    sessionMaxAgeMinutes: z.number().int().min(15).max(1440),
    maxUploadMb: z.number().int().min(1).max(5),
    applicationName: z.string().trim().min(2).max(100),
    announcement: z.string().max(1000),
    version: z.number().int().min(0),
  })
  .strict();
export const runtimeDefaults: z.infer<typeof runtimeSchema> = {
  writesPaused: false,
  importsEnabled: true,
  mediaUploadsEnabled: true,
  emailEnabled: true,
  redemptionsEnabled: true,
  exportsEnabled: true,
  sessionMaxAgeMinutes: 480,
  maxUploadMb: 5,
  applicationName: "CONE",
  announcement: "",
  version: 0,
};
export function checkAdminChange(
  actorUid: string,
  targetUid: string,
  oldRole: string | undefined,
  nextRole: string,
  nextStatus: string,
  activeSuperadmins: number,
  oldStatus = "active",
) {
  if (
    actorUid === targetUid &&
    (nextRole !== "superadmin" || nextStatus !== "active")
  )
    throw new Error("You cannot remove your own Super Admin access");
  if (
    oldRole === "superadmin" &&
    oldStatus === "active" &&
    (nextRole !== "superadmin" || nextStatus !== "active") &&
    activeSuperadmins <= 1
  )
    throw new Error("The last active Super Admin must be retained");
}
