use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use base64::Engine;
use chrono;
use napi::bindgen_prelude::*;

#[derive(Clone, Debug)]
pub struct ChatImage {
    pub media_type: String,
    pub data: String,
    pub data_url: String,
}

#[derive(Clone, Debug, Default)]
pub struct ParsedChatMessageContent {
    pub text: String,
    pub images: Vec<ChatImage>,
}

pub fn parse_chat_message_content(
    content: &str,
    database_path: &Path,
) -> Result<ParsedChatMessageContent> {
    const IMAGE_TAG_PREFIX: &str = "@@image:";

    let mut parsed = ParsedChatMessageContent::default();
    let mut remaining = content;

    while let Some(tag_start) = remaining.find(IMAGE_TAG_PREFIX) {
        parsed.text.push_str(&remaining[..tag_start]);

        let tag_value_start = tag_start + IMAGE_TAG_PREFIX.len();
        let tag_value_and_rest = &remaining[tag_value_start..];
        let Some(tag_end) = tag_value_and_rest.find("@@") else {
            parsed.text.push_str(&remaining[tag_start..]);
            return Ok(parsed);
        };

        let data_url = &tag_value_and_rest[..tag_end];
        let full_tag_end = tag_value_start + tag_end + 2;
        if let Some(image) = parse_image_tag_value(data_url, database_path)? {
            parsed.images.push(image);
        } else {
            parsed.text.push_str(&remaining[tag_start..full_tag_end]);
        }

        remaining = &remaining[full_tag_end..];
    }

    parsed.text.push_str(remaining);
    parsed.text = parsed.text.trim().to_string();
    Ok(parsed)
}

fn parse_image_tag_value(value: &str, database_path: &Path) -> Result<Option<ChatImage>> {
    let value = value.trim();
    if value.starts_with("data:") {
        return Ok(parse_base64_image_data_url(value));
    }

    // Reject obviously invalid paths that are not real file references.
    // AI may output literal template strings like "{}" or placeholders
    // after reading source code containing @@image:{}@@ format strings.
    if value.is_empty() || value.contains('{') || !value.contains('/') {
        return Ok(None);
    }

    let relative_path = value;
    let file_path = database_path
        .parent()
        .unwrap_or_else(|| Path::new("."))
        .join(relative_path);

    // Silently skip unreadable files instead of failing the entire request.
    // A stale or invalid image reference should not block the conversation.
    let bytes = match fs::read(&file_path) {
        Ok(bytes) => bytes,
        Err(_) => return Ok(None),
    };
    if bytes.is_empty() {
        return Ok(None);
    }

    let media_type = extension_to_media_type(&file_path);
    let data = base64::engine::general_purpose::STANDARD.encode(&bytes);
    let data_url = format!("data:{};base64,{}", media_type, data);

    Ok(Some(ChatImage {
        media_type,
        data,
        data_url,
    }))
}

fn parse_base64_image_data_url(data_url: &str) -> Option<ChatImage> {
    let value = data_url.trim();
    let (metadata, data) = value.strip_prefix("data:")?.split_once(',')?;
    let media_type = metadata.strip_suffix(";base64")?.trim();
    let data = data.trim();

    if media_type.len() <= "image/".len() || !media_type.starts_with("image/") || data.is_empty() {
        return None;
    }

    Some(ChatImage {
        media_type: media_type.to_string(),
        data: data.to_string(),
        data_url: value.to_string(),
    })
}

pub fn persist_inline_images_to_disk(content: &str, database_path: &Path) -> Result<String> {
    const IMAGE_TAG_PREFIX: &str = "@@image:";

    let upload_root = resolve_upload_root(database_path)?;
    let date = chrono::Local::now().format("%Y-%m-%d").to_string();
    let date_dir = upload_root.join(&date);

    let mut result = String::with_capacity(content.len());
    let mut remaining = content;

    while let Some(tag_start) = remaining.find(IMAGE_TAG_PREFIX) {
        result.push_str(&remaining[..tag_start]);

        let tag_value_start = tag_start + IMAGE_TAG_PREFIX.len();
        let tag_value_and_rest = &remaining[tag_value_start..];
        let Some(tag_end) = tag_value_and_rest.find("@@") else {
            result.push_str(&remaining[tag_start..]);
            return Ok(result);
        };

        let data_url = &tag_value_and_rest[..tag_end];
        let full_tag_end = tag_value_start + tag_end + 2;
        if let Some(image_path) = persist_base64_image(data_url, &date_dir)? {
            result.push_str(&format!("@@image:{}@@", image_path));
        } else {
            result.push_str(&remaining[tag_start..full_tag_end]);
        }

        remaining = &remaining[full_tag_end..];
    }

    result.push_str(remaining);
    Ok(result)
}

fn resolve_upload_root(database_path: &Path) -> Result<PathBuf> {
    let parent = database_path.parent().unwrap_or_else(|| Path::new("."));
    Ok(parent.join("upload"))
}

fn persist_base64_image(data_url: &str, date_dir: &Path) -> Result<Option<String>> {
    let value = data_url.trim();
    let (metadata, data) = match value.strip_prefix("data:").and_then(|v| v.split_once(',')) {
        Some(parts) => parts,
        None => return Ok(None),
    };
    let media_type = match metadata.strip_suffix(";base64") {
        Some(media_type) => media_type.trim(),
        None => return Ok(None),
    };
    if media_type.len() <= "image/".len()
        || !media_type.starts_with("image/")
        || data.trim().is_empty()
    {
        return Ok(None);
    }

    let decoded = match base64::engine::general_purpose::STANDARD.decode(data.trim()) {
        Ok(bytes) => bytes,
        Err(_) => return Ok(None),
    };
    if decoded.is_empty() {
        return Ok(None);
    }

    fs::create_dir_all(date_dir).map_err(|error| {
        Error::from_reason(format!(
            "Failed to create upload directory '{}': {}",
            date_dir.display(),
            error
        ))
    })?;

    let hash = blake3::hash(&decoded).to_hex().to_string();
    let ext = media_type_to_extension(media_type);
    let filename = format!("{}.{}", hash, ext);
    let file_path = date_dir.join(&filename);

    if !file_path.exists() {
        let mut file = fs::File::create(&file_path).map_err(|error| {
            Error::from_reason(format!(
                "Failed to create image file '{}': {}",
                file_path.display(),
                error
            ))
        })?;
        file.write_all(&decoded).map_err(|error| {
            Error::from_reason(format!(
                "Failed to write image file '{}': {}",
                file_path.display(),
                error
            ))
        })?;
    }

    let relative = Path::new("upload")
        .join(date_dir.file_name().unwrap_or_default())
        .join(&filename);
    Ok(Some(relative.to_string_lossy().replace('\\', "/")))
}

fn media_type_to_extension(media_type: &str) -> &str {
    match media_type {
        "image/png" => "png",
        "image/jpeg" => "jpg",
        "image/jpg" => "jpg",
        "image/gif" => "gif",
        "image/webp" => "webp",
        "image/bmp" => "bmp",
        "image/svg+xml" => "svg",
        _ => "bin",
    }
}

fn extension_to_media_type(path: &Path) -> String {
    match path.extension().and_then(|ext| ext.to_str()) {
        Some("png") => "image/png".to_string(),
        Some("jpg") | Some("jpeg") => "image/jpeg".to_string(),
        Some("gif") => "image/gif".to_string(),
        Some("webp") => "image/webp".to_string(),
        Some("bmp") => "image/bmp".to_string(),
        Some("svg") => "image/svg+xml".to_string(),
        _ => "application/octet-stream".to_string(),
    }
}
