/**
 * Storage of institute logos: on this server's disk, under uploads/institutes/logos/ — public,
 * served at /uploads/… (logos appear on papers, result PDFs and the sign-in page).
 *
 * Each upload is a new file with a server-chosen name, so no browser shows a cached old logo. A
 * replaced logo is kept: question papers keep the logo address they were made with. A local
 * asset's id is its web path ("/uploads/institutes/logos/…").
 *
 * Logos stored in Cloudinary before this stay there (their ids don't start with "/uploads/") and
 * keep loading from their public links; this module no longer talks to Cloudinary, so such a
 * logo is left there when its institute is deleted.
 */

import path from "path";
import { randomUUID } from "crypto";
import logger from "../config/logger";
import { sniffFileType } from "./fileSignature";
import { UPLOADS_ROOT, localPathOf, removeStoredFile, safeSegment, webPathOf, writeStoredFile } from "./localFileStorage";

/** Root folder. Nothing outside this prefix is ever destroyed by this module. */
export const INSTITUTE_ASSET_FOLDER = "institutes";

export type InstituteAssetKind = "logo" | "banner";

export interface StoredInstituteAsset {
  url: string;
  publicId: string;
}

const LOCAL_ROOT = path.join(UPLOADS_ROOT, INSTITUTE_ASSET_FOLDER);
const FOLDER_OF: Record<InstituteAssetKind, string> = { logo: "logos", banner: "banners" };

/** Store one logo or banner from a multer memory-storage buffer (its bytes already checked by verifyUploads). */
export const uploadInstituteAsset = async (params: {
  buffer: Buffer;
  instituteId: string;
  kind: InstituteAssetKind;
}): Promise<StoredInstituteAsset> => {
  const { buffer, instituteId, kind } = params;
  const detected = sniffFileType(buffer.subarray(0, 1024));
  if (!detected || !detected.mime.startsWith("image/")) {
    throw new Error("The logo is not a JPG, PNG or WEBP image.");
  }

  const name = `${safeSegment(instituteId)}-${randomUUID()}${detected.ext}`;
  const file = await writeStoredFile(path.join(LOCAL_ROOT, FOLDER_OF[kind]), name, buffer);
  const url = webPathOf(file);
  return { url, publicId: url };
};

/**
 * Remove a stored logo/banner. Best effort by design: a storage hiccup here
 * must never surface as a failed institute update or delete.
 */
export const destroyInstituteAsset = async (
  publicId: string | null | undefined,
  context: string,
): Promise<boolean> => {
  if (!publicId) return false;

  if (publicId.startsWith("/uploads/")) {
    return removeStoredFile(localPathOf(publicId), LOCAL_ROOT, context);
  }

  // Stored in Cloudinary before the move to local storage: this API no longer deletes there.
  logger.info(`[InstituteAssets] ${publicId} is an older Cloudinary file; left there (${context}).`);
  return false;
};
