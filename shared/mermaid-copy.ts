export const MERMAID_COPY_CSS = `
.drop-mermaid { position: relative; margin: 1.5rem 0; }
.drop-mermaid .mermaid { display: flex; justify-content: safe center; margin: 0; }
.drop-mermaid .mermaid svg { max-width: 100%; height: auto; }
.drop-mermaid-tools { position: absolute; z-index: 1; inset-block-start: 0; inset-inline-end: 0; display: flex; gap: .25rem; padding: .25rem; border-radius: .625rem; background: var(--background, #fff); box-shadow: 0 0 0 1px var(--border, #e4e4e7), 0 1px 3px rgb(0 0 0 / .06); opacity: 0; pointer-events: none; }
.drop-mermaid:hover > .drop-mermaid-tools, .drop-mermaid:focus-within > .drop-mermaid-tools { opacity: 1; pointer-events: auto; }
.drop-mermaid-tools button { display: grid; place-items: center; width: 2rem; height: 2rem; padding: 0; border: 0; border-radius: .375rem; background: transparent; color: var(--muted-foreground, #71717a); cursor: pointer; }
.drop-mermaid-tools button:hover { background: var(--muted, #f4f4f5); color: var(--foreground, #18181b); }
.drop-mermaid-tools button:focus-visible, .drop-mermaid-feedback a:focus-visible { outline: 2px solid var(--foreground, #18181b); outline-offset: 2px; }
.drop-mermaid-tools button[aria-disabled="true"] { cursor: wait; opacity: .6; }
.drop-mermaid-tools svg { width: 1rem; height: 1rem; pointer-events: none; }
.drop-mermaid-tools .drop-mermaid-check, .drop-mermaid-tools [data-copied] .drop-mermaid-action { display: none; }
.drop-mermaid-tools [data-copied] .drop-mermaid-check { display: block; }
.drop-mermaid-feedback:not([data-error]) { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; }
.drop-mermaid-feedback[data-error] { display: flex; align-items: baseline; flex-wrap: wrap; gap: .25rem .5rem; margin-block-start: .5rem; color: var(--foreground, #18181b); font: 400 .8125rem/1.5 var(--font-sans, system-ui, sans-serif); }
.drop-mermaid-feedback a { color: inherit; text-underline-offset: .2em; }
.drop-mermaid-feedback [hidden] { display: none; }
@media (hover: none), (pointer: coarse) { .drop-mermaid-tools { opacity: 1; pointer-events: auto; } .drop-mermaid-tools button { width: 2.75rem; height: 2.75rem; } }
@media print { .drop-mermaid-tools, .drop-mermaid-feedback { display: none; } }
`

export const MERMAID_COPY_SCRIPT = String.raw`(() => {
  function start() {
    for (const figure of document.querySelectorAll(".drop-mermaid[data-source]")) {
      const svg = figure.querySelector(".mermaid svg");
      if (!svg || figure.querySelector(".drop-mermaid-tools")) continue;
      const tools = document.createElement("div");
      tools.className = "drop-mermaid-tools";
      const icon = (className, path) => '<svg class="' + className + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
      const check = icon("drop-mermaid-check", '<path d="m3.514 11.83 5.657 5.656L20.485 6.172"/>');
      tools.innerHTML = '<button type="button" aria-label="Copy image" title="Copy image">' + icon("drop-mermaid-action", '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8" cy="8" r="1.5"/><path d="m21 15-5-5L5 21"/>') + check + '</button><button type="button" aria-label="Copy Markdown" title="Copy Markdown">' + icon("drop-mermaid-action", '<path d="m8 7-5 5 5 5m8-10 5 5-5 5m-3-13-2 16"/>') + check + '</button>';
      const feedback = document.createElement("div");
      feedback.className = "drop-mermaid-feedback";
      feedback.innerHTML = '<span role="status"></span><a hidden target="_blank" rel="noopener">Open PNG</a>';
      figure.append(tools, feedback);
      const [imageButton, textButton] = tools.querySelectorAll("button");
      const download = feedback.querySelector("a");
      const status = feedback.querySelector("span");
      const timers = new WeakMap();
      let downloadUrl;
      let source;

      function announce(message, error) {
        status.textContent = message;
        feedback.toggleAttribute("data-error", !!error);
      }

      function copied(button, message) {
        clearTimeout(timers.get(button));
        button.setAttribute("data-copied", "");
        button.title = message;
        announce(message);
        timers.set(button, setTimeout(() => {
          button.removeAttribute("data-copied");
          button.title = button.getAttribute("aria-label");
        }, 1600));
      }

      function png() {
        const clone = svg.cloneNode(true);
        const originals = [svg, ...svg.querySelectorAll("*")];
        const copies = [clone, ...clone.querySelectorAll("*")];
        const properties = ["fill", "stroke", "color", "font-family", "font-size", "font-weight", "font-style", "letter-spacing", "opacity", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "text-anchor", "dominant-baseline", "paint-order"];
        originals.forEach((node, index) => {
          const style = getComputedStyle(node);
          for (const property of properties) copies[index].style.setProperty(property, style.getPropertyValue(property));
        });
        const box = svg.viewBox.baseVal;
        const width = box.width || svg.width.baseVal.value;
        const height = box.height || svg.height.baseVal.value;
        if (!(width > 0 && height > 0)) return Promise.reject(new Error("Diagram has no size"));
        const scale = Math.min(2, 4096 / width, 4096 / height);
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.ceil(width * scale));
        canvas.height = Math.max(1, Math.ceil(height * scale));
        clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
        clone.setAttribute("width", String(width));
        clone.setAttribute("height", String(height));
        clone.style.maxWidth = "none";
        clone.style.height = height + "px";
        const image = new Image();
        return new Promise((resolve, reject) => {
          image.onerror = () => reject(new Error("Diagram could not be drawn"));
          image.onload = () => {
            try {
              const ctx = canvas.getContext("2d");
              if (!ctx) throw new Error("Canvas unavailable");
              ctx.fillStyle = "#fff";
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
              canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("PNG unavailable")), "image/png");
            } catch (error) { reject(error); }
          };
          image.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(new XMLSerializer().serializeToString(clone));
        });
      }

      imageButton.addEventListener("click", async () => {
        if (imageButton.getAttribute("aria-disabled") === "true") return;
        imageButton.setAttribute("aria-disabled", "true");
        announce("Copying image…");
        download.hidden = true;
        // Start the write during the click; Safari lets ClipboardItem wait for the PNG.
        const image = Promise.resolve().then(png);
        try {
          if (!navigator.clipboard || !navigator.clipboard.write || typeof ClipboardItem === "undefined") throw new Error("Clipboard unavailable");
          await navigator.clipboard.write([new ClipboardItem({ "image/png": image })]);
          copied(imageButton, "Image copied");
        } catch {
          try {
            const blob = await image;
            if (downloadUrl) URL.revokeObjectURL(downloadUrl);
            downloadUrl = URL.createObjectURL(blob);
            download.href = downloadUrl;
            download.hidden = false;
            announce("Couldn't copy the image. Open the PNG to save it.", true);
          } catch {
            announce("Couldn't create the image. Try copying the Markdown.", true);
          }
        } finally { imageButton.removeAttribute("aria-disabled"); }
      });

      textButton.addEventListener("click", async () => {
        const content = figure.dataset.source;
        const runs = content.match(/\x60+/g) || [];
        const fence = String.fromCharCode(96).repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
        const markdown = fence + "mermaid\n" + content + (content.endsWith("\n") ? "" : "\n") + fence;
        announce("Copying Markdown…");
        download.hidden = true;
        try {
          await navigator.clipboard.writeText(markdown);
          if (source) source.remove();
          source = undefined;
          copied(textButton, "Markdown copied");
        } catch {
          if (!source) { source = document.createElement("pre"); figure.append(source); }
          source.textContent = markdown;
          const range = document.createRange();
          range.selectNodeContents(source);
          const selection = getSelection();
          if (selection) { selection.removeAllRanges(); selection.addRange(range); }
          announce("Couldn't copy. The Markdown is selected; press Ctrl+C or ⌘C.", true);
        }
      });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})()`
