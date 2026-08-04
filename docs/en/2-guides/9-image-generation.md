# 9-Image Generation

Snow App ships built-in **image generation & editing** (tool `imagegen-generate`)
with **two channels**: **OpenAI-compatible** (gpt-image / dall-e) and
**Google Gemini** (Nano Banana family). Both channels can be enabled at the
same time and are picked per request. Image generation uses its **own
configuration, independent from the conversation API**, and has **no built-in
default model** — you must configure at least one usable channel in
**Settings → Image generation**.

## 1. Where to Configure

| Entry | Description |
| --- | --- |
| Settings → Image generation (settings page id: `imagegen-settings`) | GUI: two channel cards |
| App database `system_settings` table (code: `imagegen_settings`) | Storage (same source as the UI) |
| `imagegen` scope of the `config` tool | AI agents can read/write the same settings via config tools |

> **Exposed on demand**: when neither channel is configured, `imagegen-generate`
> is hidden from the AI's tool list; configuring any channel makes it visible
> again immediately (no restart needed).

## 2. GUI Configuration (Dual Channels)

Open **Settings → Image generation**: you will see two cards —
**OpenAI-compatible channel** and **Google Gemini channel (Nano Banana)** —
both can be enabled independently:

| Field | Description |
| --- | --- |
| Enabled | Channel switch; a disabled channel is unusable |
| Channel name | Custom display name; leave empty to fall back to the protocol name (OpenAI-compatible / Google Gemini). Click the **✎ pencil button** on the channel list to rename inline (Enter to save / Esc to cancel) |
| API Key | Provider key (OpenAI `sk-...` / Gemini `AIza...`) |
| Base URL | Endpoint; leave empty for the official default (OpenAI `https://api.openai.com/v1`, Gemini `https://generativelanguage.googleapis.com/v1beta`) |
| Model | Image model; **required** — a channel without a model is treated as unconfigured (no built-in default) |
| Default size | **OpenAI**: linked ratio × tier presets (12 ratios × 1K/2K/4K recommended resolutions, or `auto`), or type any resolution directly; **Gemini**: two independent presets — aspect ratio + image size, stored combined as `16:9@2K` |
| Aspect ratio | Gemini: `1:1`, `5:4`, `4:3`, `3:2`, `16:9`, `2:1`, `21:9`, `4:5`, `3:4`, `2:3`, `1:2`, `9:16` (12 ratios) |
| Image size | Gemini: `512px` / `1K` / `2K` / `4K` (**case-sensitive**); the options **adapt to the selected model** (see the model table below) |
| Default quality | `low` / `medium` / `high` / `auto` |
| Output format | OpenAI: `png` / `jpeg` / `webp` |
| Gemini web search | Grounds generation with live Google Search results |
| Default streaming | Shows intermediate previews while generating; overridable via the `stream` tool parameter |

**Model dropdown**: focusing the model input pulls the model list from the
channel's Base URL and filters image models (OpenAI matches `gpt-image`/`dall-e`,
Gemini matches `-image`/`imagen`); you can also type a model manually.
Selecting a model shows its **capability tags**:

| Tag | Meaning |
| --- | --- |
| 4K / 2K / 1K only | Maximum output resolution |
| Streaming | Supports incremental previews during generation |
| Image-to-image | Supports reference-image editing |
| Fidelity | Supports edit fidelity control (`inputFidelity`) |
| Thinking | Supports pre-render reasoning (`thinkingLevel`) |
| Image search | Supports Google Image Search grounding |
| Interleaved | Supports interleaved text & image output |
| Up to 3 images | Max 3 images per request |
| Text-to-image only | No reference-image editing |
| Fast | Speed-first generation |
| Legacy / Deprecated | Old models; Imagen shuts down 2026-08-17 |

## 3. Supported Models

### OpenAI channel

| Model | Notes |
| --- | --- |
| `gpt-image-2` / `gpt-image-1.5` | 4K, streaming, image-to-image |
| `gpt-image-1` | 2K, streaming, image-to-image, fidelity control |
| `gpt-image-1-mini` | Fast, streaming |
| `dall-e-3` | Text-to-image only |

### Gemini channel (Nano Banana family)

| Model | Image sizes | Reference images | Notes |
| --- | --- | --- | --- |
| `gemini-3.1-flash-image` | `512px`, `1K`, `2K`, `4K` | Up to 14 | Nano Banana 2, recommended default: 4K, streaming, image-to-image, thinking, image search |
| `gemini-3.1-flash-lite-image` | `1K` only | — | Nano Banana 2 Lite: fastest/cheapest |
| `gemini-3-pro-image` | `1K`, `2K`, `4K` | Up to 14 | Nano Banana Pro: professional assets, high resolution, interleaved text |
| `gemini-2.5-flash-image` | ~`1K` | Up to 3 | Legacy: low latency, high volume |

> **Image size follows the model**: the “Image size” dropdown of the Gemini
> channel automatically filters the available options based on the selected
> model and shows “Current model supports: …” below it, so you never pick a
> size the model cannot produce.
>
> **Imagen deprecated**: `imagen-*` models are shut down on **2026-08-17** —
> migrate to the Nano Banana family above.

### OpenAI recommended resolutions (gpt-image family)

The settings panel provides **12 ratios × 1K/2K/4K** linked presets, all
provider-recommended values (max side ≤ 3840px, multiples of 16px, long/short
ratio ≤ 3:1):

| Ratio | 1K | 2K | 4K |
| --- | --- | --- | --- |
| `1:1` | 1248×1248 | 2048×2048 | 2880×2880 |
| `5:4` | 1440×1152 | 2240×1792 | 3200×2560 |
| `4:3` | 1472×1104 | 2304×1728 | 3264×2448 |
| `3:2` | 1536×1024 | 2496×1664 | 3504×2336 |
| `16:9` | 1792×1008 | 2560×1440 | 3840×2160 |
| `2:1` | 1792×896 | 2880×1440 | 3840×1920 |
| `21:9` | 1904×816 | 3024×1296 | 3696×1584 |
| `4:5` | 1152×1440 | 1792×2240 | 2560×3200 |
| `3:4` | 1104×1472 | 1728×2304 | 2448×3264 |
| `2:3` | 1024×1536 | 1664×2496 | 2336×3504 |
| `1:2` | 896×1792 | 1440×2880 | 1920×3840 |
| `9:16` | 1008×1792 | 1440×2560 | 2160×3840 |

You can also choose `auto` (decided by the model) or type a custom resolution.

## 4. Using It in Chat

Once configured, just ask in the conversation; the AI calls `imagegen-generate`
automatically:

- **Text-to-image**: describe the picture, e.g. “draw a shiba inu wearing an
  astronaut helmet, cyberpunk city background”;
- **Image-to-image / edit**: **attach a reference image** in the chat, then give
  an edit instruction, e.g. “replace the background with Tokyo at night”,
  “make it photorealistic”;
- **Multiple images**: ask for several variants in one request (max 4);
- **Streaming preview**: with streaming enabled, intermediate previews appear
  in real time while generating;
- **Channel selection**: the AI picks a usable channel per request (OpenAI is
  the default when both are enabled); you can ask explicitly, e.g. “use Gemini”.

### Tool Parameters (`imagegen-generate`)

| Param | Type | Description |
| --- | --- | --- |
| `prompt` | string (required) | Generation description, or the edit instruction with reference images |
| `images` | array | Reference images `[{data, mimeType}]` for image-to-image editing; max 14 images, ≤20MB each |
| `model` | string | Override the configured model |
| `provider` | enum | `auto` (default) / `openai` / `gemini`, backend override |
| `size` | string | OpenAI: a resolution like `1024x1024` or `auto`; Gemini: `1K`/`2K`/`4K` (imageSize) or an aspect ratio like `16:9` (aspectRatio), combinable as `16:9@2K` to set both |
| `quality` | enum | `low` / `medium` / `high` / `auto` |
| `outputFormat` | enum | OpenAI: `png` / `jpeg` / `webp` |
| `outputCompression` | number | OpenAI JPEG/WebP compression 0-100 |
| `n` | number | Images per request (default 1, max 4) |
| `personGeneration` | enum | Gemini: `dont_allow` (default) / `allow_all` / `allow_adult` |
| `webSearch` | boolean | Gemini Google Search grounding |
| `stream` | boolean | Streaming preview (defaults to the setting) |
| `inputFidelity` | enum | OpenAI edits: `low` / `high` / `auto` (not supported by gpt-image-2) |
| `background` | enum | OpenAI: `opaque` (default) / `transparent` / `auto` |
| `moderation` | enum | OpenAI: `auto` (default) / `low` (less filtering) |
| `seed` | number | Deterministic seed for reproducible results |
| `thinkingLevel` | enum | Gemini 3.1 Flash Image: `minimal` (default) / `high` |
| `imageSearch` | boolean | Gemini 3.1 Flash Image: Google Image Search grounding |

> When both channels are enabled, the `provider` parameter wins; otherwise the
> provider is derived from the configuration. OpenAI edits use `/images/edits`
> (multipart), Gemini edits use `inlineData` multimodal prompts; the Gemini
> Nano Banana family uses the Interactions API.

## 5. Managing via the config Tool (AI / CLI)

`imagegen` is a database-backed scope of the `config` tool (same source as the
app database, takes effect immediately):

| Operation | Example |
| --- | --- |
| List channel state | `config-list` + `scope: "imagegen"` → enabled / model / configured per channel |
| Read config | `config-get` + `scope: "imagegen"` + `key: "openai"` (omit `key` for all) |
| Write config | `config-set` + `scope: "imagegen"` + `value: {openai: {...}}` (partial updates merge) |
| Clear config | `config-delete` + `scope: "imagegen"` (hides the generation tool again) |

> **Key safety**: `apiKey` values are always returned masked (e.g.
> `sk-e****7890`) — plaintext secrets are never exposed. Writes merge per
> channel; fields you omit keep their previous values.

## 6. Troubleshooting

| Symptom | Cause & fix |
| --- | --- |
| The AI cannot see the generation tool | Neither channel is configured (`enabled` + `apiKey` + `model` all required); it appears automatically once configured |
| 401/403 errors | Check the channel API key & Base URL; the key may be expired |
| Channel enabled but unusable | Confirm the model is filled in — an empty model means unconfigured |
| Image-to-image not working | Make sure a reference image is attached and the prompt is an edit instruction |
| Slow generation | Disable streaming preview; use `low` quality or a Lite model |
| Imagen model errors | Imagen is deprecated (shut down 2026-08-17); use the Nano Banana family |

## 7. References

- Full tool parameters: the `imagegen` section of
  [3-reference/2-builtin-tools-reference](../3-reference/2-builtin-tools-reference.md)
- Storage locations: [3-reference/4-data-storage-locations](../3-reference/4-data-storage-locations.md)
