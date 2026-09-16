'use client';

/**
 * Slow drifting colour blobs behind a screen.
 *
 * ONLY for screens nobody works in — login, signup, password reset. Never behind
 * billing, inventory, khata or reports: a shopkeeper is reading numbers there, and
 * movement in the corner of the eye costs them accuracy and the device battery.
 *
 * Carries no information, so `.fx-ambient` lets the motion setting delete it outright
 * at "Less"/"Off" and under an OS reduced-motion preference. Nothing here may ever
 * become meaningful — if it needs to say something, it is the wrong element.
 *
 * Pure CSS transforms on three blurred divs: no canvas, no rAF loop, no JS running
 * while the shopkeeper types their password.
 */
export default function AmbientBackdrop() {
  return (
    <div className="fx-ambient" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}
