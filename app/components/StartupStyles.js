// Critical startup styles survive a delayed external stylesheet.
// Static trusted CSS must remain raw text: HTML entities are not decoded inside style tags.
// Zero specificity allows the full themed stylesheet to override these defaults.
export default function StartupStyles() {
  return <style dangerouslySetInnerHTML={{ __html: `
    :where(body) { margin: 0; }
    :where(.boot-splash) { position: fixed; inset: 0; z-index: 60; box-sizing: border-box; display: flex; align-items: center; justify-content: center; padding: 24px; background: var(--bg, #101014); color: var(--text, #f0f2f8); font-family: var(--font-latin, 'Segoe UI'), sans-serif; transition: opacity .34s ease; }
    :where(html[data-theme='light'] .boot-splash) { background: var(--bg, #eef0f4); color: #182337; }
    :where(.boot-splash.is-leaving) { opacity: 0; pointer-events: none; }
    :where(.splash-loader, .splash-wordmark) { display: flex; flex-direction: column; align-items: center; text-align: center; }
    :where(.splash-loader) { gap: 18px; }
    :where(.splash-badge) { position: relative; display: flex; align-items: center; justify-content: center; width: 68px; height: 68px; }
    :where(.splash-mark) { width: 52px; height: 52px; object-fit: contain; }
    :where(.splash-spinner) { position: absolute; inset: 0; border: 2px solid #3d86ea33; border-top-color: #3d86ea; border-radius: 50%; animation: startup-spin .9s linear infinite; }
    :where(.splash-text) { margin: 0; font-size: 24px; font-weight: 700; letter-spacing: -.03em; color: var(--brand-light, #9dc4f7); }
    :where(.splash-text-v) { color: var(--success, #4ade80); }
    :where(.splash-tagline) { margin: 8px 0 0; font-size: 11px; line-height: 1.5; letter-spacing: .12em; text-transform: uppercase; }
    :where(.sr-only) { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0,0,0,0); white-space: nowrap; border: 0; }
    @keyframes startup-spin { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) { :where(.splash-spinner) { animation: none; } :where(.boot-splash) { transition: none; } }
    :where(html[data-motion='off'] .splash-spinner) { animation: none; }
  ` }} />;
}
