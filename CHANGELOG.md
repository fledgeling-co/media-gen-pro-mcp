# Changelog

Every release that changed what the server does, what it costs, or which models it can reach.

Where a fact was learned by calling an API rather than reading its documentation, it says so. That distinction earned its place fast here: three of the four defects below were things the vendors' own docs described incorrectly or not at all.

This project follows [semantic versioning](https://semver.org/). Until 1.0 the minor number carries breaking changes.

## [Unreleased]

### Changed

- **`flare` and `sunburst` now mean GPT Image 2.6.** They route to `openai/gpt-image-2.6-flare` and `openai/gpt-image-2.6-sunburst`, which the gateway's `/v1/models` listed on 7 November 2026. `gpt-image-2.6` aliases to Flare. Flare stays the default.

### Removed

- The `gpt-image-2.5-flare` and `gpt-image-2.5-sunburst` names no longer resolve, so asking for 2.5 answers "unknown style" rather than billing 2.6 under the old name. The README bench and the advice text still describe 2.5, because that is the model they measured; 2.6 has not been benched here.

## [0.7.0] - 2026-09-22

### Added

- **Arrow 2 and Arrow 2 Telos.** `svg` now means `quiverai/arrow-2`, and the new `telos` style (`quiverai/arrow-2-telos`) reaches Quiver's refined tier. Quiver's own guidance decides between them: plain Arrow 2 when speed and cost per asset matter, Telos for harder briefs. `svg-pro` and `arrow-2-telos` alias to Telos; `arrow`, `arrow-2` and `svg` alias to Arrow 2.
- The classifier can answer `svg-telos`, and `sunburst` — which 0.5.0 added to the registry but never to the enum, so the router could not select it for the six weeks since.

### Removed

- **Arrow 1.1 is gone.** `quiverai/arrow-1.1` and the bare `arrow-1.1` name no longer resolve, so `style: "arrow-1.1"` answers "unknown style" rather than billing a model the registry no longer documents. Its six comparison SVGs stay in `docs/examples/` and the bench keeps the column marked superseded, as evidence.

### Changed

- **`svg: true` now respects `style` and `IMAGE_GEN_ALLOWED_STYLES`.** It previously jumped straight to the one vector vendor, ignoring both. `style: "telos"` with `svg: true` is a coherent request — an SVG, the refined one — so only a *raster* style is overridden now. A deployment that allows one Arrow and not the other gets the one it allows, and the substitution is reported.
- **Vector substitutes only for vector.** A restricted deployment degrades Arrow 2 to Telos or back, never to a picture model: a raster model cannot satisfy an SVG request at all, so degrading across the line answers a different question than the one asked.
- The classifier's guidance now marks measured claims apart from vendor positioning. A line saying a model "held" or "missed" something comes from the published run; a line saying what a model is built for is the vendor's own account. Sunburst's edit precision, Muse's tool use and Grok's typography are all positioning, and are labelled as such rather than inheriting the authority of a measurement.
- Advice for diagrams names both vector models, and the data-and-exact-text advice softens from "nothing here is the right tool" to "nothing here is *reliably* the right tool", because Meta claims Muse writes and runs code for accurate plots and QR codes. That claim is untested here and says so.
- A new warning fires on `muse`: Meta embeds Content Seal, an invisible watermark it says survives cropping, compression, resizing and screenshotting. Nothing is visible on the picture, but the provenance signal travels with it.

### Measured, not read

- **Arrow 2 is a language model where Arrow 1.1 was an image model.** The gateway's own `/v1/models` types it `language`, and its images endpoint refuses it outright: `Model 'quiverai/arrow-2' is a language model, not an image model. Use the language generation API instead.` Routed as an image model — which is what continuity from 1.1 would have given it — every SVG request would have failed with a 400 before reaching Quiver. The server takes the text route and recovers SVG source from the answer, which is the right shape for a model that returns markup as text, and which a live call has now confirmed.
- **Pricing moved from per-image to per-token with it.** Arrow 1.1 charged a flat $0.20 a generation. Arrow 2 is $4.00 per million input tokens and $20.00 per million output; Telos is $6.00 and $30.00. An Arrow 2 SVG now costs what its source is long.
- **Arrow 2 answers, and the 503 was the wrong doorway.** The server calls the gateway through the AI SDK, which posts to `ai-gateway.vercel.sh/v4/ai/language-model`. On that route `quiverai/arrow-2` returns SVG source as text: one call came back in 32s with 262 characters containing `<svg`. The OpenAI-compatible endpoint, `/v1/chat/completions`, returns 503 for the same model at the same moment — one real provider attempt, `credentialType: system`, a populated `providerRequestId` — while `quiverai/arrow-1.1` and every other model on that endpoint answer normally. So the 503 is a defect in the compatibility shim's routing of this one model, not a Quiver outage and not a fault in the model. The server never calls that endpoint, so nothing here needed changing; a diagnosis run with `curl` against it was reading a transport the server does not use.
- **Arrow 2 is slow, and agentic.** 32 seconds for a one-shape prompt, against a default `IMAGE_GEN_TIMEOUT_MS` of 180,000. Quiver describes the model as doing agentic refinement with tool calling, and the latency matches that rather than a single pass.
- **The comparison run was blocked on the gateway balance, not on Quiver, and then ran.** For a stretch on 21 September every model on the account returned 402 `insufficient_funds` — "A positive credit balance is required for all requests, including BYOK" — Gemini included, so it was account-wide and unrelated to Arrow. It is also how we know the compatibility endpoint never disguised a credit error as the 503 above: it reports one as a clean 402.
- **Twelve cells, eleven on the first attempt, about $2.60.** Six prompts against each Arrow model on 22 September 2026. Arrow 2 took 51–120 seconds a cell, Telos 47–238. `portrait-telos` returned a `GatewayTimeoutError` on its first attempt; the same prompt, sent again unchanged, returned 34,562 bytes 469 seconds later — the longest call in the run. All twelve files parse as well-formed XML and render with no broken images. Arrow 2 emits an 80×80 `viewBox`, Telos around 1024 wide.
- **Both Arrow models pass the count and the absence prompt, and both miss the ring count.** Seven bolts each, two rows of three with the upright one at the front centre and nothing touching — the layout Arrow 1.1 flattened into a ring. Both corridors are compliant, with no strip of light under any door. On the portrait both got the facing, the stacked hands and the shadow, then drew six rings (Arrow 2) and seven (Telos) where the brief says five. In a vector file that is countable rather than arguable: `stroke="#BEB5B3"` appears exactly six times in Arrow 2's, in two groups of three across the fingers.
- **Telos's refinement costs it the flat-colour brief.** On the flowchart Arrow 2 produced the cleanest geometry in the run — three boxes sharing one `y` and one `height`, gaps of 34.46 and 34.18 units, both connectors exactly horizontal, flat fills, stroke weights 4% apart. Telos matched that geometry, at gaps of 105.5 and 106, then filled its boxes from a `linearGradient` and added inner-edge highlight strokes on a prompt that asks for flat colour and no shading, with box and connector strokes a third apart. The trade reverses on the reflection prompt, where Telos drew both the reflected base and a shadow falling away from the window and Arrow 2 drew no cast shadow at all.
- The README comparison and the bench now carry the run: eleven models across six prompts, Arrow 1.1's column dropped from the tables and kept in the bench marked superseded.

## [0.6.0] - 2026-09-09

### Removed

- **GPT Image 2 is gone**, superseded by its 2.5 siblings. The `openai` vendor, its `gpt-image`, `gpt-image-2` and `dalle` aliases, the `openai/gpt-image-2` gateway id, the direct OpenAI route, and `OPENAI_API_KEY` are all removed: setting that key now does nothing, and asking for `style: "openai"` answers "unknown style" instead of silently billing another model. The comparison files stay in `docs/examples/`, and the bench keeps the old column marked superseded, as evidence.
- **`@ai-sdk/openai` leaves with it.** Nothing else imported the package.

### Changed

- **The default is now GPT Image 2.5 Flare.** Unstyled requests and the classifier fallback land on `flare`; `IMAGE_GEN_DEFAULT_PROVIDER` accepts `flare` where it accepted `openai`. The classifier's rule model answers `flare` for prompts with counts, exclusions and precise arrangements, and the advice notes name the 2.5 models instead.
- The README comparison drops the GPT Image 2 column from all six tables.

## [0.5.0] - 2026-09-09

### Added

- **Two new image models.** `flare` (`openai/gpt-image-2.5-flare`) and `sunburst` (`openai/gpt-image-2.5-sunburst`). Both are gateway-only: OpenAI's own `/v1/models` lists gpt-image-1 through gpt-image-2 and neither 2.5 variant, checked 9 September 2026. Both answered `n: 2` in a single call, so they batch.
- The README comparison covers both on the same six prompts, and the bench gallery carries all twelve new cells.

### Measured, not read

One generation per model per prompt on 2026-09-09, single samples rather than a benchmark. Both were clean passes on the counting prompt (seven bolts, correct layout, nothing touching), fully compliant on the absence prompt, bound all five attribute pairs, and stacked the portrait's hands with five rings each and the shadow on the correct side — the fullest passes on that prompt in the table. The diagram and reflection rows are published unjudged.

## [0.4.0] - 2026-09-04

### Added

- **Four new image models.** `gemini-lite` (`google/gemini-3.1-flash-lite-image`), `muse` (`meta/muse-image-1.0`), and three Recraft V4.1 siblings alongside the Pro one: `recraft-utility`, `recraft-utility-pro` and `recraft-v4.1`. `muse` at $0.01 an image and `gemini-lite` at roughly half Flash's price are now the two cheapest routes here.
- **Six new video models.** `seedance-mini`, `minimax-max` (H3 Max), `wan` and `wan-prime` (Alibaba Wan 3.0), `flux` (FLUX.3 Video) and `veo` (Veo 3.1 Lite).
- Veo's duration constraint is carried on the model choice and the requested length is snapped to the nearest value it accepts. Learned by calling it: anything outside `[4, 6, 8]` comes back as `Unsupported output video duration 5 seconds, supported durations are [8,4,6] for feature text_to_video`, so a caller's ordinary `5` failed outright rather than being rounded.

### Changed

- **`grok` now reaches Grok Imagine 2.0.** The id moved namespace as well as version: `xai/grok-imagine-image` is gone from the gateway and `spacexai/grok-imagine-image-2.0` replaces it. The same move applies to video, where `xai/grok-imagine-video-1.5` is now `spacexai/grok-imagine-video-1.5`.
- **`seedance` now reaches Seedance 2.0** rather than `seedance-2.0-fast`.
- The README comparison has been re-run for the added and changed models on the same six prompts, and the video table re-timed across seven models.
- The classifier's model list and the advice rules were updated to match what the new run showed, rather than left describing models that are no longer reachable.

### Fixed

- **Recraft goes through the normal image route again.** Every Recraft model used to answer 200-with-an-error-body on the gateway's own image-model route, so this server used the OpenAI-compatible endpoint instead. Re-checked by calling all four V4.1 variants on 2026-09-04: the standard route serves them correctly, so the workaround is retired. Note that the old path clamped unsupported sizes to `auto` and the standard path does not; which sizes Recraft accepts has not been re-tested.

### Measured, not read

One generation per model per prompt on 2026-09-04, single samples rather than a benchmark. Of the newly added models, Muse Image 1.0 was the only one in the whole run to stack the hands as the portrait prompt asked, and one of three clean passes on the counting prompt. Grok Imagine 2.0 passed the count, the exclusion prompt and the attribute-binding prompt, all three of which Grok Imagine 1.0 failed. On video, MiniMax H3 Max returned in 14s on all three prompts and Veo 3.1 Lite was the only newly added model to complete all three including the photographic portrait that Seedance refuses.

Timings move between runs by more than the gap between some models: the Grok video clips were generated twice on the same afternoon and text-to-video took 28s then 44s. The published table carries the second run's numbers, because those are the clips in the repo.

## [0.3.2] - 2026-08-24

### Changed

- A substitution is now named on the FIRST line of the response rather than in a note below it. Consumers log this text and truncate — the deployment that prompted the feature stores 200 characters, which holds the first sentence and nothing after a blank line. An unrecorded substitution turns a loud failure into a silent change of vendor, which is the worse of the two, so the fact that explains the image must not be the first thing cut.

## [0.3.1] - 2026-08-24

### Added

- `IMAGE_GEN_ALLOWED_STYLES` — the style aliases a deployment can actually reach, comma-separated. The classifier chooses within that set, and a request it routes to an unreachable vendor is substituted rather than refused. Written as aliases (`gemini-pro,gemini`) rather than internal vendor keys, because aliases are the vocabulary callers already use in `style`.
- Substitution is by TIER, not by taking the first allowed name: a photograph request moves to the best reachable model and a cheap illustration request stays cheap, so the caller's intent survives. Every substitution is reported in the tool's response, because a caller who named a style and received another one should be able to see that the deployment made that choice.

### Why

Measured on 2026-08-24, not read in a doc. A caller on a Zero-Data-Retention gateway asked for a documentary photograph. The classifier correctly chose the photorealism vendor; the gateway refused it with `no_zdr_providers_available`, having no ZDR-attested credential for that provider. The caller retried four times, got the identical refusal each time, and a finished ten-slide deck was discarded for want of two pictures.

`IMAGE_GEN_DEFAULT_PROVIDER` could not prevent it and was already set correctly. It is consulted only when the classifier cannot run — the classifier is a model call whose answer is used directly — so a deployment had no way to say which vendors it could reach. That is the gap this closes.

Unset, behaviour is unchanged.

## [0.3.0] - 2026-08-01

### Added

- **The server picks the model from your prompt when you do not name one.** A flash-lite classifier reads the request and routes it, and the choice plus its reason come back with the result. Naming a `style` still overrides it exactly and is never second-guessed.

  This reverses the advisory layer's position, which deliberately never routed on the grounds that silent substitution makes a caller's own logs lie. That argument does not apply to the case with no `style`, where the server was picking from a constant rather than making any decision at all. The choice is always reported, so it is never silent.

  Routed on the comparison in the README rather than on vendor marketing. Seven test prompts, seven correct picks: an exact count to GPT Image 2, a photograph to Recraft, a flowchart to Arrow, an exclusion to GPT Image 2, an ordinary illustration to Gemini Flash, a quick draft to Grok, and a stated light direction to Gemini 3 Pro, which got that right where Flash inverted it. About a second per call.

### Fixed

- **The default vendor now follows the keys you supplied** instead of being the constant `openai`. A server holding only a Gemini key was defaulting to OpenAI and failing every unstyled request on a missing key, which reads as a broken install rather than as a default nobody chose. A tie breaks toward OpenAI, since with a gateway key everything is reachable and with both first-party keys either would work.
- A classifier that is down, rate limited or slow falls back to that default and says which, rather than taking the generation with it.

## [0.2.0] - 2026-08-01

Renamed from `image-gen-pro-mcp`, because it generates video now too.

### Added

- **`generate_video`**, a separate tool from `generate_image`. Separate deliberately: a clip takes tens of seconds to minutes, costs far more per output, and the most useful input is usually a still you already have. Behind a flag on the image tool it would be a parameter that multiplies the bill by an order of magnitude.

  Four models: **Seedance 2.0 Fast** (default), **MiniMax H3**, **Grok Imagine Video 1.5**, **Gemini Omni Flash**. Pass `sourceImage` and the still becomes the first frame, which is the strongest lever here and the only way to keep a subject consistent across clips.

- **Video prompt advice.** A prompt naming no motion and no camera move gets told so, because the model then invents both and invents badly. Two actions in sequence gets told to split into separate clips, because every model here teleports between them. No `sourceImage` gets told what it is giving up.

### Fixed

- **Gemini Omni Flash is typed `language` on the gateway, not `video`**, the same trap as Gemini's image models: a multimodal LLM that emits video files rather than a video endpoint. The video API refuses it; `generateText` reaches it and the clip arrives on the response's files.
- **MiniMax rejects text-to-video with no aspect ratio**: omitting it sends `adaptive`, which returns `ratio is required for t2va (text-only) and cannot be 'adaptive'`. `16:9` is now sent when no ratio is given and there is no source image.
- **Seedance's refusal of a photographic source frame was read as a fault.** `The request failed because the input image 'content[1]' may contain real person` matches none of the usual moderation words, so the caller was told to check its network. It is now reported as a refusal, with what to do instead: seed from an image you generated rather than a photograph.
- **Ordering bug in the refusal-rewrite table.** The new person rule matches `woman`, which also appears in every sexual-content prompt, and it sat above the rule for those, so it offered a rewrite for a request that has none. Narrow refusals now sort above broad ones.

### Notes

- **Grok Imagine Video on a CLI subscription is present but disabled.** Its endpoint, poll path and accepted ratios are known, learned from its own error messages: `POST /v1/videos/generations` returns a `request_id`, the result comes from `GET /v1/videos/{id}`, and `auto` is not a valid ratio there even though it is for images. The shape of the `image` field is not known: both a data URL and a bare base64 string are refused with `invalid type: string`, and the account ran out of video credit before the right shape turned up.
- Grok Imagine Video through the gateway timed out at 600s on all three prompts in one run and completed all three in 19 to 23 seconds in the next, with no change but the timeout ceiling. I cannot account for the difference, and the timings in the README should be read with that in mind.

## [0.1.9] - 2026-07-31

### Added

- **`style: "grok-cli"` generates on a signed-in Grok CLI subscription instead of any API key.** xAI's CLI signs in with OIDC and leaves its access token in `~/.grok/auth.json`; that token authenticates the ordinary `api.x.ai/v1/images/generations` endpoint, so an image lands on an X Premium or SuperGrok plan rather than on API credit or the gateway. Found by reading pi-grok-cli's `src/imagine/generate.ts`, then confirmed against the live endpoint. It was the fastest route in the server at 4.2 seconds.

  The credential is read and never written. No refresh is attempted, because refreshing writes a new token into a file another program owns, and two writers on one auth file is how a working login gets broken by a tool that was only meant to read it. A stale `expires_at` is reported but not treated as fatal: it was 4.5 hours past on the machine this was built on and the token still worked, so the call is attempted and a 401 is answered with "sign in again" rather than being second-guessed in advance.

## [0.1.8] - 2026-07-30

### Added

- **A refusal now explains what to do instead.** When a provider declines a prompt, the result says so, tells the calling agent not to reword its way past the filter or try another model hoping it is more permissive, and where it can, names the legitimate version of the request. The suggestions only move in one direction: from naming an entity toward describing an aesthetic. "In Pixar style" is usually not a request for that studio, it is a request for stylised 3D animation, and naming the properties (oversized eyes with visible catchlights, soft subsurface scattering, rounded forms, warm key light with cool bounce) gets a better image than naming the studio would have. Where a request has no legitimate version, it says so and offers nothing, which is the distinction the feature rests on.
- **Two more advisories**, both borrowed from Grok's bundled `imagine` skill and confirmed by the run in the README. Anything needing exact text, real numbers or a correct structure (charts from data, tables, UI mockups, multi-panel grids) is pointed at building it in code and screenshotting it, because image models garble words and invent numbers and re-prompting garbles them again. A prompt about a recurring subject is pointed at `referenceImages`, because nothing here remembers a subject between calls and two generations of "the same" character always drift.
- Prompt-craft guidance in the tool description: subject first, then action or pose, setting, style, composition, lighting, details. Natural prose over keyword tags, two to five sentences, say what to include rather than what to leave out.

## [0.1.7] - 2026-07-30

### Changed

- Withdrew the claim that Grok Imagine filters content more loosely than the other models. It came from a third-party article about its launch period, not from anything measured in this repo, and the owner reports its moderation has since tightened; it declines the kinds of request the article implied it would allow. Removed rather than softened, because an untested claim about a model's safety behaviour invites routing decisions on made-up grounds. Its measured speed stays.

## [0.1.6] - 2026-07-30

### Added

- **Gemini 3 Pro Image**, on `gemini-pro` or `geminipro`. Same key and same route as Flash, roughly twice the wait. It is the answer when Flash gets something wrong: on the identical portrait prompt Flash inverted the light direction and Pro did not, and Pro passed the counting test that Flash narrowly failed.
- **Results now carry a note when a different model handled that kind of prompt better** in the published comparison, naming the model and why. A prompt with an exact count points at GPT Image 2 or Gemini 3 Pro; one that says what must NOT appear points at GPT Image 2; a diagram points at `svg: true`; a photograph points at Recraft. There is also a warning on the model actually used where the run found a specific failure: Flash's light direction, Seedream's watermark and speed, Arrow being unable to photograph anything.

  It is advice and never a reroute. Nothing changes which model runs, because a server that silently substituted one would make the caller's own logs lie. The signals are crude keyword tests on purpose; a model call to classify every prompt would cost money on every generation to produce a suggestion.

### Changed

- The README comparison now covers seven models across six categories.

## [0.1.4] - 2026-07-30

### Fixed

- Recraft rejected most image sizes with a bare 400 and an empty error message, so any call passing `size` failed for no visible reason. `1024x1024`, `1024x1707` and `1707x1024` all fail; `2048x2048` and `auto` work. Anything not shown to be accepted is now sent as `auto` rather than passed straight through. Found by generating 30 images for the README comparison, where it failed five out of five.

### Added

- A six-model comparison in the README: six prompt categories, one prompt each, the same text sent to all six models, one generation each. Each prompt states a rule you can check by counting or looking, so the results are gradeable rather than a matter of taste. Nothing cherry-picked, nothing retried.

## [0.1.3] - 2026-07-30

### Changed

- The Grok Imagine entry in the model catalogue now records its speed: roughly 6 seconds against 8 to 17 for the others, measured 30 July 2026. It is not a selection rule, and nothing routes to Grok because another model declined; you get it by asking for it, like every other vendor in the table. (This entry also claimed looser content filtering; see 0.1.7, where that claim was withdrawn.)

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
