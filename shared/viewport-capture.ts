// A screenshot of what someone sees in a page, taken inside it: the site review script's (./review-script) for each
// comment, and the comment layer's (./plan-runtime) for a comment on something that shows only for a while.

/** Pinned, and loaded only when someone presses Comment. A page whose CSP blocks it sends comments without a screenshot. */
const SCREENSHOT_MODULE = "https://esm.sh/modern-screenshot@4.7.0"

/**
 * The screenshot: `captureViewport(skip)` draws the viewport as the reviewer sees it, without `skip` (the toolbar),
 * with modern-screenshot from a CDN the first time.
 *
 * modern-screenshot draws a clone of the page that isn't scrolled, and shifts its content up by the scroll offset
 * instead, so a sticky header would sit where the page starts and a fixed button would move with the content: both
 * leave the viewport once the page is scrolled. `pinsNow` records where each visible one is on screen, and its `apply`
 * (modern-screenshot's onCloneEachNode) puts the clone there:
 *
 * - a fixed element becomes absolute, at its rect relative to what contains it in the clone, at its current size;
 * - a sticky element becomes relative, offset from where it would be unstuck, so it keeps its space in the flow and
 *   the content below it doesn't move up.
 *
 * Clones only reach the hook without their original, so originals carry a data attribute for the length of a capture.
 * `describe` names the element under a box, and says when it's on a sticky or fixed one, which doesn't scroll. Needs
 * ELEMENT_NAMING's labelOf.
 *
 * What kept a comment's box from showing for seconds, measured in Firefox on a dashboard (2026-10-29):
 *
 * - Cloning the page reads and copies every computed style of every element: about a second on a dashboard, four on a
 *   long page. It ran before the browser painted the box, and froze the page while it ran. The capture now waits for
 *   the next frame, and the clone hands the main thread back every SLICE_MS, so the box takes typing meanwhile. The
 *   clone walks the page by next siblings, so a page that removes the element just cloned, or one it's inside, in one
 *   of those pauses cuts it short, and that capture is taken again in one go.
 * - modern-screenshot first waits for every image on the page, and lazy images below the fold never load, so it sat
 *   out its whole timeout. The clone embeds each image from its URL anyway, so this wait gets LOAD_WAIT_MS.
 * - In Firefox and Safari it draws the result once more per image and CSS image on the page, 100 ms apart and one
 *   after another (its fixSvgXmlDecode), which an icon-heavy page pays in seconds. MAX_REDRAWS caps it.
 */
export const CAPTURE = String.raw`const MAX_BYTES = 4 * 1024 * 1024, LOAD_WAIT_MS = 300, MAX_REDRAWS = 2, SLICE_MS = 30;
  let screenshotModule = null;
  // Loaded when someone presses Comment, so the box's screenshot can start the moment it's drawn.
  const loadScreenshot = () => (screenshotModule = screenshotModule || import(${JSON.stringify(SCREENSHOT_MODULE)}));
  const painted = () => new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
  // modern-screenshot reads default styles from an iframe it adds, which starts loading its srcdoc then, and a clone
  // that pauses would see its document swap midway. This one has loaded first; null when it didn't within a second,
  // and that clone doesn't pause.
  function sandbox() {
    if (self.origin === "null") return Promise.resolve(shadowSandbox());
    const frame = document.createElement("iframe");
    frame.width = "0"; frame.height = "0"; frame.style.visibility = "hidden"; frame.style.position = "fixed";
    frame.srcdoc = '<!DOCTYPE html><meta charset="UTF-8"><title></title><body>';
    return new Promise((resolve) => {
      const timer = setTimeout(() => { frame.remove(); resolve(null); }, 1000);
      // Chrome fires a load for the frame's first, blank document as it's added; that one gets replaced.
      frame.onload = () => {
        if (frame.contentDocument && frame.contentDocument.URL === "about:srcdoc" && frame.contentDocument.body) { clearTimeout(timer); resolve(frame); }
      };
      document.body.appendChild(frame);
    });
  }
  // In an opaque-origin sandbox, such as Drop's frame without a content origin, every iframe the page adds gets an origin
  // of its own, so modern-screenshot can't read the one it would add. It only reads default styles there, from elements
  // it adds and measures, so it gets a shadow root instead: no style of the page reaches in, and nothing is inherited.
  function shadowSandbox() {
    const host = document.createElement("div");
    host.style.cssText = "all:initial;display:block;position:fixed;left:0;top:0;width:0;height:0;overflow:hidden";
    const root = host.attachShadow({ mode: "closed" });
    document.documentElement.appendChild(host);
    const doc = { body: root, createElement: (name) => document.createElement(name), createElementNS: (ns, name) => document.createElementNS(ns, name) };
    return { contentWindow: { document: doc, getComputedStyle: (el, pseudo) => getComputedStyle(el, pseudo) }, remove: () => host.remove() };
  }
  async function captureViewport(skip) {
    const pins = pinsNow(skip);
    const drawn = [scrollX, scrollY];
    try {
      const { createContext, domToBlob } = await loadScreenshot();
      await painted();
      // If the page scrolled since the box was drawn, the clone is taken where it was drawn, and the page goes back
      // once it's cloned. That clone doesn't pause, so nobody sees the jump.
      const take = async (scale, type, quality, sliced = true) => {
        const frame = sliced ? await sandbox() : null;
        sliced = Boolean(frame);
        // The elements whose clones are still open, outermost first: the filter sees each one as its clone starts.
        const open = [];
        let cut = false, slice = performance.now();
        const filter = (node) => {
          if (node === skip) return false;
          if (node.nodeType === 1) open.push(node);
          return true;
        };
        const each = async (cloned) => {
          pins.apply(cloned);
          const done = open.pop();
          if (!sliced || away || performance.now() - slice < SLICE_MS) return;
          await new Promise((resolve) => setTimeout(resolve, 0));
          slice = performance.now();
          if ((done && !done.isConnected) || open.some((node) => !node.isConnected)) cut = true;
        };
        const context = await createContext(document.documentElement, {
          width: pins.width, height: pins.height, backgroundColor: pins.background, scale, type, quality, timeout: LOAD_WAIT_MS,
          filter, features: { restoreScrollPosition: true }, onCloneEachNode: each, onCloneNode: back,
          onCreateForeignObjectSvg: () => { context.drawImageCount = Math.min(context.drawImageCount, MAX_REDRAWS); },
          autoDestruct: true,
        });
        context.timeout = 15000;
        if (frame) context.sandbox = frame;
        const now = [scrollX, scrollY];
        let away = now[0] !== drawn[0] || now[1] !== drawn[1];
        function back() { if (away) { away = false; scrollTo(now[0], now[1]); } }
        if (away) scrollTo(drawn[0], drawn[1]);
        try {
          const shot = await domToBlob(context);
          return cut ? take(scale, type, quality, false) : shot;
        } finally {
          back();
          if (frame) frame.remove();
        }
      };
      let shot = await take(Math.min(window.devicePixelRatio || 1, 2), "image/webp", 0.85);
      if (shot.size > MAX_BYTES) shot = await take(1, "image/jpeg", 0.75);
      return shot.size <= MAX_BYTES ? shot : null;
    } finally {
      pins.release();
    }
  }

  let pinRun = 0;
  const containsAbsolute = (style) => style.position !== "static" || style.transform !== "none" || style.filter !== "none" || style.perspective !== "none"
    || /paint|layout|strict|content/.test(style.contain || "") || /transform|perspective|filter/.test(style.willChange || "");
  // What an absolute element's position counts from in the clone: the nearest ancestor that contains it, or one whose
  // parent is scrolled, since modern-screenshot moves that one with a transform. Null is the screenshot's top left.
  function containerOf(el) {
    for (let node = el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
      if (containsAbsolute(getComputedStyle(node))) return node;
      const parent = node.parentElement;
      if (parent && (parent.scrollTop || parent.scrollLeft)) return node;
    }
    return null;
  }
  function pinsNow(skip) {
    const attr = "data-drop-pin-" + (++pinRun);
    const found = [];
    const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_ELEMENT);
    for (let el = walker.nextNode(); el; el = walker.nextNode()) {
      if (el === skip) continue;
      const style = getComputedStyle(el);
      if (style.position !== "fixed" && style.position !== "sticky") continue;
      const r = el.getBoundingClientRect();
      if (style.visibility === "hidden" || r.width < 1 || r.height < 1 || r.bottom <= 0 || r.right <= 0 || r.top >= innerHeight || r.left >= innerWidth) continue;
      // In a scrolled element, the clone moves its siblings with transforms, which paints them over it unless it's raised.
      const parent = el.parentElement;
      found.push({ el, sticky: style.position === "sticky", rect: r, raise: style.zIndex === "auto" && Boolean(parent && (parent.scrollTop || parent.scrollLeft)) });
    }
    // Where each sticky element would be unstuck: set static, measured, and put back before the browser paints.
    const sticky = found.filter((pin) => pin.sticky);
    const saved = sticky.map((pin) => pin.el.getAttribute("style"));
    sticky.forEach((pin) => pin.el.style.setProperty("position", "static", "important"));
    sticky.forEach((pin) => { pin.from = pin.el.getBoundingClientRect(); });
    sticky.forEach((pin, i) => {
      // Through the style object first: removing the attribute alone left style="" behind in Chrome.
      pin.el.style.removeProperty("position");
      if (pin.el.getAttribute("style") !== saved[i]) saved[i] === null ? pin.el.removeAttribute("style") : pin.el.setAttribute("style", saved[i]);
    });
    found.forEach((pin, i) => {
      if (!pin.sticky) {
        const box = containerOf(pin.el), parent = pin.el.parentElement;
        const at = box ? box.getBoundingClientRect() : { left: 0, top: 0 };
        // A child of a scrolled element gets that scroll as a transform in the clone; this offsets it.
        pin.left = pin.rect.left - (box ? at.left + box.clientLeft : 0) + (parent ? parent.scrollLeft : 0);
        pin.top = pin.rect.top - (box ? at.top + box.clientTop : 0) + (parent ? parent.scrollTop : 0);
      }
      pin.el.setAttribute(attr, String(i));
    });
    const CLEAR = ["inset", "inset-block-start", "inset-block-end", "inset-inline-start", "inset-inline-end", "right", "bottom",
      "margin-block-start", "margin-block-end", "margin-inline-start", "margin-inline-end", "inline-size", "block-size",
      "min-inline-size", "min-block-size", "max-inline-size", "max-block-size"];
    // The canvas takes the root's background, or the body's: in the clone, the body's covers only its own box.
    const paint = (el) => { const color = el ? getComputedStyle(el).backgroundColor : ""; return color && color !== "transparent" && !/^rgba\(.*,\s*0\)$/.test(color) ? color : null; };
    return {
      width: innerWidth,
      height: innerHeight,
      background: paint(document.documentElement) || paint(document.body) || "#ffffff",
      apply(cloned) {
        if (cloned.nodeType !== 1 || !cloned.hasAttribute(attr)) return;
        const pin = found[Number(cloned.getAttribute(attr))];
        cloned.removeAttribute(attr);
        if (!pin) return;
        const style = cloned.style, set = (name, value) => style.setProperty(name, value, "important");
        CLEAR.forEach((name) => style.removeProperty(name));
        if (pin.raise) set("z-index", "1");
        if (pin.sticky) {
          set("position", "relative");
          set("left", (pin.rect.left - pin.from.left) + "px");
          set("top", (pin.rect.top - pin.from.top) + "px");
          return;
        }
        set("position", "absolute");
        set("left", pin.left + "px");
        set("top", pin.top + "px");
        set("width", pin.rect.width + "px");
        set("height", pin.rect.height + "px");
        set("margin", "0");
        set("box-sizing", "border-box");
        set("min-width", "0"); set("min-height", "0"); set("max-width", "none"); set("max-height", "none");
        // Its rect already includes any translate, as in a centered toast.
        set("transform", "none"); set("translate", "none"); set("rotate", "none"); set("scale", "none");
      },
      release() { found.forEach((pin) => pin.el.removeAttribute(attr)); },
    };
  }

  const PINNED_NAMES = { header: "header", nav: "navigation", footer: "footer", aside: "sidebar", button: "button", a: "link", dialog: "dialog" };
  function describe(el) {
    const label = labelOf(el);
    for (let node = el; node && node !== document.documentElement; node = node.parentElement) {
      const position = getComputedStyle(node).position;
      if (position !== "fixed" && position !== "sticky") continue;
      const role = node.getAttribute("role");
      const what = position + " " + (PINNED_NAMES[node.localName] || (role && /^[a-z]{3,20}$/.test(role) ? role : "element"));
      return node === el ? label + " (" + what + ")" : label + " in a " + what;
    }
    return label;
  }`
