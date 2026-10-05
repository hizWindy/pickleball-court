const MAX_EDGE = 1600;
const SMALL_ENOUGH = 1.2 * 1024 * 1024;

/**
 * Shrink a receipt photo before upload so it goes through quickly on mobile data.
 * Screenshots are usually already small and are sent untouched. If the browser
 * can't decode the file (e.g. HEIC on Android), the original is sent; the server accepts it.
 */
export async function prepareReceipt(file: File): Promise<Blob> {
  const simpleType = ['image/jpeg', 'image/png', 'image/webp'].includes(file.type);
  if (simpleType && file.size <= SMALL_ENOUGH) return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.86));
    return blob && blob.size < file.size ? blob : file;
  } catch {
    return file;
  }
}
