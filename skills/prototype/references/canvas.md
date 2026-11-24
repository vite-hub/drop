# Canvas

Drop opens a page with two or more `<section data-variant>` items as a canvas: every item side by side at its real size, live, on a plane people pan and zoom. The reader opens one item full size (focus) and goes back without losing what they typed, since it's the same element. Drop runs the picker itself, the same current code on every prototype; [assets/picker.js](../assets/picker.js) is only for a page opened outside Drop.

What readers get, so you can tell them:

- Canvas: drag empty space, hold Space and drag (in Comments mode too), or middle-drag to pan. The Hand tool in Drop's bar (H; V back to Move) pans from anywhere, over items and live pages too, as in Figma; the wheel pans too, except over something that scrolls, and a scroll stays in that list to its end rather than carrying on into the canvas; Ctrl/⌘ + wheel or pinch to zoom; Fit and Reset in Drop's bar. Click a name to copy it, drag the handle beside it to move the item. Panning stops before the last item leaves the screen, and the minimap in the bottom-right corner jumps the camera anywhere: click a spot or drag the screen's box. The canvas remembers each reader's camera and positions by section `id`.
- Focus: double-click a name, press Enter on it, or press 1–9. ← and → step, Esc or Canvas go back to the canvas, centred on that item. The address's `#v-…` opens that item in focus.

## Live pages as items

A section with `data-src` shows that URL in a frame, live, as an item like any other. That is how one page compares deployed builds (a pull request's preview, production, an older commit) with HTML sketches:

```html
<section id="v-portal-main" data-variant="Portal · main" data-src="https://demo.preview.quiver.dk/orders" data-width="1440" data-height="900"></section>
<section id="v-portal-pr" data-variant="Portal · current PR" data-src="https://pr1473-demo.preview.quiver.dk/orders" data-width="1440" data-height="900"></section>
<section id="v-orders-sketch" data-variant="Orders · grouped sketch" data-width="1440">…</section>
```

- Leave the section empty; Drop fills it. Its height defaults to 900 on the canvas and the full screen in focus.
- The frame keeps the reader's login when the URL is on the same site as Drop. A Quiver preview such as `https://pr1473-demo.preview.quiver.dk` inside drop.quiver.dk, whose drops run on drop-usercontent.quiver.dk, is all `quiver.dk`, so its SameSite=Lax cookies flow. On another site the page loads signed out, or not at all if the browser blocks its cookies.
- A site that sends `X-Frame-Options` or a CSP `frame-ancestors` that excludes Drop shows an empty frame. Check one item renders before publishing the rest.
- Wheel and clicks over a live page go to that page. Pan from empty space, with Space + drag, or with the Hand tool.

## Flows: rows of screens with arrows

Inside an item, mark each screen with `data-screen` and an id, and give the button that leads somewhere `data-go` (the id of the screen it opens) and `data-label` (a word or two). Drop draws the arrow from that button's right edge to the screen, rings the button, and lights a screen's arrows when the pointer is over it. You only lay out the rows:

```html
<section id="v-checkout-flows" data-variant="Checkout · flows" data-width="1400">
  <div class="rows">
    <div>
      <h3>Pay with card</h3>
      <div class="row">
        <div data-screen id="v-checkout-flows-cart">… <button data-go="v-checkout-flows-card" data-label="Pay">Pay</button></div>
        <div data-screen id="v-checkout-flows-card">… <button data-go="v-checkout-flows-done" data-label="Confirm">Confirm</button></div>
        <div data-screen id="v-checkout-flows-done">…</div>
      </div>
    </div>
  </div>
</section>
<style>
  #v-checkout-flows { padding: 48px 56px 72px; }
  #v-checkout-flows .rows { display: flex; flex-direction: column; gap: 84px; }
  #v-checkout-flows .row { display: grid; grid-template-columns: repeat(4, 240px); column-gap: 140px; row-gap: 70px; align-items: start; margin-top: 56px; }
</style>
```

- The arrow's route follows where its screen lies: a curve to a screen on the right, down the gap beside the screen to one in the row's next line, over the top to one on the left (a "back" or "undo"). Leave about 140px between columns for the labels and 56px above each row for the arrows that go back.
- An arrow stays inside its item, so `data-go` names a screen in the same section. Build the screens with the same render function as the live item, so the two never drift; set `data-go` and `data-label` on the rendered button after rendering, and Drop redraws when they appear or change.
- Screens can be the real phone size scaled down (`transform: scale(.6)` inside a box of the scaled size); the arrows measure what is on screen.

## Hold open what reviewers comment on

Give a tooltip, popover, or menu its role (`role="tooltip"`, `"menu"`, `"dialog"`) and name it from its trigger with `aria-describedby` or `aria-controls`. Open it with script, on hover and on a click that keeps it open, not with CSS `:hover` alone. Drop then keeps it open while someone comments on it and pins the comment to its trigger once it closes; a CSS-only one closes as soon as the Comment tool covers the page.

## Animation

On the canvas every item is visible, so `variantchange` on `document` lists them all in `event.detail.visible`; in focus it lists one. An item that animates runs only while `event.detail.visible` includes its id.

## One at a time instead

`<body data-layout="single">` opens the page in focus, one item at a time, for full-page items that each need the whole screen. The Canvas button and the C key still show them side by side. A page with one item always opens in focus.
