// A person's photo, sent with the add / edit forms as the optional `profilePhoto` file
// (multer has already checked it is a real JPG, PNG or WEBP). It is kept on the user row,
// which their own profile, the top bar and their person page read, and on the role's
// profile row, which older lists read.

/** The path of the photo uploaded with this request, or null. */
export const uploadedPhoto = (files: any): string | null => {
  const file = files?.profilePhoto?.[0];
  return file?.path ? `/${String(file.path).replace(/\\/g, "/")}` : null;
};

/** What an edit does to the photo: a new path, null to take it off (`removePhoto`), or undefined to keep it. */
export const photoChange = (files: any, body: any): string | null | undefined => {
  const uploaded = uploadedPhoto(files);
  if (uploaded) return uploaded;
  return ["true", "1", true].includes(body?.removePhoto) ? null : undefined;
};
