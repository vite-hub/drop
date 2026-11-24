# Canvas

Drop opens a page with two or more `<section data-variant>` items as a canvas: every item side by side at its real size, live, on a plane people pan and zoom. The reader opens one item full size (focus) and goes back without losing what they typed, since it's the same element. Drop runs the picker itself, the same current code on every prototype; [assets/picker.js](../assets/picker.js) is only for a page opened outside Drop.

What readers get, so you can tell them:

- Canvas: drag empty space, hold Space and drag (in Comments mode too), or middle-drag to pan. The Hand tool in Drop's bar (H; V back to Move) pans from anywhere, over items and live pages too, as in Figma; the wheel pans too, except over something that scrolls, and a scroll stays in that list to its end rather than carrying on into the canvas; Ctrl/⌘ + wheel or pinch to zoom; Fit and Reset in Drop's bar. Click a name to copy it, drag the handle beside it to move the item. Panning stops before the last item leaves the screen, and the minimap in the bottom-right corner jumps the camera anywhere: click a spot or drag the screen's box. The canvas remembers each reader's camera and positions by section `id`.
- Focus: double-click a name, press Enter on it, or press 1–9. ← and → step, Esc or Canvas go back to the canvas, centred on that item. The address's `#v-…` opens that item in focus.

## Live pages as items

A section with `data-src` shows that URL in a frame, live, as an item like any other. That is how one page compares deployed builds (a pull request's preview, production, an older commit) with HTML sketches:

```html
<section id="v-orders-main" data-variant="Orders · main" data-src="https://demo.preview.example.com/orders" data-width="1440" data-height="900"></section>
<section id="v-orders-pr" data-variant="Orders · current PR" data-src="https://pr123-demo.preview.example.com/orders" data-width="1440" data-height="900"></section>
<section id="v-orders-sketch" data-variant="Orders · grouped sketch" data-width="1440">…</section>
```

- Leave the section empty; Drop fills it. Its height defaults to 900 on the canvas and the full screen in focus.
- Drop versions preserve the HTML and comments, not the live pages in the frames. To keep earlier rounds reviewable, give each round's `data-src` values deployment-specific URLs and keep those deployments accessible. A mutable branch URL always serves whatever is live there now, even when someone opens an older Drop version.
- The frame keeps the reader's login when the URL is on the same site as Drop. A preview such as `https://pr123-demo.preview.example.com` inside Drop on `drop.example.com`, whose drops run on `drop-usercontent.example.com`, is all `example.com`, so its SameSite=Lax cookies flow. On another site those Lax cookies are left out, so the page usually loads signed out.
- A site that sends `X-Frame-Options` or a CSP `frame-ancestors` that excludes Drop shows an empty frame. Check one item renders before publishing the rest.
- Wheel and clicks over a live page go to that page. Pan from empty space, with Space + drag, or with the Hand tool.

### Every page of a preview

To review a whole running app, publish one item per route. Take the routes from the app itself: if it serves a route list, use it; otherwise read its router or `pages/` directory. Give a route with a parameter a real value (`/orders/42`, not `/orders/:id`).

Run this snippet in Node.js:

```js
const base = "https://deploy-a1b2c3.preview.example.com/"
const pages = [
  ["v-home", "/"],
  ["v-orders", "/orders"],
  ["v-order-detail", "/orders/42"],
  ["v-settings", "/settings"],
]
const html = pages.map(([id, route]) =>
  `<section id="${id}" data-variant="${route}" data-src="${new URL(route, base)}" data-width="1440" data-height="900"></section>`,
).join("\n")
console.log(html)
```

- Give each route its own id, unique and the same every round, so comments stay pinned and items keep their place. Build `data-src` with `new URL(route, base)`; a new preview URL changes only `base`.
- For a phone size too, add a second item per route (`v-orders-mobile`, `data-width="390" data-height="844"`).
- Use a host every reviewer can reach over https, such as a deployed preview; a `localhost` URL loads only on your machine.

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

## Variants as routes in the real app

When the question depends on the app's real data, components, or login, build each variant as its own route in the app instead of as HTML, and list those routes as live items. Use HTML items when a sketch answers the question or the app doesn't run yet.

```
pages/proto/pricing/tiers.vue    → /proto/pricing/tiers
pages/proto/pricing/slider.vue   → /proto/pricing/slider
```

```html
<section id="v-pricing-tiers" data-variant="Pricing · tiers" data-src="https://deploy-a1b2c3.preview.example.com/proto/pricing/tiers" data-width="1280" data-height="900"></section>
<section id="v-pricing-slider" data-variant="Pricing · slider" data-src="https://deploy-a1b2c3.preview.example.com/proto/pricing/slider" data-width="1280" data-height="900"></section>
```

- Keep the fixed parts in one shared component or layout, so only the part in question differs between routes.
- For the next round, deploy the branch, keep the section IDs, update `data-src` to the new deployment's URLs, and `publish` with `previous`.
- Once a variant is chosen, port the winner into the real page and remove the `proto/` routes from the app branch. Keep the old deployments serving those routes for as long as reviewers need the corresponding rounds.

## Hold open what reviewers comment on

Give a tooltip, popover, or menu its role (`role="tooltip"`, `"menu"`, `"dialog"`) and name it from its trigger with `aria-describedby` or `aria-controls`. Open it with script, on hover and on a click that keeps it open, not with CSS `:hover` alone. Drop then keeps it open while someone comments on it and pins the comment to its trigger once it closes; a CSS-only one closes as soon as the Comment tool covers the page.

## Animation

On the canvas every item is visible, so `variantchange` on `document` lists them all in `event.detail.visible`; in focus it lists one. An item that animates runs only while `event.detail.visible` includes its id.

## One at a time instead

`<body data-layout="single">` opens the page in focus, one item at a time, for full-page items that each need the whole screen. The Canvas button and the C key still show them side by side. A page with one item always opens in focus.
