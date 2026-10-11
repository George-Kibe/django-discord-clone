export type PixelCrop = { x: number; y: number; width: number; height: number };

export const IMAGE_OUTPUT_SIZE = 512;
export const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

/** Validates a picked file before cropping (mirrors the backend upload rules). */
export function validateImageFile(file: File): string | null {
  if (!IMAGE_TYPES.includes(file.type)) return "Use a PNG, JPEG, WebP or GIF image.";
  if (file.size > IMAGE_MAX_BYTES) return "Images must be 5 MB or smaller.";
  return null;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Couldn't read that image."));
    image.src = src;
  });
}

/** Renders the selected square region to a JPEG (universally encodable in canvas). */
export async function cropToBlob(src: string, crop: PixelCrop): Promise<Blob> {
  const image = await loadImage(src);
  const canvas = document.createElement("canvas");
  canvas.width = IMAGE_OUTPUT_SIZE;
  canvas.height = IMAGE_OUTPUT_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Your browser can't crop images.");
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    IMAGE_OUTPUT_SIZE,
    IMAGE_OUTPUT_SIZE,
  );
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error("Couldn't process the image."))),
      "image/jpeg",
      0.9,
    ),
  );
}
