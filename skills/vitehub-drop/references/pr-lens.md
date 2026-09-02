# Publish PR Lens diagrams

Use this branch when the user asks to publish a PR Lens diagram through Drop. PR Lens reads the code change and renders the SVGs. Drop publishes the selected output files.

## Find the rendered files

Follow the installed PR Lens skill through its render step. If that skill is unavailable, work from SVGs the user already has or explain that PR Lens must create them first.

For a local PR Lens render, read `.pr-lens/manifest.json` for the exact SVG filenames. Select the views under the PR Lens skill's rules rather than guessing names from the directory. If the user supplied standalone SVGs, use those paths.

## Check publication scope

Drop URLs are public, permanent, and non-editable. Confirm the source repository is public before uploading. For private or local-only code, state that exposure and continue only after the user explicitly accepts it.

When the goal is only to place a diagram on a GitHub pull request, follow PR Lens's native attachment instructions. Use Drop when the user asks for a permanent public URL or local attachment is unavailable.

## Publish the SVGs

Apply the [file publishing instructions](../SKILL.md#publish-a-file) once to each selected SVG. For each upload, label the PR Lens view and theme, then return the command's stdout verbatim. Keep generated files in `.pr-lens/`; PR Lens treats that directory as rebuildable output.

Each Drop upload receives an unrelated random path. Return the individual URLs. Do not pass one as PR Lens's `--asset-base-url`, which expects a base URL containing the manifest filenames.
