//! Built-in MCP service: AI image generation with multi-provider support.
//!
//! Tool:
//! - `imagegen-generate` — generate image(s) from a text prompt.
//!   - OpenAI-compatible endpoints (gpt-image / dall-e / ...):
//!     `POST {baseUrl}/images/generations`
//!   - Google Gemini (Imagen models):
//!     `POST {baseUrl}/models/{model}:generateContent`
//!
//! Configuration model: image generation uses its OWN independent settings
//! (stored in the `system_settings` table under the `imagegen_settings` code,
//! edited from Settings -> Image generation in the UI). It is intentionally
//! decoupled from the conversation/agent API profiles: there is NO hard-coded
//! default model. Precedence per field:
//!   1. explicit tool argument (model / provider / size / quality / ...)
//!   2. front-end settings (model / provider / baseUrl / apiKey / defaults)
//!   3. a clear error telling the agent to configure the settings or pass the
//!      missing argument.

use std::time::Duration;

use futures::StreamExt;
use napi::bindgen_prelude::*;
use napi::threadsafe_function::ThreadsafeFunctionCallMode;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use super::super::service::McpService;
use super::super::servers::bash::{BashStreamCallback, BashStreamChunk};
use super::super::tools::McpTool;

const SERVER_ID: &str = "imagegen";
const TOOL_GENERATE: &str = "generate";
/// Image models may take up to ~2 minutes for complex prompts.
const REQUEST_TIMEOUT_SECS: u64 = 180;
const DEFAULT_N: usize = 1;
const MAX_N: usize = 4;

/// system_settings 表中的设置 code（与设置面板共用）。
const IMAGE_GEN_SETTING_CODE: &str = "imagegen_settings";

const DEFAULT_OPENAI_BASE_URL: &str = "https://api.openai.com/v1";
const DEFAULT_GEMINI_BASE_URL: &str = "https://generativelanguage.googleapis.com/v1beta";

/// 前端「图像生成」设置（Settings -> Image generation）。支持任意多个独立
/// 渠道（每个渠道可配置自己的协议类型、Base URL、密钥、模型与默认参数）
/// 同时配置、同时启用，agent 可任选其一调用；所有渠道都未配置时工具不暴露
/// 给模型。渠道在数组中的顺序即优先级：未指定渠道时默认使用第一个可用渠道。
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
struct ImageGenSettings {
    /// 渠道列表（顺序即优先级）。
    channels: Vec<ImageGenChannel>,
}

impl ImageGenSettings {
    /// 是否有至少一个已启用且凭据齐全的渠道。
    fn has_enabled_channel(&self) -> bool {
        self.channels.iter().any(ImageGenChannel::is_usable)
    }
}

/// 单个生图渠道的配置（与对话 API 完全独立；无内置默认模型）。
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
#[serde(default, rename_all = "camelCase")]
struct ImageGenChannel {
    /// 渠道唯一 ID（前端生成；旧数据迁移时使用协议名），供 provider 参数引用。
    id: String,
    /// 用户自定义显示名（留空时回退到协议名）。
    name: String,
    /// 协议类型："openai"（OpenAI 兼容 Images API）/ "gemini"（Gemini Imagen）。
    provider: String,
    /// 渠道启用开关（未启用时该渠道不可用）
    enabled: bool,
    /// 留空 = 使用官方默认端点
    base_url: String,
    api_key: String,
    /// 绘图模型名；留空时该渠道不可用（代码中不内置默认模型）
    model: String,
    default_size: String,
    default_quality: String,
    output_format: String,
    /// Gemini 联网搜索（Grounding with Google Search），仅 Gemini 生效
    web_search: bool,
    /// 默认流式预览（partial image 实时推送到会话页），工具参数 stream 可覆盖
    default_stream: bool,
}

impl ImageGenChannel {
    fn is_usable(&self) -> bool {
        self.enabled && !self.api_key.trim().is_empty() && !self.model.trim().is_empty()
    }

    /// 渠道的显示名（name 留空时回退到协议名）。
    fn display_name(&self) -> String {
        let trimmed = self.name.trim();
        if trimmed.is_empty() {
            if self.provider == "gemini" {
                "gemini".to_string()
            } else {
                "openai".to_string()
            }
        } else {
            trimmed.to_string()
        }
    }
}

pub struct ImageGenService;

impl ImageGenService {
    pub fn new() -> Self {
        ImageGenService
    }

    pub async fn execute_generate(
        &self,
        args: &Value,
        on_chunk: &BashStreamCallback,
    ) -> napi::Result<Value> {
        let prompt = required_string(args, "prompt", TOOL_GENERATE)?;
        let n = bounded_usize(args.get("n").and_then(Value::as_u64), DEFAULT_N, 1, MAX_N);

        // --- 1. Load the independent front-end settings (blocking SQLite I/O) ---
        let settings = tokio::task::spawn_blocking(load_imagegen_settings)
            .await
            .map_err(|error| {
                Error::from_reason(format!("Failed to load image generation settings: {error}"))
            })??;

        // --- 2. Resolve channel (provider): argument > first usable channel ---
        let channel = resolve_channel(args, &settings)?;
        let provider = channel.0;
        let channel_config = channel.1;
        let channel_label = channel_config.display_name();

        // --- 3. Resolve credentials / endpoint from the channel ---
        let base_url = channel_base_url(channel_config);
        let api_key = channel_config.api_key.trim();

        // --- 4. Resolve the model: argument > channel model; NO hard-coded default ---
        let model = args
            .get("model")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| non_empty(&channel_config.model))
            .ok_or_else(|| {
                Error::from_reason(
                    "No image model configured for the selected channel. Configure the model in Settings -> Image generation, or pass the `model` argument explicitly.",
                )
            })?;

        // --- 5. Resolve default size / quality / outputFormat from the channel ---
        let size = args
            .get("size")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| non_empty(&channel_config.default_size));
        let quality = args
            .get("quality")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| non_empty(&channel_config.default_quality));
        let output_format = args
            .get("outputFormat")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
            .or_else(|| non_empty(&channel_config.output_format));

        // --- 6. Streaming mode: argument > channel default ---
        let stream_enabled = args
            .get("stream")
            .and_then(Value::as_bool)
            .unwrap_or(channel_config.default_stream);

        // --- 7. Image-to-image: reference images from the conversation ---
        // images: [{ "data": "<base64>", "mimeType": "image/png" }]
        let images = parse_reference_images(args)?;
        // 图生图（edits / inlineData 参考图）暂不支持流式预览
        let stream_enabled = stream_enabled && images.is_empty();

        let seed = args.get("seed").and_then(Value::as_u64);
        let input_fidelity = args
            .get("inputFidelity")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let background = args
            .get("background")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let moderation = args
            .get("moderation")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let thinking_level = args
            .get("thinkingLevel")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string);
        let image_search = args
            .get("imageSearch")
            .and_then(Value::as_bool)
            .unwrap_or(false);

        match provider {
            "gemini" => {
                self.generate_gemini(
                    args, channel_config, prompt, &model, &size, &quality, &base_url,
                    api_key, n, stream_enabled, on_chunk, &images, seed,
                    thinking_level.as_deref(), image_search, &channel_label,
                )
                .await
            }
            _ => {
                self.generate_openai(
                    args, prompt, &model, &size, &quality, &output_format,
                    &base_url, api_key, n, stream_enabled, on_chunk, &images,
                    seed, input_fidelity.as_deref(), background.as_deref(),
                    moderation.as_deref(), &channel_label,
                )
                .await
            }
        }
    }

    /// OpenAI Images API branch:
    /// - text-to-image:   POST {base}/images/generations (JSON, optional SSE stream)
    /// - image-to-image:  POST {base}/images/edits (multipart form, reference images)
    async fn generate_openai(
        &self,
        args: &Value,
        prompt: &str,
        model: &str,
        size: &Option<String>,
        quality: &Option<String>,
        output_format: &Option<String>,
        base_url: &str,
        api_key: &str,
        n: usize,
        stream_enabled: bool,
        on_chunk: &BashStreamCallback,
        images: &[ReferenceImage],
        seed: Option<u64>,
        input_fidelity: Option<&str>,
        background: Option<&str>,
        moderation: Option<&str>,
        channel_label: &str,
    ) -> napi::Result<Value> {
        let mime_type = mime_for_format(output_format.as_deref().unwrap_or("png"));
        let is_dall_e = model.to_ascii_lowercase().starts_with("dall-e");
        let is_gpt_image_2 = model.to_ascii_lowercase().contains("gpt-image-2");

        // --- Image-to-image: POST /images/edits (multipart) ---
        if !images.is_empty() {
            let endpoint = format!("{base_url}/images/edits");
            let mut form = reqwest::multipart::Form::new()
                .text("model", model.to_string())
                .text("prompt", prompt.to_string())
                .text("n", n.to_string());
            for (index, image) in images.iter().enumerate() {
                let bytes = decode_base64(&image.data)?;
                let file_name = format!("image-{}.{}", index + 1, ext_for_mime(&image.mime_type));
                let part = reqwest::multipart::Part::bytes(bytes)
                    .file_name(file_name)
                    .mime_str(&image.mime_type)
                    .map_err(|error| {
                        generic_error(format!("Failed to build multipart part: {error}"))
                    })?;
                form = form.part("image[]", part);
            }
            if let Some(value) = size {
                form = form.text("size", value.clone());
            }
            if let Some(value) = quality {
                form = form.text("quality", value.clone());
            }
            if let Some(value) = output_format {
                form = form.text("output_format", value.clone());
            }
            if let Some(value) = args.get("outputCompression").and_then(Value::as_u64) {
                form = form.text("output_compression", value.clamp(0, 100).to_string());
            }
            if let Some(value) = input_fidelity {
                // gpt-image-2 不允许设置 input_fidelity（自动高保真）
                if !is_gpt_image_2 && matches!(value, "low" | "high" | "auto") {
                    form = form.text("input_fidelity", value.to_string());
                }
            }
            if let Some(value) = background {
                if matches!(value, "opaque" | "transparent" | "auto") {
                    form = form.text("background", value.to_string());
                }
            }
            if let Some(value) = moderation {
                if matches!(value, "auto" | "low") {
                    form = form.text("moderation", value.to_string());
                }
            }

            let client = build_client().await?;
            let response = client
                .post(&endpoint)
                .bearer_auth(api_key)
                .multipart(form)
                .send()
                .await
                .map_err(|error| {
                    generic_error(format!("Image edit request failed: {error}"))
                })?;
            let status = response.status();
            if !status.is_success() {
                let response_body: Value = response
                    .json()
                    .await
                    .unwrap_or_else(|_| json!({}));
                return Err(api_error(
                    "Image edit failed",
                    status.as_u16(),
                    &response_body,
                ));
            }

            let response_body: Value = response
                .json()
                .await
                .map_err(|error| {
                    generic_error(format!(
                        "Failed to parse image edit response: {error}"
                    ))
                })?;
            let Some(data) = response_body.get("data").and_then(Value::as_array) else {
                return Err(generic_error(
                    "Image edit response is missing the data array".to_string(),
                ));
            };
            return collect_openai_result(
                prompt,
                model,
                channel_label,
                data.iter().cloned().collect(),
                mime_type,
            );
        }

        // --- Text-to-image: POST /images/generations (JSON) ---
        let endpoint = format!("{base_url}/images/generations");

        // size / quality / outputFormat are only sent when explicitly provided
        // so that OpenAI-compatible third-party endpoints (which may reject
        // unknown fields) keep working with a plain {model, prompt, n} body.
        let mut body = json!({
            "model": model,
            "prompt": prompt,
            "n": n,
        });
        if let Some(value) = size {
            body["size"] = json!(value);
        }
        if let Some(value) = quality {
            body["quality"] = json!(value);
        }
        if let Some(value) = output_format {
            body["output_format"] = json!(value);
        }
        if let Some(value) = args.get("outputCompression").and_then(Value::as_u64) {
            // jpeg/webp 专属压缩率 0-100（gpt-image 系列）
            body["output_compression"] = json!(value.clamp(0, 100));
        }
        if let Some(value) = seed {
            body["seed"] = json!(value);
        }
        if let Some(value) = background {
            if matches!(value, "opaque" | "transparent" | "auto") {
                body["background"] = json!(value);
            }
        }
        if let Some(value) = moderation {
            if matches!(value, "auto" | "low") {
                body["moderation"] = json!(value);
            }
        }
        if stream_enabled && !is_dall_e {
            // gpt-image 系列流式：生成过程中推送 0-3 张中间预览
            body["stream"] = json!(true);
            body["partial_images"] = json!(2);
        }
        if is_dall_e {
            // dall-e-3 uses `response_format` (b64_json) and does not accept
            // `output_format` / `stream` / `background`; its `quality` values
            // (standard/hd) differ from gpt-image (low/medium/high), so drop
            // them to avoid a 400.
            body["response_format"] = json!("b64_json");
            if let Some(map) = body.as_object_mut() {
                map.remove("output_format");
                map.remove("output_compression");
                map.remove("quality");
                map.remove("stream");
                map.remove("partial_images");
                map.remove("background");
                map.remove("moderation");
            }
        }

        let client = build_client().await?;
        let response = client
            .post(&endpoint)
            .bearer_auth(api_key)
            .json(&body)
            .send()
            .await
            .map_err(|error| {
                generic_error(format!("Image generation request failed: {error}"))
            })?;
        let status = response.status();
        if !status.is_success() {
            let response_body: Value = response
                .json()
                .await
                .unwrap_or_else(|_| json!({}));
            return Err(api_error(
                "Image generation failed",
                status.as_u16(),
                &response_body,
            ));
        }

        // --- Streaming path: consume the SSE stream and forward partials ---
        if stream_enabled && !is_dall_e {
            let mut partials: Vec<(usize, String)> = Vec::new();
            let mut completed: Vec<Value> = Vec::new();
            read_openai_sse(response, &mut partials, &mut completed, on_chunk, &mime_type)
                .await?;

            let final_images = if !completed.is_empty() {
                completed
            } else if !partials.is_empty() {
                partials
                    .into_iter()
                    .max_by_key(|(index, _)| *index)
                    .into_iter()
                    .map(|(_, data)| json!({ "b64_json": data }))
                    .collect()
            } else {
                return Err(generic_error(
                    "Image generation stream ended without any image data".to_string(),
                ));
            };
            return collect_openai_result(
                prompt,
                model,
                channel_label,
                final_images,
                mime_type,
            );
        }

        // --- Non-streaming path ---
        let response_body: Value = response
            .json()
            .await
            .map_err(|error| {
                generic_error(format!(
                    "Failed to parse image generation response: {error}"
                ))
            })?;

        let Some(data) = response_body.get("data").and_then(Value::as_array) else {
            return Err(generic_error(
                "Image generation response is missing the data array".to_string(),
            ));
        };

        collect_openai_result(
            prompt,
            model,
            channel_label,
            data.iter().cloned().collect(),
            mime_type,
        )
    }

    /// Google Gemini branch.
    /// - Nano Banana 2 / Pro / Lite (`gemini-3.1-flash-image`,
    ///   `gemini-3-pro-image`, `gemini-3.1-flash-lite-image`) use the
    ///   official **Interactions API** (`POST /v1beta/interactions`, model in
    ///   body, `response_format` for image config).
    /// - Older models (`gemini-2.5-flash-image`, Imagen) keep using
    ///   `POST /v1beta/models/{model}:generateContent`.
    async fn generate_gemini(
        &self,
        args: &Value,
        channel: &ImageGenChannel,
        prompt: &str,
        model: &str,
        size: &Option<String>,
        quality: &Option<String>,
        base_url: &str,
        api_key: &str,
        n: usize,
        stream_enabled: bool,
        on_chunk: &BashStreamCallback,
        images: &[ReferenceImage],
        seed: Option<u64>,
        thinking_level: Option<&str>,
        image_search: bool,
        channel_label: &str,
    ) -> napi::Result<Value> {
        let is_nano_banana_2 = matches!(
            model,
            "gemini-3.1-flash-image"
                | "gemini-3-pro-image"
                | "gemini-3.1-flash-lite-image"
        );

        // --- Shared: reference images as inlineData / image parts ---
        let mut input_parts: Vec<Value> = Vec::new();
        for image in images {
            input_parts.push(json!({
                "type": "image",
                "mime_type": image.mime_type,
                "data": image.data,
            }));
        }
        input_parts.push(json!({ "type": "text", "text": prompt }));

        // --- Shared: web search grounding (tools) ---
        let web_search = args
            .get("webSearch")
            .and_then(Value::as_bool)
            .unwrap_or(channel.web_search);
        let mut tools: Vec<Value> = Vec::new();
        if web_search || image_search {
            let mut search_tool = json!({ "type": "google_search" });
            if image_search {
                // 图片搜索（3.1 Flash Image 专属）：web + image 双通道
                search_tool["search_types"] =
                    json!(["web_search", "image_search"]);
            }
            tools.push(search_tool);
        }

        // --- Nano Banana 2+: Interactions API ---
        if is_nano_banana_2 {
            let endpoint = format!("{base_url}/interactions");

            let mut response_format = json!({
                "type": "image",
            });
            if let Some(size) = size {
                let trimmed = size.trim();
                // 组合格式 "16:9@2K"：同时设置 aspect_ratio + image_size
                if let Some((ratio_part, size_part)) = trimmed.split_once('@') {
                    let ratio = ratio_part.trim();
                    let image_size = size_part.trim();
                    if matches!(image_size, "1K" | "2K" | "4K" | "0.5K" | "512") {
                        response_format["image_size"] = json!(image_size);
                    }
                    if ratio.contains(':')
                        && ratio.split(':').count() == 2
                        && ratio.split(':').all(|part| part.parse::<u32>().is_ok())
                    {
                        response_format["aspect_ratio"] = json!(ratio);
                    }
                } else if matches!(trimmed, "1K" | "2K" | "4K" | "0.5K" | "512") {
                    response_format["image_size"] = json!(trimmed);
                } else if trimmed.contains(':')
                    && trimmed.split(':').count() == 2
                    && trimmed
                        .split(':')
                        .all(|part| part.parse::<u32>().is_ok())
                {
                    response_format["aspect_ratio"] = json!(trimmed);
                }
            }
            if let Some(quality) = quality {
                if matches!(quality.as_str(), "low" | "medium" | "high") {
                    response_format["image_quality"] = json!(quality);
                }
            }

            let mut generation_config = json!({});
            if let Some(level) = thinking_level {
                if matches!(level, "minimal" | "high") {
                    generation_config["thinking_level"] = json!(level);
                }
            }
            if let Some(seed) = seed {
                generation_config["seed"] = json!(seed);
            }
            if let Some(person_generation) = args
                .get("personGeneration")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
            {
                if matches!(person_generation, "dont_allow" | "allow_all" | "allow_adult") {
                    generation_config["personGeneration"] = json!(person_generation);
                }
            }

            let mut body = json!({
                "model": model,
                "input": input_parts,
                "response_format": response_format,
            });
            if !tools.is_empty() {
                body["tools"] = json!(tools);
            }
            if generation_config.as_object().is_some_and(|m| !m.is_empty()) {
                body["generation_config"] = generation_config;
            }

            let client = build_client().await?;
            let response = client
                .post(&endpoint)
                .header("x-goog-api-key", api_key)
                .json(&body)
                .send()
                .await
                .map_err(|error| {
                    generic_error(format!("Image generation request failed: {error}"))
                })?;
            let status = response.status();
            if !status.is_success() {
                let response_body: Value = response
                    .json()
                    .await
                    .unwrap_or_else(|_| json!({}));
                return Err(api_error(
                    "Image generation failed",
                    status.as_u16(),
                    &response_body,
                ));
            }

            let response_body: Value = response
                .json()
                .await
                .map_err(|error| {
                    generic_error(format!(
                        "Failed to parse image generation response: {error}"
                    ))
                })?;

            // Parse steps[].content blocks where type == "image"
            // (only model_output steps; thought steps are hidden drafts).
            let images = parse_interactions_images(&response_body);
            return collect_gemini_result(prompt, model, channel_label, images);
        }

        // --- Legacy: generateContent API ---
        let endpoint = if stream_enabled {
            format!("{base_url}/models/{model}:streamGenerateContent")
        } else {
            format!("{base_url}/models/{model}:generateContent")
        };

        let mut generation_config = json!({ "responseModalities": ["IMAGE"] });
        // size: "1K"/"2K"/"4K" -> imageSize; "N:N" (e.g. "16:9") -> aspectRatio;
        // "16:9@2K" -> 两者同时设置。
        if let Some(size) = size {
            let trimmed = size.trim();
            if let Some((ratio_part, size_part)) = trimmed.split_once('@') {
                let ratio = ratio_part.trim();
                let image_size = size_part.trim();
                if matches!(image_size, "1K" | "2K" | "4K") {
                    generation_config["imageSize"] = json!(image_size);
                }
                if ratio.contains(':')
                    && ratio.split(':').count() == 2
                    && ratio.split(':').all(|part| part.parse::<u32>().is_ok())
                {
                    generation_config["aspectRatio"] = json!(ratio);
                }
            } else if matches!(trimmed, "1K" | "2K" | "4K") {
                generation_config["imageSize"] = json!(trimmed);
            } else if trimmed.contains(':')
                && trimmed.split(':').count() == 2
                && trimmed.split(':').all(|part| part.parse::<u32>().is_ok())
            {
                generation_config["aspectRatio"] = json!(trimmed);
            }
        }
        if let Some(quality) = quality {
            if matches!(quality.as_str(), "low" | "medium" | "high") {
                generation_config["imageQuality"] = json!(quality);
            }
        }
        if n > 1 {
            // imagen-4 系列支持一次多张（1-4）
            generation_config["numberOfImages"] = json!(n.min(4));
        }
        if let Some(seed) = seed {
            generation_config["seed"] = json!(seed);
        }
        if let Some(person_generation) = args
            .get("personGeneration")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            if matches!(person_generation, "dont_allow" | "allow_all" | "allow_adult") {
                generation_config["personGeneration"] = json!(person_generation);
            }
        }

        // contents.parts: 参考图（图生图）在前，文本指令在后
        let mut parts: Vec<Value> = Vec::new();
        for image in images {
            parts.push(json!({
                "inlineData": {
                    "mimeType": image.mime_type,
                    "data": image.data,
                }
            }));
        }
        parts.push(json!({ "text": prompt }));

        let mut body = json!({
            "contents": [ { "parts": parts } ],
            "generationConfig": generation_config,
        });
        if !tools.is_empty() {
            body["tools"] = json!(tools);
        }

        let client = build_client().await?;
        let response = client
            .post(&endpoint)
            .header("x-goog-api-key", api_key)
            .json(&body)
            .send()
            .await
            .map_err(|error| {
                generic_error(format!("Image generation request failed: {error}"))
            })?;
        let status = response.status();
        if !status.is_success() {
            let response_body: Value = response
                .json()
                .await
                .unwrap_or_else(|_| json!({}));
            return Err(api_error(
                "Image generation failed",
                status.as_u16(),
                &response_body,
            ));
        }

        // --- Streaming path: parse the SSE/JSON stream, forward inlineData ---
        if stream_enabled {
            let images = read_gemini_stream(response, on_chunk).await?;
            return collect_gemini_result(prompt, model, channel_label, images);
        }

        // --- Non-streaming path ---
        let response_body: Value = response
            .json()
            .await
            .map_err(|error| {
                generic_error(format!(
                    "Failed to parse image generation response: {error}"
                ))
            })?;

        let images = parse_gemini_candidates(&response_body);
        collect_gemini_result(prompt, model, channel_label, images)
    }
}

impl McpService for ImageGenService {
    fn id(&self) -> &str {
        SERVER_ID
    }

    fn tools(&self) -> Vec<McpTool> {
        vec![McpTool {
            server_id: SERVER_ID.to_string(),
            name: TOOL_GENERATE.to_string(),
            description: "Generate or edit image(s) using the INDEPENDENT image-generation configuration from Settings -> Image generation (separate from the conversation API; no built-in default model). TEXT-TO-IMAGE: pass only `prompt`. IMAGE-TO-IMAGE (edit / reference / restyle): pass `images` (base64 data extracted from the user's attached images, e.g. the @@image:...@@ tags in the conversation) plus an edit `prompt`; OpenAI uses POST /v1/images/edits, Gemini embeds inlineData parts. Supported backends: OpenAI-compatible (gpt-image / dall-e) and Google Gemini Imagen (optional Google Search grounding). Provider auto-detected from the configured base URL unless overridden. USE THIS when the user asks to create, draw, generate, render, edit, restyle, or vary an image. RENDERING TIP: after the tool returns, briefly mention the image(s) in your reply."
                .to_string(),
            input_schema: json!({
                "type": "object",
                "properties": {
                    "prompt": {
                        "type": "string",
                        "description": "Description of the image to generate, or the edit instruction when reference images are provided (e.g. \"make it photorealistic\", \"put it in a cyberpunk city\"). The more specific (subject, style, lighting, composition, colors), the better the result."
                    },
                    "images": {
                        "type": "array",
                        "description": "Reference images for image-to-image editing: [{ \"data\": \"<base64>\", \"mimeType\": \"image/png\" }]. Extract base64 from the user's attached images in the conversation (the @@image:data:...@@ tags / multimodal image blocks). Max 5 images, ~20MB each. When provided: OpenAI -> /images/edits endpoint; Gemini -> inlineData parts (prompt-based editing).",
                        "items": {
                            "type": "object",
                            "properties": {
                                "data": { "type": "string", "description": "Base64-encoded image data (without the data: prefix)" },
                                "mimeType": { "type": "string", "description": "Image MIME type, e.g. image/png, image/jpeg, image/webp" }
                            },
                            "required": ["data", "mimeType"]
                        }
                    },
                    "model": {
                        "type": "string",
                        "description": "Image model to override the one configured in Settings -> Image generation. OpenAI: gpt-image-1, gpt-image-2, dall-e-3. Gemini (recommended Nano Banana family): gemini-3.1-flash-image (Nano Banana 2, default pick), gemini-3.1-flash-lite-image (Nano Banana 2 Lite, fastest/cheapest, 1K only), gemini-3-pro-image (Nano Banana Pro, up to 14 reference images + 4K + interleaved text), gemini-2.5-flash-image (legacy). NOTE: Imagen models are deprecated and shut down 2026-08-17. Omit to use the configured model."
                    },
                    "provider": {
                        "type": "string",
                        "description": "Image channel override: a channel ID or channel name configured in Settings -> Image generation (config-list scope=imagegen lists them), or a protocol type \"openai\" (OpenAI-compatible Images API) / \"gemini\" (Google Gemini Imagen) to pick the first usable channel of that type. Omit or \"auto\" to use the first usable channel.",
                        "default": "auto"
                    },
                    "size": {
                        "type": "string",
                        "description": "Output size. OpenAI: e.g. \"1024x1024\", \"1024x1536\", \"1536x1024\" (omit to use the configured default). Gemini: \"1K\", \"2K\", \"4K\" (imageSize) or an aspect ratio like \"16:9\", \"1:1\", \"9:16\" (aspectRatio)."
                    },
                    "quality": {
                        "type": "string",
                        "description": "Rendering quality: \"low\", \"medium\", \"high\" or \"auto\". OpenAI: gpt-image models only, ignored for dall-e. Gemini: low/medium/high (imageQuality).",
                        "enum": ["low", "medium", "high", "auto"]
                    },
                    "outputFormat": {
                        "type": "string",
                        "description": "Output format for OpenAI: \"png\", \"jpeg\" or \"webp\" (default png). Ignored for dall-e and Gemini.",
                        "enum": ["png", "jpeg", "webp"]
                    },
                    "outputCompression": {
                        "type": "number",
                        "description": "OpenAI only: JPEG/WebP compression level 0-100 (e.g. 50 = 50%). Ignored for PNG and Gemini.",
                        "minimum": 0,
                        "maximum": 100
                    },
                    "n": {
                        "type": "number",
                        "description": "Number of images to generate in one request (default: 1, max: 4). OpenAI and Gemini (imagen-4) both support it.",
                        "default": 1,
                        "minimum": 1,
                        "maximum": 4
                    },
                    "personGeneration": {
                        "type": "string",
                        "description": "Gemini only: person generation policy — \"dont_allow\" (default), \"allow_all\", or \"allow_adult\".",
                        "enum": ["dont_allow", "allow_all", "allow_adult"]
                    },
                    "webSearch": {
                        "type": "boolean",
                        "description": "Gemini only: enable Google Search grounding so the model can incorporate real-time web information into the generated image. Defaults to the setting configured in Settings -> Image generation. Ignored for OpenAI."
                    },
                    "stream": {
                        "type": "boolean",
                        "description": "Stream intermediate preview images to the conversation while generating (OpenAI gpt-image partial images / Gemini streamGenerateContent). Defaults to the setting configured in Settings -> Image generation. Ignored for dall-e models and image edits.",
                        "default": false
                    },
                    "inputFidelity": {
                        "type": "string",
                        "description": "OpenAI image edits only: how strongly the model preserves details from the reference images — \"low\", \"high\", or \"auto\" (default). Not allowed for gpt-image-2 (always high fidelity).",
                        "enum": ["low", "high", "auto"]
                    },
                    "background": {
                        "type": "string",
                        "description": "OpenAI only: output background — \"opaque\" (default), \"transparent\", or \"auto\". Transparent requires model support (gpt-image-2 does not support it). Ignored for Gemini.",
                        "enum": ["opaque", "transparent", "auto"]
                    },
                    "moderation": {
                        "type": "string",
                        "description": "OpenAI only: moderation strictness — \"auto\" (default) or \"low\" (less restrictive filtering). Ignored for Gemini.",
                        "enum": ["auto", "low"]
                    },
                    "seed": {
                        "type": "number",
                        "description": "Deterministic seed for reproducible results (OpenAI and Gemini both support it)."
                    },
                    "thinkingLevel": {
                        "type": "string",
                        "description": "Gemini 3.1 Flash Image only: reasoning effort before rendering — \"minimal\" (default, faster) or \"high\" (better quality, slower). Other models ignore it.",
                        "enum": ["minimal", "high"]
                    },
                    "imageSearch": {
                        "type": "boolean",
                        "description": "Gemini 3.1 Flash Image only: enable Google Image Search grounding so the model can use real web images as visual context (search_types: [\"web_search\", \"image_search\"]). Requires displaying search suggestions. Other models ignore it."
                    }
                },
                "required": ["prompt"]
            }),
        }]
    }

    fn execute(&self, tool_name: &str, _args: &Value) -> napi::Result<Value> {
        match tool_name {
            TOOL_GENERATE => Err(generic_error(
                "The ImageGen tool must be executed through the asynchronous executor"
                    .to_string(),
            )),
            _ => Err(generic_error(format!(
                "Unknown tool: \"{tool_name}\" for MCP server \"{SERVER_ID}\". Available tools: [imagegen-generate]"
            ))),
        }
    }
}

/// 前端传入的参考图（图生图）。
struct ReferenceImage {
    data: String,
    mime_type: String,
}

/// 解析 `images` 参数：`[{ "data": "<base64>", "mimeType": "image/png" }]`。
/// 最多 14 张（Gemini 3 Pro Image 官方上限），单张 base64 上限约 20MB。
fn parse_reference_images(args: &Value) -> napi::Result<Vec<ReferenceImage>> {
    const MAX_IMAGES: usize = 14;
    const MAX_BASE64_LEN: usize = 20 * 1024 * 1024; // 20MB base64

    let Some(items) = args.get("images").and_then(Value::as_array) else {
        return Ok(Vec::new());
    };
    if items.is_empty() {
        return Ok(Vec::new());
    }
    if items.len() > MAX_IMAGES {
        return Err(Error::new(
            Status::InvalidArg,
            format!("Too many reference images: {} (max {MAX_IMAGES})", items.len()),
        ));
    }

    let mut images = Vec::with_capacity(items.len());
    for item in items {
        let Some(data) = item.get("data").and_then(Value::as_str) else {
            return Err(Error::new(
                Status::InvalidArg,
                "Each reference image must have a base64 `data` string".to_string(),
            ));
        };
        let data = data.trim().to_string();
        if data.is_empty() {
            return Err(Error::new(
                Status::InvalidArg,
                "Reference image `data` must not be empty".to_string(),
            ));
        }
        if data.len() > MAX_BASE64_LEN {
            return Err(Error::new(
                Status::InvalidArg,
                format!("Reference image is too large (max ~{}MB)", MAX_BASE64_LEN / 1024 / 1024),
            ));
        }
        let mime_type = item
            .get("mimeType")
            .and_then(Value::as_str)
            .filter(|value| value.starts_with("image/"))
            .unwrap_or("image/png")
            .to_string();
        images.push(ReferenceImage { data, mime_type });
    }
    Ok(images)
}

fn decode_base64(data: &str) -> napi::Result<Vec<u8>> {
    use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine};
    BASE64_STANDARD
        .decode(data)
        .map_err(|error| Error::new(Status::InvalidArg, format!("Invalid base64 image data: {error}")))
}

fn ext_for_mime(mime_type: &str) -> String {
    match mime_type {
        "image/jpeg" | "image/jpg" => "jpg".to_string(),
        "image/webp" => "webp".to_string(),
        "image/gif" => "gif".to_string(),
        _ => "png".to_string(),
    }
}

/// 通过 on_chunk 向渲染进程推送一张流式预览图。
fn emit_partial(on_chunk: &BashStreamCallback, index: usize, mime_type: &str, b64: &str) {
    let payload = json!({
        "type": "partial_image",
        "index": index,
        "mimeType": mime_type,
        "data": b64,
    })
    .to_string();
    on_chunk.call(
        BashStreamChunk {
            stream: "imagegen".to_string(),
            data: payload,
        },
        ThreadsafeFunctionCallMode::NonBlocking,
    );
}

/// 逐行消费 SSE 响应体。OpenAI Images API 流式事件：
/// - `image_generation.partial_image`: { b64_json, partial_image_index }
/// - `image_generation.completed`: { data: [{b64_json|url}] }（部分实现）
async fn read_openai_sse(
    response: reqwest::Response,
    partials: &mut Vec<(usize, String)>,
    completed: &mut Vec<Value>,
    on_chunk: &BashStreamCallback,
    mime_type: &str,
) -> napi::Result<()> {
    let mut stream = response.bytes_stream();
    let mut buffer: Vec<u8> = Vec::new();
    let mut line_count = 0usize;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk
            .map_err(|error| generic_error(format!("Stream read failed: {error}")))?;
        buffer.extend_from_slice(&chunk);

        loop {
            let Some(position) = buffer.iter().position(|&byte| byte == b'\n') else {
                break;
            };
            let line: Vec<u8> = buffer.drain(..=position).collect();
            let line_str = String::from_utf8_lossy(&line);
            line_count += 1;
            process_openai_sse_line(&line_str, partials, completed, on_chunk, mime_type);
        }
    }
    // 处理末尾无换行的残留数据
    if !buffer.is_empty() {
        let line_str = String::from_utf8_lossy(&buffer);
        line_count += 1;
        process_openai_sse_line(&line_str, partials, completed, on_chunk, mime_type);
    }
    let _ = line_count;
    Ok(())
}

fn process_openai_sse_line(
    line: &str,
    partials: &mut Vec<(usize, String)>,
    completed: &mut Vec<Value>,
    on_chunk: &BashStreamCallback,
    mime_type: &str,
) {
    let trimmed = line.trim();
    if !trimmed.starts_with("data:") {
        return;
    }
    let data = trimmed[5..].trim();
    if data.is_empty() || data == "[DONE]" {
        return;
    }
    let Ok(event) = serde_json::from_str::<Value>(data) else {
        return;
    };
    match event.get("type").and_then(Value::as_str) {
        Some("image_generation.partial_image") => {
            let Some(b64) = event.get("b64_json").and_then(Value::as_str) else {
                return;
            };
            if b64.trim().is_empty() {
                return;
            }
            let index = event
                .get("partial_image_index")
                .and_then(Value::as_u64)
                .unwrap_or(0) as usize;
            partials.push((index, b64.to_string()));
            emit_partial(on_chunk, index, mime_type, b64);
        }
        Some("image_generation.completed") => {
            if let Some(items) = event.get("data").and_then(Value::as_array) {
                completed.extend(items.iter().cloned());
            }
        }
        _ => {}
    }
}

/// 将 OpenAI data 数组（b64_json / url）汇总为统一结果。
fn collect_openai_result(
    prompt: &str,
    model: &str,
    channel_label: &str,
    items: Vec<Value>,
    mime_type: String,
) -> napi::Result<Value> {
    let mut content = Vec::new();
    let mut remote_urls = Vec::new();
    let mut generated = 0usize;
    for item in items {
        if let Some(b64) = item.get("b64_json").and_then(Value::as_str) {
            if b64.trim().is_empty() {
                continue;
            }
            generated += 1;
            content.push(json!({
                "type": "image",
                "data": b64,
                "mimeType": mime_type,
            }));
        } else if let Some(url) = item.get("url").and_then(Value::as_str) {
            if url.trim().is_empty() {
                continue;
            }
            generated += 1;
            remote_urls.push(url.to_string());
        }
    }

    if generated == 0 {
        return Err(generic_error(
            "Image generation returned no image data".to_string(),
        ));
    }

    Ok(build_result(prompt, model, channel_label, generated, content, remote_urls))
}

/// 解析 Gemini Interactions API 响应：`steps[]` 中 `model_output` 步骤的
/// `content[]` 块（`{type:"image", data, mime_type}`）。thought 步骤中的
/// 临时想法图被忽略。
fn parse_interactions_images(response_body: &Value) -> Vec<Value> {
    let mut content = Vec::new();
    let Some(steps) = response_body.get("steps").and_then(Value::as_array) else {
        return content;
    };
    for step in steps {
        if step.get("type").and_then(Value::as_str) != Some("model_output") {
            continue;
        }
        let Some(blocks) = step.get("content").and_then(Value::as_array) else {
            continue;
        };
        for block in blocks {
            if block.get("type").and_then(Value::as_str) != Some("image") {
                continue;
            }
            let Some(data) = block.get("data").and_then(Value::as_str) else {
                continue;
            };
            if data.trim().is_empty() {
                continue;
            }
            let mime_type = block
                .get("mime_type")
                .and_then(Value::as_str)
                .filter(|value| value.starts_with("image/"))
                .unwrap_or("image/png");
            content.push(json!({
                "type": "image",
                "data": data,
                "mimeType": mime_type,
            }));
        }
    }
    content
}

/// 解析 Gemini candidates[].content.parts[].inlineData。
fn parse_gemini_candidates(response_body: &Value) -> Vec<Value> {
    let mut content = Vec::new();
    if let Some(candidates) = response_body.get("candidates").and_then(Value::as_array) {
        for candidate in candidates {
            let Some(parts) = candidate
                .get("content")
                .and_then(|content| content.get("parts"))
                .and_then(Value::as_array)
            else {
                continue;
            };
            for part in parts {
                let Some(inline_data) = part.get("inlineData") else {
                    continue;
                };
                let Some(data) = inline_data.get("data").and_then(Value::as_str) else {
                    continue;
                };
                if data.trim().is_empty() {
                    continue;
                }
                let mime_type = inline_data
                    .get("mimeType")
                    .and_then(Value::as_str)
                    .filter(|value| value.starts_with("image/"))
                    .unwrap_or("image/png");
                content.push(json!({
                    "type": "image",
                    "data": data,
                    "mimeType": mime_type,
                }));
            }
        }
    }
    content
}

/// 消费 Gemini 流式响应（SSE / 逐行 JSON），边到达边推送预览。
async fn read_gemini_stream(
    response: reqwest::Response,
    on_chunk: &BashStreamCallback,
) -> napi::Result<Vec<Value>> {
    let mut stream = response.bytes_stream();
    let mut buffer: Vec<u8> = Vec::new();
    let mut all_images: Vec<Value> = Vec::new();
    let mut partial_index = 0usize;

    while let Some(chunk) = stream.next().await {
        let chunk = chunk
            .map_err(|error| generic_error(format!("Stream read failed: {error}")))?;
        buffer.extend_from_slice(&chunk);

        loop {
            let Some(position) = buffer.iter().position(|&byte| byte == b'\n') else {
                break;
            };
            let line: Vec<u8> = buffer.drain(..=position).collect();
            let line_str = String::from_utf8_lossy(&line);
            process_gemini_stream_line(&line_str, &mut all_images, &mut partial_index, on_chunk);
        }
    }
    if !buffer.is_empty() {
        let line_str = String::from_utf8_lossy(&buffer);
        process_gemini_stream_line(&line_str, &mut all_images, &mut partial_index, on_chunk);
    }

    if all_images.is_empty() {
        return Err(generic_error(
            "Image generation stream ended without any image data".to_string(),
        ));
    }
    Ok(all_images)
}

fn process_gemini_stream_line(
    line: &str,
    all_images: &mut Vec<Value>,
    partial_index: &mut usize,
    on_chunk: &BashStreamCallback,
) {
    let trimmed = line.trim();
    if trimmed.is_empty() || trimmed == "[DONE]" {
        return;
    }
    // SSE 包装（"data: {...}"）或裸 JSON 行都接受
    let json_text = trimmed
        .strip_prefix("data:")
        .map(str::trim)
        .unwrap_or(trimmed);
    let Ok(event) = serde_json::from_str::<Value>(json_text) else {
        return;
    };

    let images = parse_gemini_candidates(&event);
    for image in images {
        if let Some(data) = image.get("data").and_then(Value::as_str) {
            let mime_type = image
                .get("mimeType")
                .and_then(Value::as_str)
                .unwrap_or("image/png");
            emit_partial(on_chunk, *partial_index, mime_type, data);
            *partial_index += 1;
        }
        all_images.push(image);
    }
}

/// 将 Gemini 图片内容块汇总为统一结果。
fn collect_gemini_result(
    prompt: &str,
    model: &str,
    channel_label: &str,
    content: Vec<Value>,
) -> napi::Result<Value> {
    let generated = content.len();
    if generated == 0 {
        return Err(generic_error(
            "Image generation returned no image data".to_string(),
        ));
    }
    Ok(build_result(
        prompt,
        model,
        channel_label,
        generated,
        content,
        Vec::new(),
    ))
}

/// 从 system_settings 表加载独立的前端「图像生成」设置。
/// 兼容三种存储格式：
/// - 新版：{ "channels": [ {...}, ... ] }（多渠道）
/// - 旧双渠道：{ openai: {...}, gemini: {...} } → 迁移为 channels 数组
/// - 更旧单渠道：顶层 provider/baseUrl/apiKey/model/... → 迁移为单个渠道
fn load_imagegen_settings() -> napi::Result<ImageGenSettings> {
    let storage_info = crate::storage::initialize_app_storage()?;
    let database_path = std::path::PathBuf::from(storage_info.database_path);
    let value = crate::storage::services::system_settings::get_system_setting_value(
        &database_path,
        IMAGE_GEN_SETTING_CODE,
    )?;
    match value {
        Some(raw) => {
            let parsed: Value = serde_json::from_str(&raw).map_err(|error| {
                Error::from_reason(format!(
                    "Failed to parse image generation settings: {error}"
                ))
            })?;

            // 新版多渠道格式
            if let Some(channels) = parsed.get("channels") {
                if channels.is_array() {
                    return serde_json::from_value(parsed).map_err(|error| {
                        Error::from_reason(format!(
                            "Failed to parse image generation settings: {error}"
                        ))
                    });
                }
            }

            // 旧双渠道格式：{openai, gemini} → channels
            if parsed.get("openai").is_some() || parsed.get("gemini").is_some() {
                let mut channels = Vec::new();
                for (key, provider) in [("openai", "openai"), ("gemini", "gemini")] {
                    if let Some(channel_value) = parsed.get(key) {
                        if !channel_value.is_object() {
                            continue;
                        }
                        let mut channel: ImageGenChannel =
                            serde_json::from_value(channel_value.clone()).map_err(|error| {
                                Error::from_reason(format!(
                                    "Failed to parse image generation settings: {error}"
                                ))
                            })?;
                        channel.id = key.to_string();
                        channel.provider = provider.to_string();
                        channels.push(channel);
                    }
                }
                return Ok(ImageGenSettings { channels });
            }

            // 更旧单渠道格式（顶层字段）→ 迁移为一个渠道
            let old_provider = parsed
                .get("provider")
                .and_then(Value::as_str)
                .unwrap_or("");
            let old_base_url = parsed
                .get("baseUrl")
                .and_then(Value::as_str)
                .unwrap_or("");
            let is_gemini = old_provider == "gemini"
                || old_base_url.contains("generativelanguage")
                || old_base_url.contains("googleapis.com");
            let mut channel = ImageGenChannel {
                enabled: true,
                base_url: old_base_url.to_string(),
                api_key: parsed
                    .get("apiKey")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                model: parsed
                    .get("model")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                default_size: parsed
                    .get("defaultSize")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                default_quality: parsed
                    .get("defaultQuality")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                output_format: parsed
                    .get("outputFormat")
                    .and_then(Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                web_search: parsed
                    .get("webSearch")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                default_stream: parsed
                    .get("defaultStream")
                    .and_then(Value::as_bool)
                    .unwrap_or(false),
                ..ImageGenChannel::default()
            };
            if is_gemini {
                channel.id = "gemini".to_string();
                channel.provider = "gemini".to_string();
            } else {
                channel.id = "openai".to_string();
                channel.provider = "openai".to_string();
            }
            Ok(ImageGenSettings {
                channels: vec![channel],
            })
        }
        None => Ok(ImageGenSettings::default()),
    }
}

/// 是否有至少一个可用的生图渠道（用于工具暴露过滤：两个渠道都未配置时
/// 不把 imagegen-generate 注册给模型）。
pub fn is_imagegen_configured() -> napi::Result<bool> {
    Ok(load_imagegen_settings()?.has_enabled_channel())
}

/// 解析生图渠道：显式 `provider` 参数优先；`auto`/缺省时选择第一个可用
/// 渠道（按设置中的渠道顺序）。`provider` 参数支持三种匹配方式：
/// - 协议类型："openai" / "gemini"（匹配该协议的第一个可用渠道）
/// - 渠道 ID（设置面板自动生成，config-list 可查）
/// - 渠道名称（用户自定义显示名）
/// 渠道未启用或凭据不全时报错并列出可用渠道，方便 agent 修正参数。
fn resolve_channel<'a>(
    args: &Value,
    settings: &'a ImageGenSettings,
) -> napi::Result<(&'a str, &'a ImageGenChannel)> {
    let requested = args
        .get("provider")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "auto")
        .map(str::to_string);

    match requested.as_deref() {
        Some(key) => {
            let key_lower = key.to_lowercase();
            let channel = if key_lower == "openai" || key_lower == "gemini" {
                // 协议类型：匹配该协议的第一个可用渠道
                settings.channels.iter().find(|channel| {
                    channel.is_usable() && channel.provider.eq_ignore_ascii_case(&key_lower)
                })
            } else {
                // 渠道 ID 或显示名
                settings.channels.iter().find(|channel| {
                    channel.is_usable()
                        && (channel.id.eq_ignore_ascii_case(key)
                            || channel.name.trim().eq_ignore_ascii_case(key))
                })
            };
            match channel {
                Some(channel) => Ok((channel.provider.as_str(), channel)),
                None => Err(Error::from_reason(format!(
                    "Channel \"{key}\" is not configured or not usable (needs enabled + API key + model). {}",
                    available_channels_summary(settings)
                ))),
            }
        }
        None => match settings.channels.iter().find(|channel| channel.is_usable()) {
            Some(channel) => Ok((channel.provider.as_str(), channel)),
            None => Err(Error::from_reason(format!(
                "No image generation channel configured. Configure at least one channel in Settings -> Image generation (API key + model), then the imagegen-generate tool becomes available. {}",
                available_channels_summary(settings)
            ))),
        },
    }
}

/// 可用渠道摘要（列出 id / 名称 / 协议，帮助 agent 通过 provider 参数指定渠道）。
fn available_channels_summary(settings: &ImageGenSettings) -> String {
    let usable: Vec<String> = settings
        .channels
        .iter()
        .filter(|channel| channel.is_usable())
        .map(|channel| {
            format!(
                "\"{}\" (id={}, provider={})",
                channel.display_name(),
                channel.id,
                channel.provider
            )
        })
        .collect();
    if usable.is_empty() {
        "No usable channels.".to_string()
    } else {
        format!("Usable channels: {}", usable.join(", "))
    }
}

/// 渠道端点：渠道 baseUrl > 官方默认（按渠道自身协议类型）。
fn channel_base_url(channel: &ImageGenChannel) -> String {
    non_empty(&channel.base_url).unwrap_or_else(|| {
        if channel.provider == "gemini" {
            DEFAULT_GEMINI_BASE_URL.to_string()
        } else {
            DEFAULT_OPENAI_BASE_URL.to_string()
        }
    })
}

fn non_empty(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

async fn build_client() -> napi::Result<reqwest::Client> {
    crate::api::http_client::build_proxied_client_with_timeout(Duration::from_secs(
        REQUEST_TIMEOUT_SECS,
    ))
    .await
    .map_err(|error| Error::from_reason(format!("Failed to create HTTP client: {error}")))
}

fn api_error(prefix: &str, status: u16, response_body: &Value) -> Error {
    let message = response_body
        .get("error")
        .and_then(|error| error.get("message"))
        .and_then(Value::as_str)
        .unwrap_or("Unknown error");
    let error_type = response_body
        .get("error")
        .and_then(|error| error.get("type"))
        .and_then(Value::as_str)
        .unwrap_or("");
    let mut detail = format!("{prefix}: {status} {message}");
    if !error_type.is_empty() {
        detail.push_str(&format!(" (type: {error_type})"));
    }
    generic_error(detail)
}

fn build_result(
    prompt: &str,
    model: &str,
    provider: &str,
    generated: usize,
    content: Vec<Value>,
    remote_urls: Vec<String>,
) -> Value {
    let mut summary = format!("Generated {generated} image(s) with {model} ({provider}).");
    if !remote_urls.is_empty() {
        summary.push_str(&format!(" Remote URLs: {}", remote_urls.join(", ")));
    }

    let mut result = json!({
        "prompt": prompt,
        "model": model,
        "provider": provider,
        "imageCount": generated,
        "content": content,
        "contentPreview": summary,
    });
    if !remote_urls.is_empty() {
        result["remoteUrls"] = json!(remote_urls);
    }
    result
}

fn required_string<'a>(args: &'a Value, key: &str, tool_name: &str) -> napi::Result<&'a str> {
    args.get(key)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            Error::new(
                Status::InvalidArg,
                format!("{key} is required for tool \"{tool_name}\""),
            )
        })
}

fn bounded_usize(value: Option<u64>, default: usize, min: usize, max: usize) -> usize {
    value
        .map(|value| value as usize)
        .unwrap_or(default)
        .clamp(min, max)
}

fn mime_for_format(format: &str) -> String {
    match format.to_ascii_lowercase().as_str() {
        "jpeg" | "jpg" => "image/jpeg".to_string(),
        "webp" => "image/webp".to_string(),
        _ => "image/png".to_string(),
    }
}

fn generic_error(message: String) -> Error {
    Error::new(Status::GenericFailure, message)
}
