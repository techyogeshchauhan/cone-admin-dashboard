import type { Express, Request } from "express";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { unlink } from "node:fs/promises";
import multer from "multer";
import sharp from "sharp";
import { z } from "zod";
import { db } from "./firebase.js";
import { assertControlAuthority, runtimeConfiguration } from "./control.js";
import type { Actor } from "../shared/schema.js";

const inputSchema = z
  .object({
    applicationName: z.string().trim().min(2).max(100),
    version: z.coerce.number().int().min(0),
    removeLogo: z.enum(["true", "false"]).optional(),
  })
  .strict();
export function logoUrl(id: string) {
  const origin = (
    process.env.PUBLIC_API_BASE_URL ||
    `http://localhost:${process.env.PORT || 8080}`
  ).replace(/\/$/, "");
  return `${origin}/api/branding/logo/${id}`;
}
export async function publicBranding() {
  const [runtime, branding] = await Promise.all([
    runtimeConfiguration(),
    db.doc("conference/branding").get(),
  ]);
  const logoId = branding.data()?.logoId || null;
  return {
    applicationName: runtime.applicationName,
    logoId,
    logoUrl: logoId ? logoUrl(logoId) : null,
    version: runtime.version,
  };
}
export function registerPublicBranding(app: Express, storage: string) {
  app.get("/api/branding", async (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.json(await publicBranding());
  });
  app.get("/api/branding/logo/:id", async (req, res, next) => {
    const id = z.uuid().parse(req.params.id);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res
      .type("webp")
      .sendFile(path.join(storage, `branding-${id}.webp`), (error) => {
        if (error) {
          if ((error as { status?: number }).status === 404)
            res.status(404).json({ error: "Logo not found" });
          else next(error);
        }
      });
  });
}
export function registerBrandingAdmin(app: Express, storage: string) {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024, files: 1, fields: 3 },
  });
  app.post(
    "/api/settings/branding",
    (req, res, next) => {
      const actor = (req as Request & { actor: Actor }).actor;
      if (actor.role !== "superadmin")
        return next(
          Object.assign(
            new Error("Only Super Admin can modify application branding"),
            { status: 403 },
          ),
        );
      if (Date.now() / 1000 - (actor.authTime || 0) > 300)
        return next(
          Object.assign(
            new Error("Sign in again before changing application branding"),
            { status: 403 },
          ),
        );
      upload.single("logo")(req, res, (error) => {
        if (error)
          return next(
            Object.assign(
              new Error(
                error.code === "LIMIT_FILE_SIZE"
                  ? "Logo must be 2 MB or smaller"
                  : "Choose one JPEG, PNG or WebP logo",
              ),
              { status: 400 },
            ),
          );
        next();
      });
    },
    async (req, res) => {
      const value = inputSchema.parse(req.body),
        actor = (req as Request & { actor: Actor }).actor;
      let created: string | undefined;
      try {
        if (req.file) {
          if (value.removeLogo === "true")
            throw Object.assign(
              new Error("Choose either a replacement logo or remove logo"),
              { status: 400 },
            );
          const image = sharp(req.file.buffer, {
            limitInputPixels: 4096 * 4096,
          });
          let metadata;
          try {
            metadata = await image.metadata();
          } catch {
            throw Object.assign(
              new Error("Invalid image. Use JPEG, PNG or WebP."),
              { status: 400 },
            );
          }
          if (
            !["jpeg", "png", "webp"].includes(metadata.format || "") ||
            (metadata.width || 0) > 4096 ||
            (metadata.height || 0) > 4096 ||
            (metadata.pages || 1) > 1
          )
            throw Object.assign(
              new Error(
                "Use a static JPEG, PNG or WebP up to 4096 pixels per side",
              ),
              { status: 400 },
            );
          created = randomUUID();
          await image
            .rotate()
            .resize({
              width: 1024,
              height: 1024,
              fit: "inside",
              withoutEnlargement: true,
            })
            .webp({ quality: 90 })
            .toFile(path.join(storage, `branding-${created}.webp`));
        }
        await db.runTransaction(async (tx) => {
          const lock = await assertControlAuthority(tx, actor);
          const runtimeRef = db.doc("applicationSettings/runtime"),
            brandingRef = db.doc("conference/branding");
          const [runtime, branding] = await Promise.all([
            tx.get(runtimeRef),
            tx.get(brandingRef),
          ]);
          if ((runtime.data()?.version || 0) !== value.version)
            throw Object.assign(
              new Error("Settings changed. Reload branding before saving."),
              { status: 409 },
            );
          const logoId =
            created ||
            (value.removeLogo === "true"
              ? null
              : branding.data()?.logoId || null);
          const updatedAt = new Date().toISOString();
          tx.set(lock.ref, { version: lock.version });
          tx.set(
            runtimeRef,
            {
              applicationName: value.applicationName,
              version: value.version + 1,
            },
            { merge: true },
          );
          tx.set(brandingRef, {
            applicationName: value.applicationName,
            logoId,
            logoUrl: logoId ? logoUrl(logoId) : null,
            updatedAt,
            version: value.version + 1,
          });
          tx.create(db.collection("auditLogs").doc(), {
            actorUid: actor.uid,
            actorName: actor.fullName,
            action: "branding.update",
            target: "application",
            createdAt: updatedAt,
          });
        });
      } catch (error) {
        if (created)
          await unlink(path.join(storage, `branding-${created}.webp`)).catch(
            () => {},
          );
        throw error;
      }
      res.json(await publicBranding());
    },
  );
}
