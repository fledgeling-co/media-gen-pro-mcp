# Changelog

Every release that changed what the server does, what it costs, or which models it can reach.

Where a fact was learned by calling an API rather than reading its documentation, it says so. That distinction earned its place fast here: three of the four defects below were things the vendors' own docs described incorrectly or not at all.

This project follows [semantic versioning](https://semver.org/). Until 1.0 the minor number carries breaking changes.

## [0.1.4] - 2026-07-30

### Fixed

- Recraft rejected most image sizes with a bare 400 and an empty error message, so any call passing `size` failed for no visible reason. `1024x1024`, `1024x1707` and `1707x1024` all fail; `2048x2048` and `auto` work. Anything not shown to be accepted is now sent as `auto` rather than passed straight through. Found by generating 30 images for the README comparison, where it failed five out of five.

### Added

- A six-model comparison in the README: five prompt categories, one prompt each, the same text sent to all six models, one generation each. Each prompt states a rule you can check by counting or looking, so the results are gradeable rather than a matter of taste. Nothing cherry-picked, nothing retried.

## [0.1.3] - 2026-07-30

### Changed

- The Grok Imagine entry in the model catalogue now records what the model is actually like: roughly 6 seconds against 8 to 17 for the others, measured 30 July 2026, and looser content filtering than the rest. Both are properties worth knowing when you pick a model. Neither is a selection rule, and nothing routes to Grok because another model declined; you get it by asking for it, like every other vendor in the table.

### Notes

- **Recraft V4.1 Utility Pro was considered and left out.** Its point is dropping a product image you supply into a controlled scene, and that path is not reachable: `/v1/images/edits` returns 404 on the gateway, the SDK's image route errors for every Recraft model, and `/v1/images/generations` silently ignores an `image` field (junk base64 still returns 200 and an image). Adding it would mean a seventh raster model whose only reason to exist is a capability the server cannot use, described by a tool description that would have to lie.

## [0.1.2] - 2026-07-30

### Fixed

- The version the server announces is now derived from `package.json` rather than hardcoded in `src/version.ts`. The two had drifted, so 0.1.1 shipped calling itself 0.1.0. Nothing failed, which is exactly why it survived a publish: a wrong version number is not a crash. The sync runs from npm's `version` hook so it lands in the release commit, and again on `prepublishOnly`.

## [0.1.1] - 2026-07-30

### Added

- **Recraft V4.1 Pro**, for photorealism. Say `recraft`, `photo` or `photoreal`.
- **Grok Imagine**, the fast, cheap one. Say `grok` or `imagine`.
- **Arrow 1.1**, which writes real SVG: vector source built from shapes and geometry that you can open, edit and scale. Set `svg: true`. No raster model can do this; ask one for an SVG and you get a picture of one, which is a different thing and useless if you wanted to change the colour of a path. After an SVG, the tool suggests offering a raster version rather than generating one, because that is a second billed call nobody asked for.

### Changed

- Gemini moves from `gemini-3-pro-image` to `gemini-3.1-flash-image`, and Seedream from 4.5 to 5.0 Pro.

### Fixed

- **Gemini's image models are reached through the text API, not the image one.** They are multimodal language models that emit images, so the gateway types them `language` and the image API refuses them outright: "Model 'google/gemini-3-pro-image' is a language model, not an image model." They now go through `generateText`, with the images pulled off the response, which works on both routes. An earlier attempt concluded Gemini was direct-only and that was wrong.
- **Recraft goes through a different endpoint.** The gateway's own `/v4/ai/image-model` route answers 200 with an error body for every Recraft model, so the SDK adapter cannot reach any of them. Its OpenAI-compatible `/v1/images/generations` serves the same models correctly. Checked on v4-pro, v4.1-pro and v4.1-utility-pro; all three fail one way and work the other.
- **File extensions come from the bytes, not the label.** No provider agrees what it is returning. Arrow returns SVG source labelled `image/png`, Recraft returns WebP through an endpoint that declares no format at all, and Gemini returns JPEG. Files were being written as `.png` regardless, so the extension lied about the contents; browsers sniff and render it anyway, which is why it would have survived until something that does not sniff rejected it far from here.
- **Several images from Gemini is now several calls.** It refuses `n > 1` outright ("Gemini image models do not support generating a set number of images per call"), so the request fans out in parallel instead of failing. Worth knowing that three Gemini images take about as long as one and cost three times as much.

## [0.1.0] - 2026-07-30

Initial release.

### Added

- Image generation as an MCP tool, with three models behind one call: **GPT Image 2** by default, **Gemini 3 Pro Image** on `gemini` or `nanobanana`, and **Seedream 4.5** through the Vercel AI Gateway. "nanobanana" is accepted because that is what people call Gemini's image model out loud.
- **Reference images and text context.** Reference images are paths on the machine running the server, used to match a style, keep a product or character consistent, or edit something you already have. Context is extra text kept separate from the prompt so the subject stays legible.
- **`n` for several images** in one call.
- **Files on disk, paths in the response.** A 1024x1024 image is roughly 1.4 MB once base64'd, so returning the bytes spends a chunk of the conversation on something the model cannot look at, and the caller wanted a file anyway because an `<img src>` takes a path.
- **An hourly cap of 60 images and a per-call cap of 4.** Image models are billed per image and cost meaningfully more than a text call; an agent in a retry loop is the shape that runs up a bill nobody agreed to. Both are yours to raise.
