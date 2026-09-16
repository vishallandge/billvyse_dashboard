// Centralizes camera-scanner setup so the perf tuning below lives in one place instead
// of being copy-pasted per page.
//
// useBarCodeDetectorIfSupported is forced OFF on purpose. When true, html5-qrcode tries
// to construct the browser's *native* BarcodeDetector with our exact formatsToSupport
// list — and on many desktop browsers (Windows Chrome/Edge in particular) the native
// implementation doesn't support every format in that list, so the constructor throws
// synchronously and scanner startup fails before the camera even opens ("scan with
// camera does nothing"). The pure JS/WASM (ZXing) decoder below doesn't have that
// platform-support landmine — it works the same everywhere, which matters more here
// than the extra speed native detection gives on the (fewer) devices where it works.
//
// The formats/resolution tuning still meaningfully speeds up the JS decoder itself:
// restricting to the formats retail packs actually carry (~9 instead of ~17) cuts decode
// work per frame, and capping resolution avoids handing it a needlessly large (1080p+)
// frame to process each tick.
//
// QR_CODE and DATA_MATRIX are in that list now, and they are the whole point of this
// round: a 2026 pack carries a QR *next to* its barcode (and a medicine strip often carries
// only a GS1 DataMatrix), so a scanner that reads bars only fails on the code the
// shopkeeper is pointing it at. What comes back from a 2D symbol is not a bare number —
// see lib/scanCode.js, which turns it into a product before anything looks it up.
export async function startBarcodeScanner({ elementId, onDecode }) {
  const { Html5Qrcode, Html5QrcodeSupportedFormats } = await import('html5-qrcode');

  const scanner = new Html5Qrcode(elementId, {
    formatsToSupport: [
      Html5QrcodeSupportedFormats.EAN_13,
      Html5QrcodeSupportedFormats.EAN_8,
      Html5QrcodeSupportedFormats.UPC_A,
      Html5QrcodeSupportedFormats.UPC_E,
      Html5QrcodeSupportedFormats.CODE_128,
      Html5QrcodeSupportedFormats.CODE_39,
      // 2D symbols. QR is what the shop's own printed sticker carries and what brands now
      // print alongside the barcode; DataMatrix is what pharma cartons and strips use.
      Html5QrcodeSupportedFormats.QR_CODE,
      Html5QrcodeSupportedFormats.DATA_MATRIX,
      // Cartons and outer cases (a wholesaler's box) are usually ITF-14.
      Html5QrcodeSupportedFormats.ITF,
    ],
    useBarCodeDetectorIfSupported: false,
    verbose: false,
  });

  await scanner.start(
    { facingMode: 'environment' },
    {
      fps: 15,
      // The scan box has to hold the WHOLE symbol or nothing decodes, and a QR is square.
      // The old fixed 280×140 letterbox physically could not contain one — pointing the
      // camera at a QR simply did nothing, which is the bug this round starts from. Sized
      // from the actual viewfinder instead: wide enough for a long EAN, tall enough that a
      // square symbol fits inside it, and never larger than the preview.
      qrbox: (viewfinderWidth, viewfinderHeight) => {
        const width = Math.max(160, Math.min(viewfinderWidth * 0.9, 360));
        const height = Math.max(160, Math.min(viewfinderHeight * 0.75, width));
        return { width: Math.round(width), height: Math.round(height) };
      },
      videoConstraints: {
        facingMode: 'environment',
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
    },
    async (decodedText) => {
      await scanner.stop().catch(() => {});
      onDecode(decodedText);
    },
    () => {}
  );

  return scanner;
}
