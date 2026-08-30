---
title: Verify product catalogue caching
prompt: >-
  the product catalogue keeps loading the same things and its slow. check portal, I think nitro cache can fix most of it but customer prices change so we cannot just cache everything forever. maybe there is already a cache somewhere? figure the smallest thing, I don't want a new system. plan only
---

# Verify product catalogue caching

Do not add another cache. Portal already shares the catalogue through `server/api/product-catalogue.get.ts`; first identify why the existing browser or Nitro cache is missing, then fix only that boundary.

::callout{type="decision"}
Keep catalogue invalidation tied to the latest completed data sync. Prices are not part of this payload—it contains product ID, SKU, name, image, and lifecycle—so price changes do not require a separate rule.
::

## Existing path

| Layer | Current behavior | Expected proof |
| --- | --- | --- |
| Page | `useProductData()` shares one keyed `useFetch` state | Multiple consumers trigger one in-app request |
| Browser | `/api/product-catalogue` returns an app/data-version `ETag` | A reload or new tab revalidates with `304` |
| Nitro | `defineCachedFunction` caches by app version and latest data-sync version for up to 12 hours | Repeated requests do not rerun Cube pagination |

## Plan

1. Reproduce on a large customer and record the request count, response status, transferred bytes, and Cube calls for first load, page navigation, reload, and a second tab.
2. Trace the first miss:
   - repeated requests inside one app session → fix ownership of the shared `useFetch` key;
   - repeated `200` responses across reloads → verify `ETag` / `If-None-Match` and whether the data version is falling back to `no-sync`;
   - repeated Cube queries with the same cache version → fix the existing Nitro cache key or storage configuration.
3. Confirm one completed customer-data sync changes the version and returns a fresh catalogue, while requests before that sync reuse the prior result.

## Done when

- One app session downloads the catalogue once.
- An unchanged reload or second tab returns `304` with negligible transfer.
- Nitro performs one catalogue build per app/data version, including under concurrent requests.
- No new cache service, price-specific invalidation, or duplicate client storage is introduced.
