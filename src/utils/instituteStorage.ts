/**
 * Cloudinary storage for institute logos and banners.
 *
 * Unlike answer sheets, these are small (<=5MB) jpeg/png/webp images that
 * multer already holds fully in memory, so there is no temp file to stream
 * from or clean up — the buffer is piped straight into Cloudinary's upload
 * stream.
 *
 * Each institute gets exactly one asset per kind, at a fixed public_id
 * (`institutes/{instituteId}/logo` or `.../banner`). Uploading again for the
 * same institute simply overwrites that asset in place, so replacing a logo
 * on edit never needs to track and destroy a superseded asset.
 */

import { Readable } from "stream";
import cloudinary from "./cloudinary";
import logger from "../config/logger";

/** Root folder. Nothing outside this prefix is ever destroyed by this module. */
export const INSTITUTE_ASSET_FOLDER = "institutes";

export type InstituteAssetKind = "logo" | "banner";

export interface StoredInstituteAsset {
  url: string;
  publicId: string;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const publicIdFor = (instituteId: string, kind: InstituteAssetKind): string =>
  `${INSTITUTE_ASSET_FOLDER}/${String(instituteId || "unknown").replace(/[^A-Za-z0-9_-]/g, "")}/${kind}`;

/**
 * Upload one logo or banner from a multer memory-storage buffer.
 *
 * Retries twice on transient failures, same as answer sheets — a flaky
 * connection during registration should not force a school to redo the form.
 */
export const uploadInstituteAsset = async (params: {
  buffer: Buffer;
  instituteId: string;
  kind: InstituteAssetKind;
}): Promise<StoredInstituteAsset> => {
  const { buffer, instituteId, kind } = params;
  const publicId = publicIdFor(instituteId, kind);

  let lastError: any = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const result = await new Promise<any>((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
          {
            public_id: publicId,
            resource_type: "image",
            overwrite: true,
            invalidate: true,
          },
          (error: any, uploaded: any) => {
            if (error) reject(error);
            else resolve(uploaded);
          },
        );

        Readable.from(buffer).pipe(stream);
      });

      return {
        url: result?.secure_url ?? "",
        publicId: result?.public_id ?? publicId,
      };
    } catch (err: any) {
      lastError = err;
      const status = err?.http_code ?? err?.statusCode;
      // 4xx means the file itself is unacceptable; retrying cannot help.
      if (status && status >= 400 && status < 500) break;
      if (attempt < 3) await sleep(attempt * 500);
    }
  }

  throw new Error(
    lastError?.message
      ? `Storage upload failed: ${lastError.message}`
      : "Storage upload failed.",
  );
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

  // Never touch anything outside the institutes tree.
  if (!publicId.startsWith(`${INSTITUTE_ASSET_FOLDER}/`)) {
    logger.warn(`[InstituteAssets] Refused to destroy out-of-scope asset "${publicId}" (${context}).`);
    return false;
  }

  try {
    await cloudinary.uploader.destroy(publicId, {
      resource_type: "image",
      invalidate: true,
    });
    return true;
  } catch (err: any) {
    logger.warn(
      `[InstituteAssets] Could not remove ${publicId} (${context}): ${err?.message || err}`,
    );
    return false;
  }
};
