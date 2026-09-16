/**
 * A minimal CSS colour resolver: #hex, rgb()/rgba(), var() chains, and
 * color-mix(in srgb, <c> <p>%, <c>).
 *
 * It exists because the sidebar's --nav-bg is ALWAYS written as a color-mix, so
 * without this the contrast harness could only assume the rail's value from the
 * documented formula — and an assumed value is exactly how it missed the bug it
 * had just been extended to catch: four scenes overrode --nav-bg with a dark plank
 * in light mode, the check computed the formula instead of reading the override,
 * and it reported everything fine while the navigation was unreadable.
 *
 * Read what the stylesheet says. Never what it ought to say.
 */

export function parseColor(v) {
  const s = String(v || '').trim();
  if (s.startsWith('#')) {
    let h = s.slice(1);
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    if (!/^[0-9a-f]{6}$/i.test(h)) return null;
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), 1];
  }
  if (s === 'transparent') return [0, 0, 0, 0];
  const m = s.match(/^rgba?\(([^)]+)\)$/i);
  if (!m) return null;
  const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
  if (p.slice(0, 3).some(Number.isNaN)) return null;
  return [p[0], p[1], p[2], p[3] === undefined ? 1 : p[3]];
}

/** Split on top-level commas only — the operands are themselves functions. */
function topLevelSplit(str) {
  const parts = [];
  let buf = '';
  let depth = 0;
  for (const ch of str) {
    if (ch === '(') depth += 1;
    if (ch === ')') depth -= 1;
    if (ch === ',' && depth === 0) { parts.push(buf); buf = ''; continue; }
    buf += ch;
  }
  parts.push(buf);
  return parts;
}

export function resolveColor(raw, vars, depth = 0) {
  if (raw === undefined || raw === null || depth > 12) return null;
  const v = String(raw).trim();

  const direct = parseColor(v);
  if (direct) return direct;

  if (v.startsWith('var(')) {
    const inner = v.slice(4, v.lastIndexOf(')'));
    const [name, ...fallback] = topLevelSplit(inner);
    const key = name.trim();
    if (Object.prototype.hasOwnProperty.call(vars, key)) {
      return resolveColor(vars[key], vars, depth + 1);
    }
    return fallback.length ? resolveColor(fallback.join(',').trim(), vars, depth + 1) : null;
  }

  if (v.toLowerCase().startsWith('color-mix(')) {
    const inner = v.slice(v.indexOf('(') + 1, v.lastIndexOf(')'));
    const parts = topLevelSplit(inner);
    if (parts.length < 3) return null; // first part is the colour space

    const readSide = (side) => {
      const t = side.trim();
      const pm = t.match(/(^|\s)([\d.]+)%$/) || t.match(/^([\d.]+)%\s/);
      const pct = pm ? parseFloat(pm[2] !== undefined ? pm[2] : pm[1]) : null;
      const colour = t.replace(/(^|\s)[\d.]+%$/, '').replace(/^[\d.]+%\s/, '').trim();
      return { pct, colour };
    };

    const a = readSide(parts[1]);
    const b = readSide(parts[2]);
    const A = resolveColor(a.colour, vars, depth + 1);
    const B = resolveColor(b.colour, vars, depth + 1);
    if (!A || !B) return null;

    // Whichever side carries the percentage owns it; the other takes the remainder.
    let pa;
    if (a.pct !== null) pa = a.pct / 100;
    else if (b.pct !== null) pa = 1 - b.pct / 100;
    else pa = 0.5;

    // Alpha composites too — a translucent operand really is translucent.
    const out = [0, 1, 2].map((i) => A[i] * pa + B[i] * (1 - pa));
    out.push(A[3] * pa + B[3] * (1 - pa));
    return out;
  }

  return null;
}
