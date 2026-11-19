import { type NativeImage, nativeImage } from "electron";

/** BGRA, premultiplied, in place: what a page with no background leaves transparent turns white,
 *  as a browser shows it. JPEG has no alpha, and those pixels would come out black. False when
 *  every pixel was opaque, which is nearly every page */
export function flattenOnWhite(bitmap: Buffer): boolean {
  let changed = false;
  for (let i = 0; i + 3 < bitmap.length; i += 4) {
    const gap = 255 - (bitmap[i + 3] as number);
    if (gap === 0) continue;
    changed = true;
    bitmap[i] = (bitmap[i] as number) + gap;
    bitmap[i + 1] = (bitmap[i + 1] as number) + gap;
    bitmap[i + 2] = (bitmap[i + 2] as number) + gap;
    bitmap[i + 3] = 255;
  }
  return changed;
}

/** The image with nothing transparent left: itself when every pixel was opaque */
export function opaque(img: NativeImage): NativeImage {
  const bitmap = img.toBitmap();
  return flattenOnWhite(bitmap) ? nativeImage.createFromBitmap(bitmap, img.getSize()) : img;
}

export const opaqueJpeg = (img: NativeImage, quality: number): Buffer =>
  opaque(img).toJPEG(quality);
