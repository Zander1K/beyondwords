// Get a photo ready to send for reading a book: no larger than the model needs, as a JPEG.
// A phone photo is several MB; the barcode and the cover text read fine at 1600 px.

const MAX_SIDE = 1600;
const QUALITY = 0.85;

export async function preparePhoto(file: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale)),
    );
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await canvas.convertToBlob({ type: "image/jpeg", quality: QUALITY });
  } finally {
    bitmap.close();
  }
}

/**
 * A still from the live camera, as a JPEG for reading a book's barcode. Larger and finer than
 * `preparePhoto`: the ISBN under a barcode is small print, and a webcam frame is the only picture.
 */
export async function frameToJpeg(
  video: HTMLVideoElement,
  maxSide = 2000,
  quality = 0.92,
): Promise<Blob> {
  const bitmap = await createImageBitmap(video);
  try {
    const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
    const canvas = new OffscreenCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale)),
    );
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d canvas");
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await canvas.convertToBlob({ type: "image/jpeg", quality });
  } finally {
    bitmap.close();
  }
}
