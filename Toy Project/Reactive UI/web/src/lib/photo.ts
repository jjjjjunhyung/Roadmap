/**
 * A phone photo made small enough to send: drawn upright onto a canvas and saved as a JPEG
 * (longest side 2048). The canvas keeps only pixels, so location and camera data stay behind;
 * the server re-encodes again anyway.
 */
export async function shrink(file: File, max = 2048): Promise<Blob> {
  const source = await decode(file);
  const scale = Math.min(1, max / Math.max(source.width, source.height));
  const w = Math.max(1, Math.round(source.width * scale));
  const h = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("사진을 줄이지 못했어");
  ctx.drawImage(source.image, 0, 0, w, h);
  if ("close" in source.image) source.image.close();
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("사진을 줄이지 못했어"))),
      "image/jpeg",
      0.88,
    ),
  );
}

async function decode(
  file: File,
): Promise<{ image: ImageBitmap | HTMLImageElement; width: number; height: number }> {
  try {
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    return { image: bmp, width: bmp.width, height: bmp.height };
  } catch {
    // older Safari: an <img> also applies the photo's orientation
    const url = URL.createObjectURL(file);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      return { image: img, width: img.naturalWidth, height: img.naturalHeight };
    } catch {
      throw new Error("이 사진은 열 수 없어. JPG나 HEIC 사진으로 골라 줘");
    } finally {
      URL.revokeObjectURL(url);
    }
  }
}
