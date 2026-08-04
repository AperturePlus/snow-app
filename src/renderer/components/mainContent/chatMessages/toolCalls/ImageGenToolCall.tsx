import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  Download,
  Image as ImageIcon,
  Link2,
  Loader2,
  Sparkles,
} from "lucide-react";
import { useI18n } from "../../../../i18n";
import type { ToolCallInfo } from "../utils/conversationTypes";
import { ToolCallNode } from "./shared/ToolCallNode";

type ImageGenToolCallProps = {
  toolCall: ToolCallInfo;
};

type ParsedImageGenArgs = {
  prompt: string;
  model?: string;
  size?: string;
  quality?: string;
  outputFormat?: string;
  outputCompression?: number;
  n?: number;
  provider?: string;
  personGeneration?: string;
  webSearch?: boolean;
  stream?: boolean;
  inputFidelity?: string;
  background?: string;
  moderation?: string;
  seed?: number;
  thinkingLevel?: string;
  imageSearch?: boolean;
  images?: Array<{ data: string; mimeType: string }>;
};

type GeneratedImage = {
  data: string;
  mimeType: string;
};

type ParsedImageGenResult =
  | {
      type: "success";
      prompt: string;
      model: string;
      imageCount: number;
      images: GeneratedImage[];
      remoteUrls: string[];
      contentPreview: string;
    }
  | { type: "error"; message: string }
  | { type: "raw"; text: string }
  | { type: "empty" };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const parseImageGenArgs = (args: string): ParsedImageGenArgs | null => {
  try {
    const parsed: unknown = JSON.parse(args);
    if (
      !isRecord(parsed) ||
      typeof parsed.prompt !== "string" ||
      parsed.prompt.trim() === ""
    ) {
      return null;
    }

    const result: ParsedImageGenArgs = { prompt: parsed.prompt };
    if (typeof parsed.model === "string") {
      result.model = parsed.model;
    }
    if (typeof parsed.size === "string") {
      result.size = parsed.size;
    }
    if (typeof parsed.quality === "string") {
      result.quality = parsed.quality;
    }
    if (typeof parsed.outputFormat === "string") {
      result.outputFormat = parsed.outputFormat;
    }
    if (typeof parsed.n === "number") {
      result.n = parsed.n;
    }
    if (typeof parsed.outputCompression === "number") {
      result.outputCompression = parsed.outputCompression;
    }
    if (typeof parsed.provider === "string" && parsed.provider.trim() !== "") {
      result.provider = parsed.provider;
    }
    if (typeof parsed.seed === "number") {
      result.seed = parsed.seed;
    }
    if (typeof parsed.thinkingLevel === "string") {
      result.thinkingLevel = parsed.thinkingLevel;
    }
    if (typeof parsed.imageSearch === "boolean") {
      result.imageSearch = parsed.imageSearch;
    }
    if (
      typeof parsed.personGeneration === "string" &&
      parsed.personGeneration.trim() !== ""
    ) {
      result.personGeneration = parsed.personGeneration;
    }
    if (typeof parsed.webSearch === "boolean") {
      result.webSearch = parsed.webSearch;
    }
    if (typeof parsed.stream === "boolean") {
      result.stream = parsed.stream;
    }
    if (typeof parsed.inputFidelity === "string") {
      result.inputFidelity = parsed.inputFidelity;
    }
    if (typeof parsed.background === "string") {
      result.background = parsed.background;
    }
    if (typeof parsed.moderation === "string") {
      result.moderation = parsed.moderation;
    }
    if (Array.isArray(parsed.images)) {
      const images: Array<{ data: string; mimeType: string }> = [];
      for (const item of parsed.images) {
        if (
          isRecord(item) &&
          typeof item.data === "string" &&
          item.data.trim() !== "" &&
          typeof item.mimeType === "string"
        ) {
          images.push({ data: item.data, mimeType: item.mimeType });
        }
      }
      if (images.length > 0) {
        result.images = images;
      }
    }
    return result;
  } catch {
    return null;
  }
};

const parseImageGenResult = (result: string | undefined): ParsedImageGenResult => {
  if (!result) {
    return { type: "empty" };
  }

  try {
    const parsed: unknown = JSON.parse(result);
    if (!isRecord(parsed)) {
      return { type: "raw", text: result };
    }
    if (typeof parsed.error === "string") {
      return { type: "error", message: parsed.error };
    }

    const images: GeneratedImage[] = [];
    const remoteUrls: string[] = [];

    if (Array.isArray(parsed.content)) {
      for (const block of parsed.content) {
        if (
          isRecord(block) &&
          block.type === "image" &&
          typeof block.data === "string" &&
          typeof block.mimeType === "string"
        ) {
          images.push({
            data: block.data as string,
            mimeType: block.mimeType as string,
          });
        }
      }
    }

    if (Array.isArray(parsed.remoteUrls)) {
      for (const url of parsed.remoteUrls) {
        if (typeof url === "string" && url.trim() !== "") {
          remoteUrls.push(url);
        }
      }
    }

    if (images.length === 0 && remoteUrls.length === 0) {
      return { type: "raw", text: result };
    }

    return {
      type: "success",
      prompt: typeof parsed.prompt === "string" ? parsed.prompt : "",
      model: typeof parsed.model === "string" ? parsed.model : "",
      imageCount:
        typeof parsed.imageCount === "number"
          ? parsed.imageCount
          : images.length + remoteUrls.length,
      images,
      remoteUrls,
      contentPreview:
        typeof parsed.contentPreview === "string" ? parsed.contentPreview : "",
    };
  } catch {
    return { type: "raw", text: result };
  }
};

const truncateLabel = (value: string, max: number): string =>
  value.length > max ? `${value.slice(0, max)}...` : value;

const mimeToExtension = (mimeType: string): string => {
  if (mimeType.includes("jpeg")) return "png";
  if (mimeType.includes("webp")) return "webp";
  return "png";
};

/** 保存生成的图片（原生文件选择器优先，回退为浏览器下载）。 */
const saveImageBlob = async (
  dataUrl: string,
  filename: string
): Promise<void> => {
  const blob = await (async () => {
    const response = await fetch(dataUrl);
    return response.blob();
  })();

  const picker = (
    window as unknown as {
      showSaveFilePicker?: (opts: {
        suggestedName?: string;
        types: { description?: string; accept: Record<string, string[]> }[];
      }) => Promise<FileSystemFileHandle>;
    }
  ).showSaveFilePicker;

  if (typeof picker === "function") {
    try {
      const handle = await picker({
        suggestedName: filename,
        types: [
          {
            description: "Image file",
            accept: { [blob.type]: [blob.type] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch {
      // User cancelled the picker — fall through to anchor download.
    }
  }

  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export const ImageGenToolCall = ({
  toolCall,
}: ImageGenToolCallProps): React.JSX.Element => {
  const { t } = useI18n();
  const [lightbox, setLightbox] = useState<GeneratedImage | null>(null);

  const parsedArgs = useMemo(
    () => parseImageGenArgs(toolCall.arguments),
    [toolCall.arguments]
  );
  const parsedResult = useMemo(
    () => parseImageGenResult(toolCall.result),
    [toolCall.result]
  );

  const hasError = parsedResult.type === "error";
  const effectiveStatus = hasError ? "error" : toolCall.status;

  const streamingImages = toolCall.streamingImages ?? [];

  const prompt = parsedArgs?.prompt ?? "";
  const imageCount =
    parsedResult.type === "success" ? parsedResult.imageCount : 0;

  // 灯箱：挂载到 document.body，确保 fixed 定位始终相对视口，
  // 无论页面滚动到何处都保持水平 + 垂直居中。
  const lightboxElement = lightbox
    ? createPortal(
        <div
          className="tool-call-imagegen-lightbox"
          onClick={() => setLightbox(null)}
          role="presentation"
        >
          <img
            src={`data:${lightbox.mimeType};base64,${lightbox.data}`}
            alt={t("toolCall.imagegen.generatedImage")}
            onClick={(event) => event.stopPropagation()}
          />
          <div
            className="tool-call-imagegen-lightbox-toolbar"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="tool-call-imagegen-download"
              onClick={() =>
                void saveImageBlob(
                  `data:${lightbox.mimeType};base64,${lightbox.data}`,
                  `generated-image.${mimeToExtension(lightbox.mimeType)}`
                )
              }
              title={t("toolCall.imagegen.download")}
              aria-label={t("toolCall.imagegen.download")}
            >
              <Download size={13} aria-hidden="true" />
              {t("toolCall.imagegen.download")}
            </button>
            <button
              type="button"
              className="tool-call-imagegen-lightbox-close"
              onClick={() => setLightbox(null)}
              aria-label={t("toolCall.imagegen.close")}
            >
              ✕
            </button>
          </div>
        </div>,
        document.body
      )
    : null;

  // 成功且有图片：直接以相框画廊展示，不再渲染工具卡片头部
  if (parsedResult.type === "success" && parsedResult.images.length > 0) {
    return (
      <div className="tool-call-imagegen tool-call-imagegen-result">
        <div
          className={`tool-call-imagegen-grid${
            parsedResult.images.length === 1
              ? " tool-call-imagegen-grid-single"
              : ""
          }`}
        >
          {parsedResult.images.map((image, index) => (
            <figure
              key={`${index}-${image.data.length}`}
              className="tool-call-imagegen-figure"
            >
              <button
                type="button"
                className="tool-call-imagegen-thumb"
                onClick={() => setLightbox(image)}
                title={t("toolCall.imagegen.zoom")}
                aria-label={t("toolCall.imagegen.zoom")}
              >
                <img
                  src={`data:${image.mimeType};base64,${image.data}`}
                  alt={`${t("toolCall.imagegen.generatedImage")} ${index + 1}`}
                />
              </button>
              <figcaption className="tool-call-imagegen-figure-caption">
                <span className="tool-call-imagegen-figure-index">
                  {index + 1}
                </span>
                <span className="tool-call-imagegen-figure-label">
                  {t("toolCall.imagegen.generatedImage")}
                </span>
                <button
                  type="button"
                  className="tool-call-imagegen-download"
                  onClick={() =>
                    void saveImageBlob(
                      `data:${image.mimeType};base64,${image.data}`,
                      `generated-image-${index + 1}.${mimeToExtension(
                        image.mimeType
                      )}`
                    )
                  }
                  title={t("toolCall.imagegen.download")}
                  aria-label={t("toolCall.imagegen.download")}
                >
                  <Download size={11} aria-hidden="true" />
                </button>
              </figcaption>
            </figure>
          ))}
        </div>

        {parsedResult.remoteUrls.length > 0 ? (
          <div className="tool-call-imagegen-remote">
            <span className="tool-call-imagegen-remote-label">
              <Link2 size={10} aria-hidden="true" />
              {t("toolCall.imagegen.remoteUrls")}
            </span>
            {parsedResult.remoteUrls.map((url, index) => (
              <a
                key={url}
                className="tool-call-imagegen-remote-link"
                href={url}
                target="_blank"
                rel="noreferrer"
              >
                {truncateLabel(url, 80)}
                {index + 1 < parsedResult.remoteUrls.length ? " · " : ""}
              </a>
            ))}
          </div>
        ) : null}

        {lightboxElement}
      </div>
    );
  }

  // 生成中（等待/执行/流式预览）：同样以纯相框画廊展示
  const isGenerating =
    !hasError &&
    (toolCall.status === "pending" || toolCall.status === "running");
  if (isGenerating && parsedResult.type !== "success") {
    const latestStream =
      streamingImages.length > 0
        ? streamingImages[streamingImages.length - 1]
        : null;
    return (
      <div className="tool-call-imagegen tool-call-imagegen-result">
        <div className="tool-call-imagegen-grid tool-call-imagegen-grid-single">
          <figure className="tool-call-imagegen-figure">
            <div className="tool-call-imagegen-thumb tool-call-imagegen-thumb-static">
              {latestStream ? (
                <img
                  src={`data:${latestStream.mimeType};base64,${latestStream.data}`}
                  alt={t("toolCall.imagegen.streamingPreview")}
                />
              ) : (
                <div className="tool-call-imagegen-placeholder">
                  <Loader2
                    className="tool-call-icon-spinning"
                    size={22}
                    aria-hidden="true"
                  />
                  <span>
                    {toolCall.status === "running"
                      ? t("toolCall.imagegen.generating")
                      : t("toolCall.imagegen.waiting")}
                  </span>
                </div>
              )}
            </div>
            <figcaption className="tool-call-imagegen-figure-caption">
              <span className="tool-call-imagegen-figure-index">
                {streamingImages.length > 0 ? streamingImages.length : "…"}
              </span>
              <span className="tool-call-imagegen-figure-label">
                {latestStream
                  ? t("toolCall.imagegen.streamingPreview")
                  : toolCall.status === "running"
                    ? t("toolCall.imagegen.generating")
                    : t("toolCall.imagegen.waiting")}
              </span>
              <span aria-hidden="true" />
            </figcaption>
          </figure>
        </div>
      </div>
    );
  }

  return (
    <ToolCallNode
      toolName={toolCall.name}
      badgeName={t("toolCall.imagegen.name")}
      category="image"
      displayName={prompt ? truncateLabel(prompt, 60) : undefined}
      displayNameTitle={prompt || undefined}
      status={effectiveStatus}
      meta={
        parsedResult.type === "success" ? (
          <span className="tool-call-imagegen-count">
            <ImageIcon size={10} aria-hidden="true" />
            {t("toolCall.imagegen.count", {
              values: { count: imageCount },
            })}
          </span>
        ) : null
      }
      className="tool-call-imagegen"
    >
      <div className="tool-call-body tool-call-imagegen-body">
        {/* 生图参数 */}
        {parsedArgs ? (
          <div className="tool-call-imagegen-params">
            <div className="tool-call-imagegen-param-item">
              <Sparkles size={11} aria-hidden="true" />
              <span className="tool-call-imagegen-param-label">
                {t("toolCall.imagegen.prompt")}
              </span>
              <code className="tool-call-imagegen-param-value">
                {parsedArgs.prompt}
              </code>
            </div>

            {parsedArgs.model ||
            parsedArgs.size ||
            parsedArgs.quality ||
            parsedArgs.outputCompression !== undefined ||
            parsedArgs.n !== undefined ||
            parsedArgs.provider ||
            parsedArgs.personGeneration ||
            parsedArgs.webSearch === true ||
            parsedArgs.stream === true ||
            parsedArgs.inputFidelity ||
            parsedArgs.background ||
            parsedArgs.moderation ||
            parsedArgs.seed !== undefined ||
            parsedArgs.thinkingLevel ||
            parsedArgs.imageSearch === true ? (
              <div className="tool-call-imagegen-param-tags">
                {parsedArgs.provider ? (
                  <span className="tool-call-imagegen-param-tag">
                    {t("toolCall.imagegen.provider")}: {parsedArgs.provider}
                  </span>
                ) : null}
                {parsedArgs.model ? (
                  <span className="tool-call-imagegen-param-tag">
                    {t("toolCall.imagegen.model")}: {parsedArgs.model}
                  </span>
                ) : null}
                {parsedArgs.size ? (
                  <span className="tool-call-imagegen-param-tag">
                    {t("toolCall.imagegen.size")}: {parsedArgs.size}
                  </span>
                ) : null}
                {parsedArgs.quality ? (
                  <span className="tool-call-imagegen-param-tag">
                    {t("toolCall.imagegen.quality")}: {parsedArgs.quality}
                  </span>
                ) : null}
                {parsedArgs.outputCompression !== undefined ? (
                  <span className="tool-call-imagegen-param-tag">
                    {t("toolCall.imagegen.outputCompression")}:{" "}
                    {parsedArgs.outputCompression}%
                  </span>
                ) : null}
                {parsedArgs.personGeneration ? (
                  <span className="tool-call-imagegen-param-tag">
                    {t("toolCall.imagegen.personGeneration")}:{" "}
                    {parsedArgs.personGeneration}
                  </span>
                ) : null}
                {parsedArgs.webSearch === true ? (
                  <span className="tool-call-imagegen-param-tag">
                    {t("toolCall.imagegen.webSearch")}
                  </span>
                ) : null}
                {parsedArgs.stream === true ? (
                  <span className="tool-call-imagegen-param-tag">
                    {t("toolCall.imagegen.streaming")}
                  </span>
                ) : null}
                {parsedArgs.n !== undefined && parsedArgs.n > 1 ? (
                  <span className="tool-call-imagegen-param-tag">
                    {t("toolCall.imagegen.countParam", {
                      values: { count: parsedArgs.n },
                    })}
                  </span>
                ) : null}
                {parsedArgs.inputFidelity ? (
                  <span className="tool-call-imagegen-param-tag">
                    {t("toolCall.imagegen.inputFidelity")}:{" "}
                    {parsedArgs.inputFidelity}
                  </span>
                ) : null}
                {parsedArgs.background ? (
                  <span className="tool-call-imagegen-param-tag">
                    {t("toolCall.imagegen.background")}:{" "}
                    {parsedArgs.background}
                  </span>
                ) : null}
                {parsedArgs.moderation ? (
                  <span className="tool-call-imagegen-param-tag">
                    {t("toolCall.imagegen.moderation")}:{" "}
                    {parsedArgs.moderation}
                  </span>
                ) : null}
                {parsedArgs.seed !== undefined ? (
                  <span className="tool-call-imagegen-param-tag">
                    {t("toolCall.imagegen.seed")}: {parsedArgs.seed}
                  </span>
                ) : null}
                {parsedArgs.thinkingLevel ? (
                  <span className="tool-call-imagegen-param-tag">
                    {t("toolCall.imagegen.thinkingLevel")}:{" "}
                    {parsedArgs.thinkingLevel}
                  </span>
                ) : null}
                {parsedArgs.imageSearch === true ? (
                  <span className="tool-call-imagegen-param-tag">
                    {t("toolCall.imagegen.imageSearch")}
                  </span>
                ) : null}
              </div>
            ) : null}

            {/* 参考图（图生图） */}
            {parsedArgs?.images && parsedArgs.images.length > 0 ? (
              <div className="tool-call-imagegen-refs">
                <span className="tool-call-imagegen-refs-label">
                  <ImageIcon size={10} aria-hidden="true" />
                  {t("toolCall.imagegen.refImages", {
                    values: { count: parsedArgs.images.length },
                  })}
                </span>
                <div className="tool-call-imagegen-refs-grid">
                  {parsedArgs.images.map((image, index) => (
                    <img
                      key={`${index}-${image.data.length}`}
                      className="tool-call-imagegen-ref-thumb"
                      src={`data:${image.mimeType};base64,${image.data}`}
                      alt={`${t("toolCall.imagegen.refImage")} ${index + 1}`}
                    />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* 错误 */}
        {parsedResult.type === "error" ? (
          <div className="tool-call-error">
            <AlertCircle size={12} aria-hidden="true" />
            <span>{parsedResult.message}</span>
          </div>
        ) : null}

        {/* 远程图片链接（兼容返回 url 的端点） */}
        {parsedResult.type === "success" && parsedResult.remoteUrls.length > 0 ? (
          <div className="tool-call-imagegen-remote">
            <span className="tool-call-imagegen-remote-label">
              <Link2 size={10} aria-hidden="true" />
              {t("toolCall.imagegen.remoteUrls")}
            </span>
            {parsedResult.remoteUrls.map((url, index) => (
              <a
                key={url}
                className="tool-call-imagegen-remote-link"
                href={url}
                target="_blank"
                rel="noreferrer"
              >
                {truncateLabel(url, 80)}
                {index + 1 < parsedResult.remoteUrls.length ? " · " : ""}
              </a>
            ))}
          </div>
        ) : null}

        {/* 原始结果兜底 */}
        {parsedResult.type === "raw" ? (
          <section className="tool-call-section">
            <span className="tool-call-section-label">
              {t("toolCall.imagegen.result")}
            </span>
            <pre className="tool-call-section-pre">{parsedResult.text}</pre>
          </section>
        ) : null}
      </div>

      {lightboxElement}
    </ToolCallNode>
  );
};
