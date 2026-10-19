// Drop prototype picker. Paste into a <script> at the end of the prototype's <body>, unchanged.
// Every top-level <section id="v-…" data-variant="Label" data-note="One line"> is one variant; the picker shows one
// at a time and switches with its bar, the ← and → keys, or 1–9. It remembers the last one per page, opens the one
// in the URL hash (#v-…), and fires a `variantchange` event on document ({ detail: { id, label } }) so a variant
// can start or pause its own animation.
(() => {
  const variants = [...document.querySelectorAll("body > [data-variant]")];
  if (!variants.length) return;
  const key = "drop-prototype:" + location.pathname;
  const remembered = () => { try { return localStorage.getItem(key); } catch { return null; } };
  const find = (id) => variants.findIndex((el) => el.id === id);
  // A variant's own `display` (an id rule with grid, say) beats the hidden attribute's default style.
  const hide = document.createElement("style");
  hide.textContent = "body > [data-variant][hidden] { display: none !important; }";
  document.head.append(hide);

  const host = document.createElement("prototype-picker");
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `<style>
    :host { all: initial; }
    .bar { position: fixed; z-index: 2147483000; bottom: 16px; left: calc((100vw - var(--drop-inset, 0px)) / 2); transform: translateX(-50%);
      display: flex; align-items: center; gap: 4px; max-width: calc(100vw - var(--drop-inset, 0px) - 32px); padding: 4px;
      border: 1px solid rgb(255 255 255 / .12); border-radius: 12px; background: rgb(17 17 17 / .92); color: #fafafa;
      font: 500 12px/1 ui-sans-serif, system-ui, sans-serif; box-shadow: 0 8px 24px rgb(0 0 0 / .25); backdrop-filter: blur(8px); }
    button { all: unset; box-sizing: border-box; height: 28px; padding: 0 10px; border-radius: 8px; color: #a3a3a3; cursor: pointer; white-space: nowrap; }
    button:hover { color: #fafafa; background: rgb(255 255 255 / .08); }
    button[aria-pressed="true"] { color: #0a0a0a; background: #fafafa; }
    button:focus-visible { outline: 2px solid #fafafa; outline-offset: 1px; }
    .list { display: flex; gap: 2px; overflow-x: auto; scrollbar-width: none; }
    .note { padding: 0 8px; color: #a3a3a3; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 32ch; }
    .n { font-variant-numeric: tabular-nums; opacity: .6; margin-right: 6px; }
    .bar.min .list, .bar.min .note { display: none; }
  </style>
  <nav class="bar" aria-label="Prototype variants">
    <button class="prev" aria-label="Previous variant">←</button>
    <div class="list" role="group"></div>
    <button class="next" aria-label="Next variant">→</button>
    <span class="note"></span>
    <button class="fold" aria-label="Fold the picker">–</button>
  </nav>`;
  const bar = shadow.querySelector(".bar"), list = shadow.querySelector(".list"), note = shadow.querySelector(".note"), fold = shadow.querySelector(".fold");
  const buttons = variants.map((el, i) => {
    const button = document.createElement("button");
    button.innerHTML = `<span class="n" aria-hidden="true">${i + 1}</span>`;
    button.append(el.dataset.variant || el.id);
    button.onclick = () => show(i);
    list.append(button);
    return button;
  });

  let current = -1;
  function show(i) {
    i = (i + variants.length) % variants.length;
    if (i === current) return;
    current = i;
    variants.forEach((el, j) => { el.hidden = j !== i; });
    buttons.forEach((button, j) => button.setAttribute("aria-pressed", String(j === i)));
    buttons[i].scrollIntoView({ block: "nearest", inline: "nearest" });
    const el = variants[i];
    note.textContent = el.dataset.note || "";
    note.hidden = !el.dataset.note;
    label();
    try { localStorage.setItem(key, el.id); } catch {}
    try { history.replaceState(history.state, "", "#" + el.id); } catch {}
    // Comment pins measure their anchors on resize, so they follow the variant that just appeared.
    window.dispatchEvent(new Event("resize"));
    document.dispatchEvent(new CustomEvent("variantchange", { detail: { id: el.id, label: el.dataset.variant || el.id } }));
  }

  shadow.querySelector(".prev").onclick = () => show(current - 1);
  shadow.querySelector(".next").onclick = () => show(current + 1);
  function label() {
    const min = bar.classList.contains("min");
    fold.textContent = min ? current + 1 + "/" + variants.length : "–";
    fold.setAttribute("aria-label", min ? "Show the picker" : "Fold the picker");
  }
  fold.onclick = () => { bar.classList.toggle("min"); label(); };
  window.addEventListener("hashchange", () => { const i = find(location.hash.slice(1)); if (i >= 0) show(i); });
  window.addEventListener("keydown", (e) => {
    const t = e.target;
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey || (t && (t.isContentEditable || /^(input|textarea|select)$/i.test(t.tagName)))) return;
    if (e.key === "ArrowLeft") show(current - 1);
    else if (e.key === "ArrowRight") show(current + 1);
    else if (/^[1-9]$/.test(e.key) && Number(e.key) <= variants.length) show(Number(e.key) - 1);
    else return;
    e.preventDefault();
  });

  document.body.append(host);
  const start = [location.hash.slice(1), remembered()].map(find).find((i) => i >= 0);
  show(start ?? 0);
})();
