---
title: Make Portal select options readable
prompt: >-
  we fixed the long select values but I still see clipped names in portal, maybe we only fixed one component? find all the actual places this happens. I want one proper fix not css in five screens. also don't redesign the selects, just make them readable and mobile ok. create the plan
---

Fix option sizing once in the Nuxt UI theme. Keep the existing triggers and select design. A menu should grow to its longest useful label, stop at `24rem` or the available viewport width, then wrap text instead of hiding it.

::callout{type="decision"}
`app/app.config.ts` owns the default behavior for both `USelect` and `USelectMenu`. Feature screens should override it only when their menu has a genuinely different layout.
::

## Why the current fix still clips

PR #996 changes the two content slots to `w-max`, but Nuxt UI 4.11 still gives each option a flexible `min-w-0` wrapper and a truncated label. Those inner slots do not contribute the label's full width, which matches the reported case where `MX-MC-W-DH` clips below the new `24rem` cap.

Portal has 26 `USelect` or `USelectMenu` uses. Most inherit the shared theme. Seven menus set their own content width in `Generic/Selector.vue`, `Insights/Sales/PeriodSelector.vue`, `EnrichHistory/SaveAdjustment.vue`, `PlanningEvent/Form.vue`, `ui/CurrencySelector.vue`, `ui/AppHeader.vue`, or `ui/SkuPicker.vue`; those rules can replace part of the global fix.

## Change

| Case | Treatment |
| --- | --- |
| Standard `USelect` and `USelectMenu` options | Let the label set the menu's intrinsic width up to the shared cap; wrap only after the cap. |
| Planning group and other simple local overrides | Remove width classes that defeat the shared rule. Keep alignment, height, and icons local. |
| Rich menus with descriptions or SKU metadata | Keep their deliberate fixed layout, but make long primary labels wrap within the mobile-safe width. |
| Trigger value | Leave its current width and truncation unchanged so page layouts do not move. |

Implement the shared content, item-wrapper, and item-label behavior in `app/app.config.ts`. Then reduce the seven local overrides to the layout differences they actually need. Do not add a wrapper component or screen-specific CSS.

## Proof

- Reproduce the PR review case with `MX-MC-W-DH` in the product-group menu and confirm the full label is visible.
- Exercise one plain `USelect`, one searchable `USelectMenu`, the header planning-group menu, and the SKU picker.
- Check a long unbroken value and a long name at desktop width and at a `320px` viewport. Menus must stay on-screen, labels must remain readable, and trigger dimensions must not change.
- Search the 26 call sites once more. Any remaining content-width override must correspond to a documented rich-menu layout, not a workaround for clipping.

The implementation is done when the reported product-group value and longer labels are readable across these cases without per-screen fixes.
