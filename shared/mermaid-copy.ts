export const MERMAID_COPY_CSS = `
.drop-mermaid { margin: 1.5rem 0; }
.drop-mermaid .mermaid { display: flex; justify-content: safe center; margin: 0; }
.drop-mermaid .mermaid svg { max-width: 100%; height: auto; }
.drop-mermaid-tools { display: flex; justify-content: flex-end; align-items: center; flex-wrap: wrap; gap: .5rem; margin-bottom: .5rem; font: 13px/1.5 system-ui, sans-serif; }
.drop-mermaid-tools button, .drop-mermaid-tools a { border: 1px solid var(--border, #e4e4e7); border-radius: 6px; padding: .375rem .625rem; background: var(--background, #fff); color: var(--foreground, #18181b); font: inherit; cursor: pointer; }
.drop-mermaid-tools button:hover { background: var(--muted, #f4f4f5); }
.drop-mermaid-tools :focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
.drop-mermaid-tools button:disabled { cursor: wait; }
.drop-mermaid-status { flex-basis: 100%; text-align: right; }
@media print { .drop-mermaid-tools { display: none; } }
`

export const MERMAID_COPY_SCRIPT = String.raw`(() => {
  function start() {
    for (const figure of document.querySelectorAll(".drop-mermaid[data-source]")) {
      const svg = figure.querySelector(".mermaid svg");
      if (!svg || figure.querySelector(".drop-mermaid-tools")) continue;
      const tools = document.createElement("div");
      tools.className = "drop-mermaid-tools";
      tools.innerHTML = '<button type="button">Copy image</button><button type="button">Copy Markdown</button><a hidden target="_blank" rel="noopener">Open PNG</a><span class="drop-mermaid-status" role="status"></span>';
      figure.prepend(tools);
      const [imageButton, textButton] = tools.querySelectorAll("button");
      const download = tools.querySelector("a");
      const status = tools.querySelector("[role=status]");
      let downloadUrl;
      let source;

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
        imageButton.disabled = true;
        status.textContent = "Copying image…";
        download.hidden = true;
        // Start the write during the click; Safari lets ClipboardItem wait for the PNG.
        const image = Promise.resolve().then(png);
        try {
          if (!navigator.clipboard || !navigator.clipboard.write || typeof ClipboardItem === "undefined") throw new Error("Clipboard unavailable");
          await navigator.clipboard.write([new ClipboardItem({ "image/png": image })]);
          status.textContent = "Image copied";
        } catch {
          try {
            const blob = await image;
            if (downloadUrl) URL.revokeObjectURL(downloadUrl);
            downloadUrl = URL.createObjectURL(blob);
            download.href = downloadUrl;
            download.hidden = false;
            status.textContent = "Couldn't copy the image. Open the PNG to save it.";
          } catch {
            status.textContent = "Couldn't create the image. Try copying the Markdown.";
          }
        } finally { imageButton.disabled = false; }
      });

      textButton.addEventListener("click", async () => {
        const content = figure.dataset.source;
        const runs = content.match(/\x60+/g) || [];
        const fence = String.fromCharCode(96).repeat(Math.max(3, ...runs.map((run) => run.length + 1)));
        const markdown = fence + "mermaid\n" + content + (content.endsWith("\n") ? "" : "\n") + fence;
        status.textContent = "Copying Markdown…";
        try {
          await navigator.clipboard.writeText(markdown);
          if (source) source.remove();
          source = undefined;
          status.textContent = "Markdown copied";
        } catch {
          if (!source) { source = document.createElement("pre"); figure.append(source); }
          source.textContent = markdown;
          const range = document.createRange();
          range.selectNodeContents(source);
          const selection = getSelection();
          if (selection) { selection.removeAllRanges(); selection.addRange(range); }
          status.textContent = "Couldn't copy. The Markdown is selected; press Ctrl+C or ⌘C.";
        }
      });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
  else start();
})()`
