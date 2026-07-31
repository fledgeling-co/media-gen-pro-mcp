# Image Gen Pro MCP

**Give your AI assistant real image generation, and get back files you can actually use.**

Ask Claude to build you a landing page and you'll get a lovely layout with `hero-image.png` referenced everywhere and no hero image anywhere. This fixes that. Your assistant describes the picture it needs, this makes it, and it hands back a file path that an `<img src>` can point at.

You need at least one API key. Setup takes about five minutes.

```json
{
  "mcpServers": {
    "image-gen-pro": {
      "command": "npx",
      "args": ["-y", "image-gen-pro-mcp"],
      "env": {
        "OPENAI_API_KEY": "paste-your-key-here",
        "IMAGE_GEN_OUTPUT_DIR": "/absolute/path/to/your/project/public/images"
      }
    }
  }
}
```

## What you get back

Paths, not pictures.

```
Generated 2 image(s) with **Gemini 3 Pro Image** via the direct route.

- `/Users/you/site/public/images/hero-4be44f.jpg` (332 KB)
- `/Users/you/site/public/images/hero-40cab6-2.jpg` (318 KB)

_Used 1 reference image._

_58 image(s) left this hour._
```

That's deliberate, and it's the main design decision in here. A 1024x1024 image is roughly 1.4 MB once it's base64'd into a chat. Three of those is a chunk of the conversation spent on bytes your assistant can't look at anyway. You wanted a file; here's the file.

## The three models

One tool, three vendors, because the right one genuinely differs by job.

| Say this | You get | Needs |
|---|---|---|
| nothing | **GPT Image 2** (OpenAI) | `OPENAI_API_KEY` or the gateway |
| `gemini`, `nanobanana`, `google` | **Gemini 3 Pro Image** | `GEMINI_API_KEY` or the gateway |
| `seedream`, `bytedance` | **Seedream 4.5** | the gateway only |

"nanobanana" is in there because that's what people call Gemini's image model out loud. A server that only accepts the official string makes you look up a name you already know.

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

## Two rough edges, said plainly

**GPT Image 2 needs project access your OpenAI account might not have.** Mine doesn't. The error is clear when it happens (`Project ... does not have access to model gpt-image-2`), but it's the default model, so if you hit it on your first try, that's why. Check your project's model permissions in the OpenAI dashboard, or just use `gemini` instead.

**Gemini returns JPEG, and can't do more than one image per call.** So files come out `.jpg` rather than `.png`, and asking for three images means three requests behind the scenes. You don't have to do anything about either; the server names files by what the bytes actually are, and fans out the requests in parallel. It's just worth knowing why three Gemini images take about as long as one and cost three times as much.

## Getting a key

You need one of these three. Any one is enough to start.

**OpenAI** ([platform.openai.com/api-keys](https://platform.openai.com/api-keys)) gives you GPT Image 2, subject to the access caveat above.

**Google AI Studio** ([aistudio.google.com/apikey](https://aistudio.google.com/apikey)) gives you Gemini 3 Pro Image. Sign in, click **Create API key**, copy it. This is the quickest one to get working.

**Vercel AI Gateway** ([vercel.com/docs/ai-gateway](https://vercel.com/docs/ai-gateway)) gives you all three from one key, and it's the only way to reach Seedream, which has no first-party key here. Handy if you'd rather have one bill than three.

Treat any of them like a password, because that's what they are. Don't paste one into a chat, don't commit one to a repo.

## About money, and a plain warning

**Every image costs you.** Image models are billed per image and they're the expensive kind, meaningfully more than a text call. Prices move, so check each vendor's current pricing rather than trusting a number written here.

**Set a budget before you start.** OpenAI, Google Cloud and Vercel all let you set a spending limit and an alert. It takes two minutes each and it's the difference between a surprise and a number you chose. If you only do one thing from this section, do that one.

This server ships with an hourly cap of 60 images, on by default, because an assistant stuck in a retry loop is exactly the thing that runs up a bill nobody agreed to. There's also a per-call cap of 4, so "generate some options" can't quietly become forty. Both are yours to raise, deliberately rather than by accident.

> **No liability for spend.** This is free software provided as-is under the MIT licence. You are responsible for your own API usage and any charges OpenAI, Google or Vercel bill you, including charges caused by bugs, misconfiguration, runaway agents, or anything else. Neither Luke Rhodes nor Fledgeling is liable for your spending. Set a budget.

## Settings

All optional except having at least one key. Set them alongside the key in the `env` block.

| Setting | Default | What it does |
|---|---|---|
| `OPENAI_API_KEY` | | Your OpenAI key. Reaches GPT Image 2 directly |
| `GEMINI_API_KEY` | | Your AI Studio key. `GOOGLE_API_KEY` works too, since Google's own tools read that one |
| `AI_GATEWAY_API_KEY` | | Vercel AI Gateway. Reaches all three vendors, and is the only route to Seedream |
| `IMAGE_GEN_OUTPUT_DIR` | working directory | Where images are written. Point it at your project's image folder and the paths come back ready to use |
| `IMAGE_GEN_DEFAULT_PROVIDER` | `openai` | Which vendor runs when the assistant names none. Set to `google` if your OpenAI account can't reach GPT Image 2 |
| `IMAGE_GEN_PREFER_GATEWAY` | `false` | Route through the gateway even when a direct key exists. Turn on to put all the billing in one place |
| `IMAGE_GEN_MAX_PER_HOUR` | `60` | Images per rolling hour. `0` removes the cap, knowing what that means for your bill |
| `IMAGE_GEN_MAX_PER_CALL` | `4` | Ceiling on one request, whatever the assistant asks for |
| `IMAGE_GEN_TIMEOUT_MS` | `180000` | How long to wait. Image models are slow; three minutes is not generous |

The same model has different names on different routes, which the server handles for you: Google's own API calls it `gemini-3-pro-image-preview`, the gateway calls it `google/gemini-3-pro-image`. Worth knowing only if you're reading the code and wondering why there are two.

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
