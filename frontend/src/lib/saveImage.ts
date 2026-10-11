import { useEffect, useState } from 'react';

/**
 * Saving an image (payment QR, court pass) the way each phone does it best.
 *
 * - iPhone / iPad: the share sheet. Its "Save Image" puts the picture in Photos, where GCash's
 *   "Upload QR" looks for it; a plain download would land in the Files app instead.
 * - Android and computers: a direct download. It's instant (no sheet to pick from) and shows up in
 *   the gallery's Downloads album.
 * - In-app browsers (Messenger, Facebook, Instagram) often can't download at all; the share sheet is
 *   used when they have one, otherwise the caller shows the image to press and hold.
 *
 * Call it straight from the tap with an image that is already in memory: iOS only opens the share sheet
 * during the tap itself, so awaiting a download or a render first would make it fail. Prefetch with
 * `usePrefetchedImage`.
 */
export type SaveResult = 'shared' | 'downloaded' | 'dismissed' | 'unsupported';

const ua = () => (typeof navigator === 'undefined' ? '' : navigator.userAgent);

export const isIOS = () =>
  /iP(hone|ad|od)/.test(ua()) || (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

const isInAppBrowser = () => /FBAN|FBAV|FB_IAB|FBIOS|Messenger|Instagram|Line\/|TikTok/i.test(ua());

function share(file: File): Promise<SaveResult> | null {
  if (typeof navigator.canShare !== 'function' || !navigator.canShare({ files: [file] })) return null;
  return navigator.share({ files: [file] }).then(
    () => 'shared' as const,
    (e: unknown) => (e instanceof DOMException && e.name === 'AbortError' ? 'dismissed' : 'unsupported')
  );
}

export function downloadBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** iPhone saves to Photos; Android and computers download at once. */
export function saveImage(blob: Blob, name: string): Promise<SaveResult> {
  const file = new File([blob], name, { type: blob.type || 'image/png' });
  if (isIOS() || isInAppBrowser()) {
    const shared = share(file);
    if (shared) return shared;
    if (isInAppBrowser()) return Promise.resolve('unsupported');
  }
  downloadBlob(blob, name);
  return Promise.resolve('downloaded');
}

/** What the save button should say on this phone. */
export const saveLabel = () => (isIOS() ? 'Save to Photos' : 'Download');

/** Fetch an image as soon as it's shown, so saving it later is instant (and allowed on iOS). */
export function usePrefetchedImage(url: string | null | undefined): Blob | null {
  const [blob, setBlob] = useState<Blob | null>(null);
  useEffect(() => {
    setBlob(null);
    if (!url) return;
    let alive = true;
    fetch(url)
      .then((r) => (r.ok ? r.blob() : null))
      .then((b) => alive && b && setBlob(b))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [url]);
  return blob;
}
