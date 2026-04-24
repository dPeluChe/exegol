/**
 * T102: Design Mode capture library.
 *
 * Provides an injection script for Electron webviews that enables interactive
 * element selection, plus TypeScript types and formatters for the captured data.
 *
 * Usage:
 *   webview.executeJavaScript(DESIGN_MODE_INJECTION_SCRIPT);
 *   // later: webview.executeJavaScript('window.__exegolDesignDisable()');
 */

// ─── Types ─────────────────────────────────────────────────────────────────

export interface CapturedElement {
  selector: string;
  tagName: string;
  textContent: string;
  htmlSnippet: string;
  rect: { x: number; y: number; width: number; height: number };
  styles: {
    color: string;
    backgroundColor: string;
    fontSize: string;
    fontFamily: string;
    padding: string;
    margin: string;
    borderRadius: string;
  };
  screenshotBase64?: string;
}

// ─── CSS Selector Generator ────────────────────────────────────────────────

/**
 * Build a unique CSS selector for the given element.
 * Strategy: use #id if present, otherwise build a chain of
 * tagName:nth-of-type(n) up to 4 ancestor levels.
 */
export function getCssSelector(el: Element): string {
  if (el.id) return `#${CSS.escape(el.id)}`;

  const parts: string[] = [];
  let current: Element | null = el;
  const MAX_DEPTH = 4;

  for (let depth = 0; current && depth < MAX_DEPTH; depth++) {
    // If we hit an element with an id, anchor there and stop
    if (depth > 0 && current.id) {
      parts.unshift(`#${CSS.escape(current.id)}`);
      break;
    }

    const tag = current.tagName.toLowerCase();
    const parent: Element | null = current.parentElement;

    if (parent) {
      const currentTag = current.tagName;
      const siblings = Array.from(parent.children).filter((c: Element) => c.tagName === currentTag);
      if (siblings.length > 1) {
        const index = siblings.indexOf(current) + 1;
        parts.unshift(`${tag}:nth-of-type(${index})`);
      } else {
        // Add class names for specificity when there's only one of the tag type
        const classes = Array.from(current.classList)
          .filter((c) => /^[a-zA-Z_-]/.test(c))
          .slice(0, 2)
          .map((c) => `.${CSS.escape(c)}`)
          .join("");
        parts.unshift(`${tag}${classes}`);
      }
    } else {
      parts.unshift(tag);
    }

    current = parent;
  }

  return parts.join(" > ");
}

// ─── Context Formatter ─────────────────────────────────────────────────────

/**
 * Combine captured element info with an optional issue description into a
 * prompt-ready string. Falls back to formatElementForAgent when message is empty.
 */
export function buildDesignIssue(element: CapturedElement, message: string): string {
  const base = formatElementForAgent(element);
  const trimmed = message.trim();
  return trimmed ? `${base}\n\nIssue: ${trimmed}` : base;
}

/**
 * Format a CapturedElement into a prompt-ready string suitable for
 * injecting into an agent's stdin.
 */
export function formatElementForAgent(element: CapturedElement): string {
  const { selector, tagName, textContent, htmlSnippet, rect, styles } = element;

  const pos = `(${Math.round(rect.x)}, ${Math.round(rect.y)})`;
  const size = `${Math.round(rect.width)}x${Math.round(rect.height)}px`;

  // Normalise font-family: take first family, strip quotes
  const fontShort = styles.fontFamily.split(",")[0]?.trim().replace(/["']/g, "") ?? "";
  const font = `${styles.fontSize} ${fontShort}`;

  const styleStr = [
    `color=${styles.color}`,
    `bg=${styles.backgroundColor}`,
    `font=${font}`,
    `padding=${styles.padding}`,
    `radius=${styles.borderRadius}`,
  ].join(", ");

  const textLine = textContent ? `Text: "${textContent.slice(0, 120)}"` : "";

  return [
    `[Design Capture] Element: <${tagName.toLowerCase()}> at ${pos} ${size}`,
    `Selector: ${selector}`,
    `Styles: ${styleStr}`,
    `HTML: ${htmlSnippet.slice(0, 500)}`,
    textLine,
  ]
    .filter(Boolean)
    .join("\n");
}

// ─── Injection Script ──────────────────────────────────────────────────────

/**
 * Self-contained JavaScript to inject into an Electron webview.
 * Creates an overlay for element highlighting and captures click targets.
 *
 * Exposes:
 *   window.__exegolDesignCapture  — last captured CapturedElement (or null)
 *   window.__exegolDesignDisable() — removes all listeners and overlay
 */
export const DESIGN_MODE_INJECTION_SCRIPT = `(function() {
  'use strict';

  // Guard against double-injection
  if (window.__exegolDesignActive) return;
  window.__exegolDesignActive = true;
  window.__exegolDesignCapture = null;

  // ── Overlay ──────────────────────────────────────────────────────────
  var overlay = document.createElement('div');
  overlay.id = '__exegol-design-overlay';
  overlay.style.cssText = [
    'position:fixed',
    'pointer-events:none',
    'z-index:999999',
    'border:2px solid #3b82f6',
    'background:rgba(59,130,246,0.08)',
    'transition:all 80ms ease-out',
    'display:none',
    'box-sizing:border-box'
  ].join(';');
  document.documentElement.appendChild(overlay);

  // ── Tooltip ──────────────────────────────────────────────────────────
  var tooltip = document.createElement('div');
  tooltip.id = '__exegol-design-tooltip';
  tooltip.style.cssText = [
    'position:fixed',
    'pointer-events:none',
    'z-index:1000000',
    'background:#1e293b',
    'color:#e2e8f0',
    'font:11px/1.3 -apple-system,BlinkMacSystemFont,sans-serif',
    'padding:3px 6px',
    'border-radius:4px',
    'white-space:nowrap',
    'display:none',
    'max-width:300px',
    'overflow:hidden',
    'text-overflow:ellipsis'
  ].join(';');
  document.documentElement.appendChild(tooltip);

  var currentEl = null;

  // ── Selector builder ─────────────────────────────────────────────────
  function getCssSelector(el) {
    if (el.id) return '#' + CSS.escape(el.id);
    var parts = [];
    var cur = el;
    for (var d = 0; cur && d < 4; d++) {
      if (d > 0 && cur.id) {
        parts.unshift('#' + CSS.escape(cur.id));
        break;
      }
      var tag = cur.tagName.toLowerCase();
      var parent = cur.parentElement;
      if (parent) {
        var siblings = [];
        for (var i = 0; i < parent.children.length; i++) {
          if (parent.children[i].tagName === cur.tagName) siblings.push(parent.children[i]);
        }
        if (siblings.length > 1) {
          var idx = siblings.indexOf(cur) + 1;
          parts.unshift(tag + ':nth-of-type(' + idx + ')');
        } else {
          var cls = '';
          for (var j = 0; j < cur.classList.length && j < 2; j++) {
            var c = cur.classList[j];
            if (/^[a-zA-Z_-]/.test(c)) cls += '.' + CSS.escape(c);
          }
          parts.unshift(tag + cls);
        }
      } else {
        parts.unshift(tag);
      }
      cur = parent;
    }
    return parts.join(' > ');
  }

  // ── Capture builder ──────────────────────────────────────────────────
  function captureElement(el) {
    var rect = el.getBoundingClientRect();
    var cs = window.getComputedStyle(el);
    var text = (el.textContent || '').trim();
    if (text.length > 200) text = text.slice(0, 200);

    // Build a shallow HTML snippet (outer element only, no deep children)
    var clone = el.cloneNode(false);
    var inner = el.innerHTML;
    if (inner.length > 300) inner = inner.slice(0, 300) + '...';
    clone.innerHTML = inner;
    var html = clone.outerHTML;
    if (html.length > 500) html = html.slice(0, 500) + '...';

    return {
      selector: getCssSelector(el),
      tagName: el.tagName.toLowerCase(),
      textContent: text,
      htmlSnippet: html,
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      },
      styles: {
        color: cs.color,
        backgroundColor: cs.backgroundColor,
        fontSize: cs.fontSize,
        fontFamily: cs.fontFamily,
        padding: cs.padding,
        margin: cs.margin,
        borderRadius: cs.borderRadius
      }
    };
  }

  // ── Event Handlers ───────────────────────────────────────────────────
  function onMouseMove(e) {
    var el = document.elementFromPoint(e.clientX, e.clientY);
    if (!el || el === overlay || el === tooltip || el === document.documentElement || el === document.body) {
      overlay.style.display = 'none';
      tooltip.style.display = 'none';
      currentEl = null;
      return;
    }
    currentEl = el;
    var rect = el.getBoundingClientRect();

    overlay.style.display = 'block';
    overlay.style.top = rect.top + 'px';
    overlay.style.left = rect.left + 'px';
    overlay.style.width = rect.width + 'px';
    overlay.style.height = rect.height + 'px';

    var tag = el.tagName.toLowerCase();
    var dims = Math.round(rect.width) + 'x' + Math.round(rect.height);
    var cls = el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.')
      : '';
    tooltip.textContent = tag + cls + '  ' + dims;
    tooltip.style.display = 'block';

    // Position tooltip above the element, fallback below if no room
    var ty = rect.top - 24;
    if (ty < 4) ty = rect.bottom + 4;
    var tx = rect.left;
    if (tx + 300 > window.innerWidth) tx = window.innerWidth - 304;
    if (tx < 4) tx = 4;
    tooltip.style.top = ty + 'px';
    tooltip.style.left = tx + 'px';
  }

  function onClick(e) {
    if (!currentEl) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    var captured = captureElement(currentEl);
    window.__exegolDesignCapture = captured;

    // Dispatch a custom event so the host can listen
    window.dispatchEvent(new CustomEvent('exegol-design-capture', { detail: captured }));
  }

  // ── Lifecycle ────────────────────────────────────────────────────────
  document.addEventListener('mousemove', onMouseMove, true);
  document.addEventListener('click', onClick, true);

  window.__exegolDesignDisable = function() {
    document.removeEventListener('mousemove', onMouseMove, true);
    document.removeEventListener('click', onClick, true);
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    if (tooltip.parentNode) tooltip.parentNode.removeChild(tooltip);
    window.__exegolDesignActive = false;
    window.__exegolDesignCapture = null;
    delete window.__exegolDesignDisable;
  };
})();`;
