import type { Express, NextFunction, Request, Response } from "express";
import { mkdir, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import rateLimit from "express-rate-limit";
import multer from "multer";
import sharp from "sharp";
import { z } from "zod";
import { auth, db } from "./firebase.js";
import { can, type Actor } from "../shared/schema.js";

type Participant = { uid: string; email: string };
const fail = (message: string, status: number) =>
  Object.assign(new Error(message), { status });
const fileName = (uid: string) => `${uid}.jpg`;

// Mobile app sessions are rejected by the dashboard middleware, so these
// routes authenticate the participant's own Firebase ID token instead.
async function participant(req: Request): Promise<Participant> {
  const token = req.headers.authorization?.match(/^Bearer (.+)$/)?.[1];
  if (!token) throw fail("Sign in to continue", 401);
  let decoded;
  try {
    decoded = await auth.verifyIdToken(token, true);
  } catch {
    throw fail("Your session has expired. Sign in again.", 401);
  }
  if (!decoded.email || !decoded.email_verified)
    throw fail("Verify your email before uploading a selfie", 403);
  const email = decoded.email.toLowerCase();
  const person = (await db.doc(`people/${email}`).get()).data();
  if (
    !person ||
    person.archivedAt ||
    ["cancelled", "suspended"].includes(person.registrationStatus)
  )
    throw fail("No active registration for this account", 403);
  return { uid: decoded.uid, email };
}

export function registerMobileSelfie(app: Express, storage: string) {
  const folder = path.join(storage, "selfies");
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 8 * 1024 * 1024, files: 1, fields: 0 },
  });
  const limit = rateLimit({ windowMs: 60_000, limit: 10 });
  const receive = (req: Request, res: Response, next: NextFunction) =>
    upload.single("selfie")(req, res, (error) =>
      next(
        error &&
          fail(
            error.code === "LIMIT_FILE_SIZE"
              ? "Selfie must be 8 MB or smaller"
              : "Send one image in the 'selfie' form field",
            error.code === "LIMIT_FILE_SIZE" ? 413 : 400,
          ),
      ),
    );

  app.post("/api/mobile/selfie", limit, async (req, res) => {
    const user = await participant(req);
    await new Promise<void>((resolve, reject) =>
      receive(req, res, (error?: unknown) =>
        error ? reject(error) : resolve(),
      ),
    );
    if (!req.file) throw fail("Send the photo in the 'selfie' form field", 400);
    const image = sharp(req.file.buffer, { limitInputPixels: 8192 * 8192 });
    let metadata;
    try {
      metadata = await image.metadata();
    } catch {
      throw fail("Invalid image. Use JPEG, PNG or WebP.", 400);
    }
    if (
      !["jpeg", "png", "webp", "heif"].includes(metadata.format || "") ||
      (metadata.pages || 1) > 1
    )
      throw fail("Use a single JPEG, PNG, WebP or HEIC photo", 400);
    await mkdir(folder, { recursive: true });
    // Re-encoding applies EXIF orientation and drops all metadata, including
    // any GPS location the phone embedded. Write-then-rename keeps the
    // previous selfie intact if anything fails part-way.
    const target = path.join(folder, fileName(user.uid));
    const temporary = path.join(folder, `.${randomUUID()}.tmp`);
    try {
      await image
        .rotate()
        .resize({
          width: 1024,
          height: 1024,
          fit: "inside",
          withoutEnlargement: true,
        })
        .jpeg({ quality: 85, mozjpeg: true })
        .toFile(temporary);
      await rename(temporary, target);
    } catch (error) {
      await unlink(temporary).catch(() => {});
      throw error;
    }
    const updatedAt = new Date().toISOString();
    await db.doc(`people/${user.email}`).update({
      selfieKey: `selfies/${fileName(user.uid)}`,
      selfieUpdatedAt: updatedAt,
    });
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json({ saved: true, updatedAt });
  });

  app.get("/api/mobile/selfie", limit, async (req, res) => {
    const user = await participant(req);
    res.setHeader("Cache-Control", "private, no-store");
    res
      .type("image/jpeg")
      .sendFile(fileName(user.uid), { root: folder }, (error) => {
        if (error && !res.headersSent)
          res.status(404).json({ error: "No selfie uploaded yet" });
      });
  });

  app.delete("/api/mobile/selfie", limit, async (req, res) => {
    const user = await participant(req);
    await unlink(path.join(folder, fileName(user.uid))).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
    await db.doc(`people/${user.email}`).update({
      selfieKey: null,
      selfieUpdatedAt: null,
    });
    res.json({ deleted: true });
  });
}

// Dashboard staff with participant read access can view a person's selfie.
// Registered after the dashboard authentication middleware.
export function registerSelfieAdmin(app: Express, storage: string) {
  const folder = path.join(storage, "selfies");
  app.get("/api/people/:email/selfie", async (req, res) => {
    const actor = (req as unknown as { actor: Actor }).actor;
    if (!can(actor, "participants", "read"))
      throw fail("You do not have permission for this action", 403);
    const email = z.email().parse(req.params.email).toLowerCase();
    const key = (await db.doc(`people/${email}`).get()).data()?.selfieKey;
    const name = typeof key === "string" ? key.replace(/^selfies\//, "") : "";
    if (!/^[A-Za-z0-9_-]{1,128}\.jpg$/.test(name))
      throw fail("No selfie uploaded for this participant", 404);
    res.setHeader("Cache-Control", "private, no-store");
    res.type("image/jpeg").sendFile(name, { root: folder }, (error) => {
      if (error && !res.headersSent)
        res
          .status(404)
          .json({ error: "No selfie uploaded for this participant" });
    });
  });
}
