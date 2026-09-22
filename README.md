# Media Gen Pro MCP

**Give your AI assistant real image generation, and get back files you can actually use.**

Ask Claude to build you a landing page and you'll get a lovely layout with `hero-image.png` referenced everywhere and no hero image anywhere. This fixes that. Your assistant describes the picture it needs, this makes it, and it hands back a file path that an `<img src>` can point at.

You need at least one API key. Setup takes about five minutes.

```json
{
  "mcpServers": {
    "media-gen-pro": {
      "command": "npx",
      "args": ["-y", "media-gen-pro-mcp"],
      "env": {
        "AI_GATEWAY_API_KEY": "paste-your-key-here",
        "IMAGE_GEN_OUTPUT_DIR": "/absolute/path/to/your/project/public/images"
      }
    }
  }
}
```

## What you get back

Paths, not pictures.

```
Generated 2 image(s) with **Gemini 3.1 Flash Image** via the direct route.

- `/Users/you/site/public/images/hero-4be44f.jpg` (332 KB, image/jpeg)
- `/Users/you/site/public/images/hero-40cab6-2.jpg` (318 KB, image/jpeg)

_Used 1 reference image._

_58 image(s) left this hour._
```

That's deliberate, and it's the main design decision in here. A 1024x1024 image is roughly 1.4 MB once it's base64'd into a chat. Three of those is a chunk of the conversation spent on bytes your assistant can't look at anyway. You wanted a file; here's the file.

## The models

One tool, several models, because the right one genuinely differs by job. **Name one with `style` and it is used exactly; leave it out and the server reads your prompt and picks.**

Routing costs one call on a flash-lite model, about a second, and the choice and its reason come back with the result:

```
Generated 1 image(s) with **GPT Image 2.5 Flare** via the gateway route.

_Model chosen from your prompt: the prompt requires an exact count of seven items
in a specific spatial arrangement. Pass `style` to override._
```

It routes on the comparison further down rather than on vendor marketing. On the seven routing prompts tested against the earlier model set, it picked correctly seven times out of seven: an exact count went to GPT Image 2, a photograph to Recraft, a flowchart to Arrow, an exclusion to GPT Image 2, an ordinary illustration to Gemini Flash, a quick draft to Grok, and a stated light direction to Gemini 3 Pro, which is the one that got that right when Flash inverted it. The classifier's model list has since grown; that run has not been repeated against it.

Without a gateway key the classifier cannot run, and the request falls back to whichever key you did supply, saying so.

| Say this | You get | Good for | Needs |
|---|---|---|---|
| nothing | **GPT Image 2.5 Flare** (`openai/gpt-image-2.5-flare`) | the general default, strong rule-following | the gateway |
| `gemini`, `nanobanana` | **Gemini 3.1 Flash Image** | fast, cheap, good with reference images | `GEMINI_API_KEY` or the gateway |
| `gemini-lite`, `flash-lite` | **Gemini 3.1 Flash Lite Image** | lowest cost, ultra-fast generation | `GEMINI_API_KEY` or the gateway |
| `gemini-pro`, `geminipro` | **Gemini 3 Pro Image** | the same route, slower and more obedient | `GEMINI_API_KEY` or the gateway |
| `recraft`, `photo`, `photoreal` | **Recraft V4.1 Pro** | premier photorealism | the gateway |
| `recraft-utility`, `utility` | **Recraft V4.1 Utility** | vector illustrations and design elements | the gateway |
| `recraft-utility-pro` | **Recraft V4.1 Utility Pro** | premium design utilities | the gateway |
| `recraft-v4.1` | **Recraft V4.1** | standard balanced generation | the gateway |
| `seedream`, `bytedance` | **Seedream 5.0 Pro** | rich illustration; slow, up to ~100s | the gateway |
| `grok`, `imagine` | **Grok Imagine 2.0** (`spacexai/grok-imagine-image-2.0`) | held the count, the exclusion and the attribute binding | the gateway |
| `grok-cli`, `subscription` | **Grok Imagine**, on your Grok CLI login | fastest here (~4s), and it costs no credit | the Grok CLI, signed in |
| `muse`, `meta` | **Muse Image 1.0** (`meta/muse-image-1.0`) | fast Meta image generator | the gateway |
| `flare` | **GPT Image 2.5 Flare** (`openai/gpt-image-2.5-flare`) | fast everyday generation, strong rule-following | the gateway |
| `sunburst` | **GPT Image 2.5 Sunburst** (`openai/gpt-image-2.5-sunburst`) | precise editing, strong rule-following | the gateway |
| `svg`, `arrow` | **Arrow 2** (`quiverai/arrow-2`) | real SVG, editable vector source; the fast, cheaper vector route | the gateway |
| `telos`, `svg-telos` | **Arrow 2 Telos** (`quiverai/arrow-2-telos`) | the same vector output, more refined, for a harder brief | the gateway |

"nanobanana" is in there because that's what people call Gemini's image model out loud. A server that only accepts the official string makes you look up a name you already know.

## Real SVGs

Set `svg: true` and you get vector source from **Arrow 2**: actual `<svg>` markup built from shapes and geometry, which you can open, edit and scale. The raster models can't do this. Ask any of them for an SVG and you get a picture that looks like one, which is a different thing and useless if you wanted to change the colour of one path.

There are two of them, and Quiver's own guidance is the guidance here: **Arrow 2** when speed and cost per asset are what matter, **Arrow 2 Telos** for a harder brief that benefits from more refinement — a dense diagram, a detailed illustration, a technical drawing, or a set of variants that has to hold one style. `svg: true` gives you Arrow 2; add `style: "telos"` alongside it to get Telos instead. Quiver says Arrow 2 uses fewer, more precise control points and respects spacing and alignment without exhaustive prompting; I have not measured either claim.

Arrow 1.1 was retired here in 0.7.0. Asking for it by name now returns "unknown style" rather than quietly handing you something else, and its results are still in the bench, marked superseded.

**Arrow 2 is priced per token, not per image.** Arrow 1.1 charged a flat $0.20 a generation; Arrow 2 bills $4.00 per million input tokens and $20.00 per million output tokens, and Telos $6.00 and $30.00. An SVG therefore costs roughly what its source is long, so a dense diagram genuinely costs more than a simple icon — which was not true before.

After an SVG, the tool suggests offering you a raster version too, in a similar flat style, from one of the picture models. It won't generate that unasked; it's a second billed call.

## Eleven models, six hard prompts

One prompt per category, shown in full below each heading, the same text sent to every model, one generation each, nothing cherry-picked and nothing retried. The prompts are deliberately awkward: each one states a rule you can check by counting or looking, so you can grade the results yourself instead of taking my word for which is prettier.

> **The tables below are thumbnails, and you cannot count seven bolts in a thumbnail.**
> Open **[`docs/model-bench.html`](docs/model-bench.html)** for the same run at a size you can
> actually judge: one prompt at a time with its rule pinned beside the picture, arrow keys to
> flick between models *in the same frame*, a split view to put two finalists at identical scale,
> and zoom to check the claim about wobbling lines yourself. Clips play inline instead of
> downloading. It is a plain file — clone the repo and open it, no server needed.

The four-model rows were run 30 July 2026. Grok Imagine 2.0, Muse Image 1.0 and Gemini 3.1 Flash Lite were run on the same six prompts on 4 September 2026, when those models were added, GPT Image 2.5 Flare and GPT Image 2.5 Sunburst on 9 September 2026, and Arrow 2 and Arrow 2 Telos on 22 September 2026, replacing Arrow 1.1 — whose results are still in the bench, marked superseded. One cell was re-requested: `portrait-telos` returned a gateway timeout on its first attempt and the prompt was sent again unchanged; every other cell in the table is a first response. These are single samples, not a benchmark. Re-run any of them and you may get a different answer.

### 1. Exact count and arrangement

> Exactly seven identical brass hexagonal bolts on a plain grey surface, arranged as two rows of three with the seventh bolt standing upright on its end at the front centre. No bolt touches another.

| Gemini 3.1 Flash | Gemini 3 Pro | Recraft V4.1 Pro |
|---|---|---|
| ![](docs/examples/counting-google.jpg) | ![](docs/examples/counting-googlepro.jpg) | ![](docs/examples/counting-recraft.jpg) |
| 7, correct layout, one bolt touching | **7, correct layout, nothing touching** | 6 |

| Seedream 5.0 Pro | Grok Imagine 2.0 | Muse Image 1.0 | Gemini 3.1 Flash Lite |
|---|---|---|---|
| ![](docs/examples/counting-bytedance.jpg) | ![](docs/examples/counting-grok2.jpg) | ![](docs/examples/counting-muse.jpg) | ![](docs/examples/counting-googlelite.jpg) |
| 7, upright one behind not in front, several touching | 7, correct layout, upright one overlapping the bolt behind | **7, correct layout, nothing touching** | 7, correct layout, upright one overlapping |

| GPT Image 2.5 Flare | GPT Image 2.5 Sunburst | Arrow 2 (SVG) | Arrow 2 Telos (SVG) |
|---|---|---|---|
| ![](docs/examples/counting-flare.jpg) | ![](docs/examples/counting-sunburst.jpg) | ![](docs/examples/counting-quiver2.svg) | ![](docs/examples/counting-telos.svg) |
| **7, correct layout, nothing touching** | **7, correct layout, nothing touching** | **7, correct layout, nothing touching** | **7, correct layout, nothing touching** |

Gemini 3 Pro, Muse Image 1.0, Flare, Sunburst and both Arrow 2 models are the clean passes; Muse placed all seven with the upright bolt at the front centre and nothing touching, and both 2.5 siblings did exactly the same. Recraft produced by far the best photograph and got the count wrong, which is the trade in one image. Arrow 2 and Arrow 2 Telos each placed all seven as two rows of three with the upright bolt at the front centre, nothing touching — the layout Arrow 1.1 flattened into a ring. Grok Imagine 2.0 is a clear improvement on 1.0, whose result on this prompt — five bolts in a single row — is still in `docs/examples/counting-xai.jpg`.

### 2. Absence

> An empty hotel corridor at 3am. No people, no reflections in any mirror, no light under any door, nothing on the floor. Bare carpet, closed doors, one ceiling light.

| Gemini 3.1 Flash | Gemini 3 Pro | Recraft V4.1 Pro |
|---|---|---|
| ![](docs/examples/absence-google.jpg) | ![](docs/examples/absence-googlepro.jpg) | ![](docs/examples/absence-recraft.jpg) |

| Seedream 5.0 Pro | Grok Imagine 2.0 | Muse Image 1.0 | Gemini 3.1 Flash Lite |
|---|---|---|---|
| ![](docs/examples/absence-bytedance.jpg) | ![](docs/examples/absence-grok2.jpg) | ![](docs/examples/absence-muse.jpg) | ![](docs/examples/absence-googlelite.jpg) |

| GPT Image 2.5 Flare | GPT Image 2.5 Sunburst | Arrow 2 (SVG) | Arrow 2 Telos (SVG) |
|---|---|---|---|
| ![](docs/examples/absence-flare.jpg) | ![](docs/examples/absence-sunburst.jpg) | ![](docs/examples/absence-quiver2.svg) | ![](docs/examples/absence-telos.svg) |

Text encoders have no NOT operator, so "no mirrors" tends to summon mirrors. Seedream put two framed mirrors on the walls and two ceiling lights, and stamped "AI generated" across the corner. Grok Imagine 2.0 also came back fully compliant — empty carpet, closed doors, a single ceiling fitting and no light under any door. Flare and Sunburst both joined the compliant set: empty corridors, closed doors, single fittings, nothing on the floor and nothing reflected. Arrow 2 and Telos are compliant too — zoom in on the door bases in either and there is no strip of light under them.

### 3. Attribute binding against the obvious pairing

> Five objects in a row on a white studio backdrop: a matte black ceramic banana, a glossy yellow steel wrench, a translucent green wooden mug, a brushed copper cloth apple, a rough concrete glass fish.

| Gemini 3.1 Flash | Gemini 3 Pro | Recraft V4.1 Pro |
|---|---|---|
| ![](docs/examples/binding-google.jpg) | ![](docs/examples/binding-googlepro.jpg) | ![](docs/examples/binding-recraft.jpg) |

| Seedream 5.0 Pro | Grok Imagine 2.0 | Muse Image 1.0 | Gemini 3.1 Flash Lite |
|---|---|---|---|
| ![](docs/examples/binding-bytedance.jpg) | ![](docs/examples/binding-grok2.jpg) | ![](docs/examples/binding-muse.jpg) | ![](docs/examples/binding-googlelite.jpg) |

| GPT Image 2.5 Flare | GPT Image 2.5 Sunburst | Arrow 2 (SVG) | Arrow 2 Telos (SVG) |
|---|---|---|---|
| ![](docs/examples/binding-flare.jpg) | ![](docs/examples/binding-sunburst.jpg) | ![](docs/examples/binding-quiver2.svg) | ![](docs/examples/binding-telos.svg) |

Every colour is deliberately wrong for its object, so a yellow banana is a visible failure rather than a matter of taste. Grok Imagine 2.0 bound all five and got the materials as well: a matte black banana, a glossy yellow wrench, a translucent green mug, a brushed copper apple and a speckled concrete fish, all separated cleanly on the backdrop. Flare and Sunburst bound all five as well — Sunburst's mug even shows the wood grain through the green glass, and both kept the concrete body and glass fins of the fish apart instead of blending them. Arrow 2 and Telos bound all five as well, differing on one: Arrow 2's apple reads as copper, Telos's as orange.

### 4. Geometric constraint

> A clean flowchart: three rectangular boxes in a horizontal row connected left to right by two straight arrows. Every line at exactly 0 or 90 degrees, uniform gaps between boxes, no crossing lines, thin uniform stroke weight, flat colour, no shading.

| Gemini 3.1 Flash | Gemini 3 Pro | Recraft V4.1 Pro |
|---|---|---|
| ![](docs/examples/diagram-google.jpg) | ![](docs/examples/diagram-googlepro.jpg) | ![](docs/examples/diagram-recraft.jpg) |

| Seedream 5.0 Pro | Grok Imagine 2.0 | Muse Image 1.0 | Gemini 3.1 Flash Lite |
|---|---|---|---|
| ![](docs/examples/diagram-bytedance.jpg) | ![](docs/examples/diagram-grok2.jpg) | ![](docs/examples/diagram-muse.jpg) | ![](docs/examples/diagram-googlelite.jpg) |

| GPT Image 2.5 Flare | GPT Image 2.5 Sunburst | Arrow 2 (SVG) | Arrow 2 Telos (SVG) |
|---|---|---|---|
| ![](docs/examples/diagram-flare.jpg) | ![](docs/examples/diagram-sunburst.jpg) | ![](docs/examples/diagram-quiver2.svg) | ![](docs/examples/diagram-telos.svg) |

This is the category the vector models exist for, and Arrow 2 takes it: three boxes sharing one `y` and one `height`, gaps of 34.46 and 34.18 units, both connectors drawn as `<line>` elements with `y1` equal to `y2`, flat fills, stroke weights 4% apart. Telos is the more interesting result. It matched that geometry — gaps of 105.5 and 106 — and then broke the half of the brief Arrow 2 honoured, filling its boxes from a `linearGradient` and adding inner-edge highlight strokes on a prompt that asks for flat colour and no shading, with box and connector strokes a third apart. Recraft came second among the raster models and labelled its boxes, with uneven widths. Zoom in on any of the raster ones and the "straight" lines wobble, because a sampler is hallucinating straightness pixel by pixel rather than drawing a line.

### 5. Reflection and shadow

> A chrome kettle on a mirrored tabletop beside a window at 4pm. The reflection in the tabletop shows the underside of the kettle, and its shadow falls away from the window across the table.

| Gemini 3.1 Flash | Gemini 3 Pro | Recraft V4.1 Pro |
|---|---|---|
| ![](docs/examples/physics-google.jpg) | ![](docs/examples/physics-googlepro.jpg) | ![](docs/examples/physics-recraft.jpg) |

| Seedream 5.0 Pro | Grok Imagine 2.0 | Muse Image 1.0 | Gemini 3.1 Flash Lite |
|---|---|---|---|
| ![](docs/examples/physics-bytedance.jpg) | ![](docs/examples/physics-grok2.jpg) | ![](docs/examples/physics-muse.jpg) | ![](docs/examples/physics-googlelite.jpg) |

| GPT Image 2.5 Flare | GPT Image 2.5 Sunburst | Arrow 2 (SVG) | Arrow 2 Telos (SVG) |
|---|---|---|---|
| ![](docs/examples/physics-flare.jpg) | ![](docs/examples/physics-sunburst.jpg) | ![](docs/examples/physics-quiver2.svg) | ![](docs/examples/physics-telos.svg) |

Reflections are the reliable giveaway of a model compositing plausible patches rather than simulating a scene. Recraft's is the photograph you would actually ship, and its reflection is a mirror-flip of the kettle's side rather than the underside the brief asked for. Arrow 2 Telos got both checkable parts: a reflection showing the base of the kettle, and a shadow cast to the left, away from the window. Arrow 2 drew the reflection and no cast shadow at all.

### 6. A person, with the pose specified

> A woman in her fifties sitting on a wooden stool against a bare plaster wall, three-quarter view facing left, wearing a plain charcoal roll-neck jumper. Her hands rest one on top of the other on her left knee, with exactly five thin silver rings between them. Single hard window light from the right, casting her shadow onto the wall to the left. Sharp focus on the eyes, shallow depth of field, 85mm.

| Gemini 3.1 Flash | Gemini 3 Pro | Recraft V4.1 Pro |
|---|---|---|
| ![](docs/examples/portrait-google.jpg) | ![](docs/examples/portrait-googlepro.jpg) | ![](docs/examples/portrait-recraft.jpg) |
| **shadow on the wrong side** | shadow correct, hands not stacked | best photo, ~5 rings |

| Seedream 5.0 Pro | Grok Imagine 2.0 | Muse Image 1.0 | Gemini 3.1 Flash Lite |
|---|---|---|---|
| ![](docs/examples/portrait-bytedance.jpg) | ![](docs/examples/portrait-grok2.jpg) | ![](docs/examples/portrait-muse.jpg) | ![](docs/examples/portrait-googlelite.jpg) |
| facing camera, hands side by side | faces left, shadow correct, hands side by side | **hands stacked, shadow correct**, near-profile | faces left, shadow correct, hands side by side |

| GPT Image 2.5 Flare | GPT Image 2.5 Sunburst | Arrow 2 (SVG) | Arrow 2 Telos (SVG) |
|---|---|---|---|
| ![](docs/examples/portrait-flare.jpg) | ![](docs/examples/portrait-sunburst.jpg) | ![](docs/examples/portrait-quiver2.svg) | ![](docs/examples/portrait-telos.svg) |
| **faces left, hands stacked, five plain bands, shadow correct** | **faces left, hands stacked, five rings (two stone-set), shadow correct** | faces left, hands stacked, shadow correct, six rings | faces left, hands stacked, shadow correct, seven rings |

Four checkable things: which way she faces, whether one hand sits on the other, how many rings, and which side the shadow falls. Gemini 3.1 Flash lit her from the left and threw the shadow right, which is the one unambiguous miss in the whole run. Gemini 3 Pro, on the identical prompt, got it right, which is the clearest reason to reach for the slower sibling. Recraft produced the photograph you would ship and turned three-quarter into near-profile. Arrow 2 and Telos both got the pose and the light — three-quarter facing left, hands stacked on the knee, shadow on the wall to the left — and both then missed the count, which in a vector file you can settle rather than squint at. Arrow 2 drew six rings: `stroke="#BEB5B3"` appears exactly six times, in two groups of three across the fingers. Telos drew seven, three on the lower hand and four on the upper, inside groups it helpfully named `lower-hand-rings` and `upper-hand-rings`. Of the newer models, Muse Image 1.0 was the first in the whole run to stack one hand on the other as the brief asked; it also lit and shadowed her correctly, but pushed three-quarter to near-profile. Grok Imagine 2.0 and Flash Lite both got the facing and the shadow right and left the hands side by side. Flare and Sunburst are now the fullest passes on this prompt: three-quarter facing left, hands stacked, five rings each, shadow on the left wall — Flare's all plain bands, Sunburst's with two stone-set.

### What this suggests

Nothing here is a benchmark, but the shape is consistent enough to route by:

- **GPT Image 2.5 Flare** for briefs with rules in them, and the default when you name no style. A clean pass on the count and the arrangement, every "no" in the absence prompt honoured, all five bindings bound.
- **Recraft V4.1 Pro** when it has to look like a photograph, and check the details yourself. `recraft-utility` and `recraft-v4.1` are the cheaper siblings at a sixth of the price; `recraft-utility-pro` matches Pro's price.
- **Arrow 2** for anything diagrammatic, and for any brief that asks for flat — it stays flat. On the flowchart it produced the cleanest geometry in the run. **Arrow 2 Telos** for a dense or illustrative piece where you want the extra rendering; on the same flowchart that instinct added a gradient the brief had ruled out, which is the trade in one image.
- **Gemini 3.1 Flash** as the cheap default, with the caveat that it is the one model observed to invert a stated light direction.
- **Gemini 3 Pro Image** when Flash gets something wrong. Same key, same route, roughly twice the wait; it passed the count and fixed Flash's lighting miss.
- **Gemini 3.1 Flash Lite Image** as the cheapest route here (about half Flash's per-image price). On these six prompts it held the count and got the portrait's lighting right, which Flash did not.
- **Grok Imagine 2.0** is the biggest change since the last run: it passed the count, the absence prompt and the attribute-binding prompt. The Grok Imagine 1.0 results on the same three prompts are still in [`docs/examples/`](docs/examples/) under `*-xai.jpg` — five bolts in a single row, and a melted wrench.
- **Muse Image 1.0** the cheapest model in the table at $0.01 an image, and the first that stacked the hands as the portrait brief asked. It was also a clean pass on the count.
- **GPT Image 2.5 Flare and Sunburst** the strongest obedience pair in the table: clean passes on the count, the absence prompt and the attribute binding, and the fullest passes on the portrait. OpenAI positions Flare for fast everyday generation and Sunburst for precise editing; both are gateway-only, and neither is on OpenAI's own API.
- **Seedream 5.0 Pro** last on this evidence: slowest by a wide margin, and it watermarks.

_These are single generations. I inspected all six prompts for Arrow 2 and Arrow 2 Telos, and the counting, absence, binding and portrait results for the newer raster models; the raster diagram and reflection rows are published unjudged for you to grade. Every file is in [`docs/examples/`](docs/examples/)._

## Video

```json
"env": { "AI_GATEWAY_API_KEY": "...", "IMAGE_GEN_OUTPUT_DIR": "/abs/path/public/media" }
```

`generate_video` is a separate tool from `generate_image`, deliberately. A clip takes tens of seconds to minutes, costs far more per output, and the most useful input is usually a still you already have. Putting that behind a flag on the image tool would be a parameter that multiplies your bill by an order of magnitude.

| Say this | You get | Needs |
|---|---|---|
| nothing, or `seedance` | **Seedance 2.0** (`bytedance/seedance-2.0`) | the gateway |
| `seedance-mini` | **Seedance 2.0 Mini** (`bytedance/seedance-2.0-mini`) | the gateway |
| `minimax`, `h3` | **MiniMax H3** (`minimax/minimax-h3`) | the gateway |
| `minimax-max`, `h3-max` | **MiniMax H3 Max** (`minimax/minimax-h3-max`) | the gateway |
| `wan`, `wan-video` | **Wan 3.0 Video** (`alibaba/wan-v3.0-video`) | the gateway |
| `wan-prime` | **Wan 3.0 Video Prime** (`alibaba/wan-v3.0-video-prime`) | the gateway |
| `flux`, `flux-video` | **FLUX.3 Video** (`bfl/flux-3-video`) | the gateway |
| `grok`, `imagine` | **Grok Imagine Video 1.5** (`spacexai/grok-imagine-video-1.5`) | the gateway |
| `gemini`, `google`, `omni` | **Gemini Omni Flash** (`google/gemini-omni-flash-preview`) | the gateway |
| `veo`, `veo-lite` | **Veo 3.1 Lite** (`google/veo-3.1-lite-generate-001`) | the gateway |

Pass `sourceImage` and the still becomes the first frame. That is the strongest lever here and the only way to keep a subject consistent across clips: generate a still with `generate_image`, then animate it.

### The same three prompts, models compared

Clips seeded from the stills in the comparison above, and one from text alone. 4–5 seconds each, one generation, nothing retried. **The clips below are links; [`docs/model-bench.html`](docs/model-bench.html) plays them inline, side by side, with the cost and the elapsed time on each.**

| | Veo 3.1 Lite | MiniMax H3 Max | FLUX.3 Video | Grok Imagine Video 1.5 | Gemini Omni Flash | MiniMax H3 | Seedance 2.0 Fast |
|---|---|---|---|---|---|---|---|
| **kettle** (from still) | [mp4](docs/examples/video/kettle-veo.mp4), 35s | [mp4](docs/examples/video/kettle-minimax-max.mp4), 14s | [mp4](docs/examples/video/kettle-flux.mp4), 71s | [mp4](docs/examples/video/kettle-grok.mp4), 23s | [mp4](docs/examples/video/kettle-gemini.mp4), 34s | [mp4](docs/examples/video/kettle-minimax.mp4), 229s | [mp4](docs/examples/video/kettle-seedance.mp4), 110s |
| **portrait** (from still) | [mp4](docs/examples/video/portrait-veo.mp4), 34s | [mp4](docs/examples/video/portrait-minimax-max.mp4), 14s | [mp4](docs/examples/video/portrait-flux.mp4), 57s | [mp4](docs/examples/video/portrait-grok.mp4), 21s | [mp4](docs/examples/video/portrait-gemini.mp4), 37s | [mp4](docs/examples/video/portrait-minimax.mp4), 246s | refused |
| **text only** | [mp4](docs/examples/video/text-veo.mp4), 28s | [mp4](docs/examples/video/text-minimax-max.mp4), 14s | [mp4](docs/examples/video/text-flux.mp4), 69s | [mp4](docs/examples/video/text-grok.mp4), 44s | [mp4](docs/examples/video/text-gemini.mp4), 32s | [mp4](docs/examples/video/text-minimax.mp4), 221s | [mp4](docs/examples/video/text-seedance.mp4), 109s |

MiniMax H3 Max returned in 14s on all three prompts, the fastest and most consistent in the run. Veo 3.1 Lite took 28–35s and was the only newly added model to complete all three, including the photographic portrait that Seedance refuses. Grok Imagine Video 1.5 ran 21–44s. FLUX.3 Video was the slowest of the new set at 57–71s.

Treat all of these as one sample rather than a benchmark. The Grok clips here are a second run of the identical three prompts, and text-to-video came back in 44s where the first run took 28s — the same model, the same prompt, the same afternoon. The older Seedance, MiniMax H3 and Gemini rows are from 31 July and 1 August 2026, and their clips were generated with `seedance-2.0-fast`, which the `seedance` alias no longer points at.

I have not graded the motion quality of any of these clips — the times are measured, the picks are yours.

### What a clip costs

List rates from the gateway's own `/v1/models` catalogue, read 4 September 2026, cheapest first. **The five-second column is arithmetic on those rates, not a measured bill** — the output resolution of each clip above was never recorded, and the token-priced models cannot be converted to a per-second figure at all.

| Model | List rate | A 5-second clip |
|---|---|---|
| **MiniMax H3 Max** | $0.025/s at 480p, $0.04/s at 768p | **$0.13 – $0.20** |
| **Veo 3.1 Lite** | $0.03/s at 720p silent, $0.08/s at 1080p with audio | **$0.15 – $0.40** |
| **MiniMax H3** | $0.04/s at 768p, $0.065/s at 2K | **$0.20 – $0.33** |
| **Wan 3.0 Video** | $0.05/s at 480p, $0.10/s at 720p, $0.20/s at 1080p | **$0.25 – $1.00** |
| **Wan 3.0 Video Prime** | $0.068/s at 480p, $0.14/s at 720p, $0.28/s at 1080p | **$0.34 – $1.40** |
| **Grok Imagine Video 1.5** | $0.08/s at 480p, $0.14/s at 720p, $0.25/s at 1080p | **$0.40 – $1.25** |
| **Seedance 2.0 Mini** | token-priced — $3.50 per million tokens at 480p/720p | depends on tokens |
| **Seedance 2.0** | token-priced — $7.00 per million tokens, no video input | depends on tokens |
| **Gemini Omni Flash** | token-priced — $9.00 per million output tokens | depends on tokens |
| **FLUX.3 Video** | not published in the gateway catalogue | unknown |

The cheapest and the fastest are the same model here: MiniMax H3 Max returned every clip in 14 seconds at roughly a sixth of what Grok Imagine Video costs at 1080p. That is the one place in this comparison where speed and price point the same way, so it is worth knowing before you reach for something dearer.

Prices move. Check the vendor's current pricing rather than trusting a number written here.

Seedance refuses a photographic face as a source frame ("may contain real person"). That is its own moderation, not a bug here, and the tool reports it as a refusal with what to do instead: seed from an image you generated rather than a photograph.

### Rough edges

**Veo 3.1 Lite enforces specific durations.** The gateway endpoint accepts `[4, 6, 8]` seconds; any other duration (such as 5s) fails with `Unsupported output video duration`. The server automatically clamps or selects the nearest valid duration (defaulting to 4s when 5s is requested).

**Gemini Omni Flash is not a video model on the gateway.** It is typed `language`, the same trap as Gemini's image models: a multimodal LLM that emits video files rather than a video endpoint. The video API refuses it; `generateText` reaches it and the clip arrives on the response's files.

**MiniMax needs an explicit aspect ratio for text-to-video.** Omitting it sends `adaptive`, which it rejects outright. The server passes `16:9` when you give no ratio and there is no source image.

**Grok Imagine Video on a CLI subscription is present but disabled.** The endpoint, the poll path and the accepted ratios are all known, learned from its own error messages: `POST /v1/videos/generations` returns a `request_id`, the result comes from `GET /v1/videos/{id}`, and `auto` is not a valid ratio there even though it is for images. What is not known is the shape of the `image` field: both a data URL and a bare base64 string are refused with `invalid type: string`, and the account ran out of video credit before the right shape turned up. Shipping it as working would mean a route that fails on two of its three uses.

## Writing a prompt that works

Front-load the subject, then action or pose, setting, style, composition, lighting, key details. Natural prose rather than keyword tags, two to five sentences. Say what to include rather than what to leave out. One scene per prompt.

Two things worth knowing before you reach for this at all:

**If it needs exact text, real numbers, or a correct structure, build it in code.** Charts from data, labelled diagrams, tables, UI mockups, multi-panel grids. Image models garble words, invent numbers, and draw bars that match no data, and re-prompting garbles them again. HTML and CSS give you exact values and a layout you control; screenshot that. Use this server for the parts where only the look matters.

**Nothing here remembers a subject between calls.** Two generations of "the same" character always drift. Generate one canonical image, then pass its path in `referenceImages` on every later call and restate the fixed traits each time.

The tool result tells you both of these when the prompt looks like it needs them, along with which model handled that kind of brief best in the comparison above.

## When a model says no

Providers refuse things. When one does, the result explains what to do instead rather than just reporting the error, and it tells the calling agent not to reword its way past the filter or shop the prompt around other models.

The suggestions only move in one direction: from naming an entity toward describing an aesthetic. "In Pixar style" is usually not a request for that studio at all, it is a request for stylised 3D animation, and naming the properties gets a better image than naming the studio would have:

> stylised 3D character animation, oversized eyes with visible catchlights, soft subsurface scattering on the skin, rounded simplified forms, warm key light with cool bounce, shallow depth of field

Same for a borrowed character: describe the build, costume shapes, silhouette and expression you actually want, and the result is reusable as a `referenceImages` anchor, which a trademark never is.

Where a request has no legitimate version, it says so and offers nothing. That distinction is the whole point of the feature.

## Reference images and context

Two things beyond the prompt, and both change the result.

**Reference images.** Paths to files on your machine. Use them to match an existing style, keep a product or character consistent across a set, or edit an image you already have.

**Context.** Extra text kept separate from the prompt: brand rules, a palette, what the surrounding page says, what to avoid. Separate so the subject stays legible instead of drowning in instructions.

```
prompt:          "Hero illustration: a paper aeroplane over a pale gradient"
referenceImages: ["/Users/you/brand/style-sheet.png"]
context:         "Match the brand palette in the reference. Flat vector, no gradients on the subject, no text anywhere in the image."
n:               3
```

**Note:** reference images are read from disk by this server, so absolute paths are safest, and they must be readable by whatever runs the MCP. They're not URLs and not base64.

## Rough edges, said plainly

**Gemini can't do more than one image per call.** Asking for three means three requests behind the scenes, fanned out in parallel. Worth knowing why three Gemini images take about as long as one and cost three times as much.

**Nobody agrees what format they're returning.** Gemini returns JPEG, Recraft returns WebP, and Arrow 1.1 returned SVG source labelled `image/png`. The server sniffs the actual bytes and names the file accordingly rather than trusting the label, so you get `.jpg`, `.webp` and `.svg` where those are what arrived. Nothing for you to do; it's just why extensions vary.

**Arrow 2 is a language model, where Arrow 1.1 was an image model.** This is the same shape as Gemini and the gateway enforces it: sending `quiverai/arrow-2` to the image endpoint answers *"Model 'quiverai/arrow-2' is a language model, not an image model."* So the server reaches both Arrow 2 models through the text API, and accepts the SVG whether it arrives as a file or as source in the response text, which is the form a language model tends to use. One SVG per call, so asking for three is three calls.

**Recraft now works through the normal image route.** It used to need the gateway's OpenAI-compatible endpoint, because the gateway's own image-model route answered with an error for every Recraft model. Re-checked 4 September 2026: all four V4.1 variants generate correctly through the standard SDK image route, so that workaround is gone. The old route also clamped unsupported sizes to `auto`; on the standard route size handling is the SDK's, and I have not re-tested which sizes Recraft accepts.

**Gemini's image models are language models.** Flash, Flash Lite and 3 Pro are all typed `language` on the gateway and the image API refuses them outright. The server reaches them with `generateText` and pulls the image off the response files.

## Getting a key

You need at least one. Any one is enough to start.

**Google AI Studio** ([aistudio.google.com/apikey](https://aistudio.google.com/apikey)) gives you Gemini 3.1 Flash Image. Sign in, click **Create API key**, copy it. This is the quickest one to get working.

**Or no key at all**, for one route: if you have xAI's `grok` CLI installed and signed in, `style: "grok-cli"` uses that session and bills your X Premium or SuperGrok subscription rather than any API balance. It reads the token from `~/.grok/auth.json`, never writes to it, and never refreshes it, because two programs writing one auth file is how a working login gets broken.

**Vercel AI Gateway** ([vercel.com/docs/ai-gateway](https://vercel.com/docs/ai-gateway)) gives you everything from one key, and it's the only way to reach Flare, Sunburst, Recraft, Seedream, Grok Imagine, Muse and Arrow, none of which have a first-party key here. If you only get one key, get this one.

Treat any of them like a password, because that's what they are. Don't paste one into a chat, don't commit one to a repo.

## About money, and a plain warning

**Every image costs you.** Image models are billed per image and they're the expensive kind, meaningfully more than a text call. Prices move, so check each vendor's current pricing rather than trusting a number written here.

**Set a budget before you start.** Google Cloud and Vercel both let you set a spending limit and an alert. It takes two minutes each and it's the difference between a surprise and a number you chose. If you only do one thing from this section, do that one.

This server ships with an hourly cap of 60 images, on by default, because an assistant stuck in a retry loop is exactly the thing that runs up a bill nobody agreed to. There's also a per-call cap of 4, so "generate some options" can't quietly become forty. Both are yours to raise, deliberately rather than by accident.

> **No liability for spend.** This is free software provided as-is under the MIT licence. You are responsible for your own API usage and any charges Google or Vercel bill you, including charges caused by bugs, misconfiguration, runaway agents, or anything else. Neither Luke Rhodes nor Fledgeling is liable for your spending. Set a budget.

## Settings

All optional except having at least one key. Set them alongside the key in the `env` block.

| Setting | Default | What it does |
|---|---|---|
| `GEMINI_API_KEY` | | Your AI Studio key. `GOOGLE_API_KEY` works too, since Google's own tools read that one |
| `AI_GATEWAY_API_KEY` | | Vercel AI Gateway. Reaches everything, and is the only route to Flare, Sunburst, Recraft, Seedream, Grok Imagine, Muse and both Arrow models |
| _(none)_ | | `style: "grok-cli"` needs no key. It uses the Grok CLI's signed-in session, read from `~/.grok/auth.json` |
| `IMAGE_GEN_OUTPUT_DIR` | working directory | Where images are written. Point it at your project's image folder and the paths come back ready to use |
| `IMAGE_GEN_DEFAULT_PROVIDER` | whichever key you set | Pins the fallback used when routing cannot run. Defaults to Flare when you have a gateway key, Google when Gemini is all you have |
| `IMAGE_GEN_ALLOWED_STYLES` | unset (no restriction) | Style aliases this deployment can actually reach, comma-separated, e.g. `gemini-pro,gemini`. The classifier then chooses within the set, and a request it routes elsewhere is substituted by tier rather than refused. Set this wherever some vendors are unreachable — a Zero-Data-Retention gateway, a missing BYOK credential, a provider you have not enabled |
| `IMAGE_GEN_PREFER_GATEWAY` | `false` | Route through the gateway even when a direct key exists. Turn on to put all the billing in one place |
| `IMAGE_GEN_MAX_PER_HOUR` | `60` | Images per rolling hour. `0` removes the cap, knowing what that means for your bill |
| `IMAGE_GEN_MAX_PER_CALL` | `4` | Ceiling on one request, whatever the assistant asks for |
| `IMAGE_GEN_TIMEOUT_MS` | `180000` | How long to wait. Image models are slow; three minutes is not generous |

Two things the server handles that are worth knowing only if you're reading the code. The same model has different ids per route (`gemini-3.1-flash-image` direct, `google/gemini-3.1-flash-image` on the gateway). And Gemini's image models are multimodal *language* models, so they're reached through the text API, not the image one; the gateway types them `language` and refuses them on the image route.

## What it doesn't do

Worth saying plainly, so you know before you install it.

It doesn't return image data to your assistant, so your assistant can't look at what it made. It knows the file exists and where; it can't see whether the composition worked. Open the file yourself, or hand the path to a tool that can read images.

It doesn't upscale, crop, convert, or optimise. One job.

It won't rescue a vague prompt. Reference images help more than adjectives do.

## For developers

TypeScript, ESM, Node 20.11 or newer. FastMCP over stdio, Vercel AI SDK v7 (`generateImage`, not the removed `experimental_generateImage`), Zod at every boundary, `exactOptionalPropertyTypes` on, no `any`.

```bash
npm install
npm run gate     # typecheck, lint, test, build
```

Routing lives in `src/models.ts` as a table and a pure function, because routing is the part people get wrong and a chain of ifs spread through a handler is how it stays wrong.

## Who made this

I'm **Luke Rhodes**, a founder and engineer building [Fledgeling](https://www.fledgeling.app). I spent years shipping developer tools and got tired of proprietary formats and slow editors, so Fledgeling is the opposite of that: fast software built from scratch, your work in plain text you own, and AI as a collaborator you can always overrule. The human is always the editor of record.

I'm also co-founder of [Diolog](https://diolog.app) with Amy Benson, building investor-relations software for listed companies and the retail investors following them.

- GitHub: [github.com/lprhodes](https://github.com/lprhodes)
- LinkedIn: [linkedin.com/in/lukerhodes](https://www.linkedin.com/in/lukerhodes/)
- X: [x.com/lp_rhodes](https://x.com/lp_rhodes)
- Email: [hello@fledgeling.app](mailto:hello@fledgeling.app)

## Three related things

**[Google Search MCP](https://www.npmjs.com/package/google-search-api-mcp)** is this one's sibling. Where this makes pictures, that one does the looking: Google search through the Gemini API, returning the answer, the real source URLs (not Google's opaque redirects), and the queries the model actually ran.

```
npx -y google-search-api-mcp
```

**[Dossier](https://www.npmjs.com/package/dossier-research-mcp)** is the big one. It runs proper deep research: several backends on the same question at once (Gemini, Perplexity, OpenAI, xAI, plus any coding CLIs you're already paying for), then checks the citations resolve, flags where the backends disagree, and refuses to spend past a budget you set.

```
npx -y dossier-research-mcp
```

**[Margin](https://www.fledgeling.app)** is for teams rather than terminals. It turns internal reference docs into living pages you can comment on by typing or talking, listen to, and edit in place, with an embedded agent who rewrites sections from your feedback and commits the change to git. Members-only and invite-gated at the moment, with a waitlist.

## Licence

MIT. Use it, fork it, ship it.
