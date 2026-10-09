/**
 * A photo from the phone's camera, made small enough to save.
 *
 * A camera photo is 2–5 MB; the server takes product, customer and job photos up to 150 KB
 * (backend/utils/imageField.js). Sent as picked, nearly every real photo was refused with
 * "Photo is too large" and the shopkeeper simply could not add one. So it is redrawn here:
 * longest side at most 800px, as a JPEG, stepping the quality (then the size) down until it
 * fits. A product picture at 800px is sharper than any screen in the app shows it.
 *
 * Rejects with a plain message when the browser cannot read the file at all — an iPhone
 * HEIC on a non-Apple browser, or something that is not a picture.
 */
export const PHOTO_MAX_BYTES = 140 * 1024; // a little under the server's 150 KB

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('UNREADABLE'));
    };
    image.src = url;
  });
}

// Bytes of a base64 data URL, without decoding it.
function dataUrlBytes(dataUrl) {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  return Math.floor((b64.length * 3) / 4);
}

export async function compressPhoto(file, { maxSide = 800, maxBytes = PHOTO_MAX_BYTES } = {}) {
  if (!file || !String(file.type || '').startsWith('image/')) throw new Error('NOT_IMAGE');
  const image = await loadImage(file);

  for (const side of [maxSide, 600, 400]) {
    const scale = Math.min(1, side / Math.max(image.naturalWidth || image.width, image.naturalHeight || image.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((image.naturalWidth || image.width) * scale));
    canvas.height = Math.max(1, Math.round((image.naturalHeight || image.height) * scale));
    const ctx = canvas.getContext('2d');
    // JPEG has no transparency: a cut-out product PNG gets a white ground, not black.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.7, 0.58, 0.46]) {
      const dataUrl = canvas.toDataURL('image/jpeg', quality);
      if (dataUrlBytes(dataUrl) <= maxBytes) return dataUrl;
    }
  }
  throw new Error('TOO_BIG');
}
