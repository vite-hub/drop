# Replacing ImageMagick `convert` in the sandbox

## Recommendation

Keep the current ImageMagick system package for now. `@imagemagick/magick-wasm` is the most faithful package-based replacement, but ViteHub's current sandbox compiler cannot carry its separate WASM binary into the in-memory module graph. `sharp` is the best API for this narrow job, but its native addon must exist in the Linux container and its own documentation says to externalize it from esbuild, so moving it to `dependencies` does not make it available to the sandbox.

If package-only sandbox definitions are the desired platform capability, add binary-asset support to ViteHub's sandbox bundle first, then spike `@imagemagick/magick-wasm`. Without that upstream support, deleting the Dockerfile would trade a small, proven container dependency for application-specific asset plumbing.

## The exact Drop contract

[`server/sandboxes/image-optimizer.ts`](../server/sandboxes/image-optimizer.ts) invokes `convert` with `-auto-orient -strip -resize 2048x2048>` and writes the same format it read. Drop accepts JPEG, PNG, and WebP up to 4 MiB, returns base64 across the sandbox boundary, and keeps the candidate only when it is smaller. The replacement must therefore preserve orientation, remove metadata, bound both dimensions without upscaling, encode all three formats, and finish inside the 60-second sandbox timeout.

## Why `package.json` alone does not currently work

ViteHub compiles each sandbox definition with esbuild using `bundle: true`, `platform: "node"`, and only Node built-ins as externals. It then serializes esbuild's JavaScript output files as an in-memory module graph that the runtime writes under `/tmp` in the Cloudflare container ([compiler source at the pinned ViteHub revision](https://github.com/vite-hub/vitehub/blob/003f0246b1e451940af0d8466034aac41bee8e6d/packages/sandbox/src/internal/shared/discovered-definition/bundler.ts), [sandbox bundle source](https://github.com/vite-hub/vitehub/blob/003f0246b1e451940af0d8466034aac41bee8e6d/packages/sandbox/src/bundle.ts)). The container is built separately from the Dockerfile; Cloudflare documents Dockerfile installation as the mechanism for adding system or global npm packages to the image ([Cloudflare Dockerfile reference](https://developers.cloudflare.com/sandbox/configuration/dockerfile/)).

That boundary matters:

- A root dependency is available while esbuild runs on the deployment machine, but root `node_modules` is not copied into the sandbox container.
- The sandbox graph currently treats outputs as text modules and does not configure an esbuild loader or runtime path for `.wasm` or `.node` files.
- `@imagemagick/magick-wasm` exports `magick.wasm` as a separate package file and requires its URL, bytes, or compiled module during `initializeImageMagick`; the package metadata does not inline it ([package metadata](https://github.com/dlemstra/magick-wasm/blob/0.0.41/package.json), [official demo](https://github.com/dlemstra/magick-wasm/blob/0.0.41/demo/demo.ts)).
- Sharp's installation guide tells esbuild users to leave `sharp` external and separately ensure the target platform binaries are installed. That is incompatible with this self-contained text graph unless sharp and its Linux binaries are installed or copied into the container image ([sharp installation and bundler guidance](https://sharp.pixelplumbing.com/install/)).

## Options

| Option | Contract fit | Package/runtime cost | Assessment |
| --- | --- | --- | --- |
| `@imagemagick/magick-wasm` 0.0.41 | Direct object methods exist for `autoOrient()`, `strip()`, resize geometry with `greater = true`, and same-format write. Its current build reads and writes JPEG, PNG, and WebP. | Current npm metadata reports 15,435,239 unpacked bytes; the package's `magick.wasm` is about 14.6 MB. It requires explicit initialization and binary-asset delivery. Version 0.0.41 was released June 20, 2026, so maintenance is current ([release](https://github.com/dlemstra/magick-wasm/releases/tag/0.0.41), [npm metadata](https://registry.npmjs.org/@imagemagick%2fmagick-wasm/latest), [ImageMagick's WebAssembly bindings list](https://imagemagick.org/develop/)). | Best package-only candidate after ViteHub supports binary modules. It is faithful but large, and would add initialization and asset-transfer work to every fresh sandbox execution. |
| `sharp` / native libvips | Exact concise mapping: `autoOrient()`, `resize({ width: 2048, height: 2048, fit: "inside", withoutEnlargement: true })`, then `toBuffer()`. Output matches the input format and metadata is removed by default ([orientation](https://sharp.pixelplumbing.com/api-operation/#autoorient), [resize](https://sharp.pixelplumbing.com/api-resize/#resize), [output](https://sharp.pixelplumbing.com/api-output/#tobuffer)). | Prebuilt Linux binaries exist and JPEG/PNG/WebP are supported, but they are native optional dependencies selected for the install platform. The sandbox image still needs those runtime files. Sharp's optional WASM build requires multi-threaded WASM via Workers and does not support single-threaded runtimes ([installation](https://sharp.pixelplumbing.com/install/#prebuilt-binaries), [WASM constraints](https://sharp.pixelplumbing.com/install/#webassembly)). | Best implementation if installing/copying a runtime dependency in the Dockerfile is acceptable. It does not satisfy “package.json instead of Dockerfile” under the current sandbox compiler. |
| `@jsquash/jpeg`, `@jsquash/png`, `@jsquash/webp`, `@jsquash/resize` | The codecs and resizer cover the three formats and pixel resizing, but EXIF orientation needs separate parsing/transform logic; this becomes a multi-package pipeline rather than one equivalent operation. | The project says Node usage requires extra steps to include WASM binaries, Node support is limited, and its WASM modules are not optimized for Node. It also documents Vite/Nuxt asset-resolution failure modes ([jSquash packages and Node limitations](https://github.com/jamsinclair/jSquash#usage-in-nodejs), [known bundling issues](https://github.com/jamsinclair/jSquash#known-issues)). | Smaller focused codecs, but the most application code and the same missing-WASM-asset problem. Not worth it here. |

## Practical next step

The smallest safe choice is to retain `convert`. If removing the app-specific Dockerfile is important, first teach the ViteHub sandbox artifact format to include binary modules alongside JavaScript, with a focused fixture proving that a package-exported `.wasm` file reaches the container. Then compare `@imagemagick/magick-wasm` against the deployed-flow orientation, metadata, resize, output-type, and smaller-only checks before switching.
