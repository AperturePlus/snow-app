import {
  Gem,
  Loader2,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import { AutoDismissNotice } from "../AutoDismissNotice";
import { Modal } from "../common/Modal";
import { useI18n } from "../../i18n";
import { ApiModelCombobox } from "./apiSettings/ApiModelCombobox";
import type { Model } from "../../../preload";
import {
  DEFAULT_GEMINI_BASE_URL,
  DEFAULT_IMAGE_GEN_CHANNEL,
  DEFAULT_OPENAI_BASE_URL,
  GEMINI_MODEL_EXAMPLES,
  IMAGE_GEN_SETTING_CODE,
  IMAGE_GEN_SETTING_NAME,
  OPENAI_MODEL_EXAMPLES,
} from "./imagegenSettings/constants";
import {
  generateChannelId,
  readImageGenSettingsJson,
  toImageGenSettingsJson,
} from "./imagegenSettings/utils";
import type {
  ImageGenChannelValue,
  ImageGenProvider,
  ImageGenSettingsPanelProps,
} from "./imagegenSettings/types";

/** Gemini 常用宽高比快捷选项。 */
const ASPECT_RATIOS = ["1:1", "16:9", "9:16", "4:3", "3:4", "21:9", "2:3", "3:2"];

/** 从 API 返回的模型列表中筛选生图模型。 */
const filterImageModels = (models: Model[], provider: string): Model[] => {
  if (provider === "gemini") {
    return models.filter((model) => {
      const id = model.id.toLowerCase();
      return id.includes("-image") || id.startsWith("imagen");
    });
  }
  return models.filter((model) => {
    const id = model.id.toLowerCase();
    return id.includes("gpt-image") || id.includes("dall-e");
  });
};

/** 根据模型 ID 推断能力标签（i18n 键）。 */
const getModelCapabilities = (modelId: string): string[] => {
  const id = modelId.toLowerCase();
  if (id.includes("gemini-3.1-flash-lite-image")) {
    return ["cap1kOnly", "capFast"];
  }
  if (id.includes("gemini-3.1-flash-image")) {
    return ["cap4k", "capStream", "capImageToImage", "capThinking", "capImageSearch"];
  }
  if (id.includes("gemini-3-pro-image")) {
    return ["cap4k", "capImageToImage", "capThinking", "capInterleaved"];
  }
  if (id.includes("gemini-2.5-flash-image")) {
    return ["cap1kOnly", "capUpTo3Images", "capLegacy"];
  }
  if (id.startsWith("imagen")) {
    return ["capDeprecated"];
  }
  if (id.includes("gpt-image-2") || id.includes("gpt-image-1.5")) {
    return ["cap4k", "capStream", "capImageToImage"];
  }
  if (id.includes("gpt-image-1-mini")) {
    return ["capFast", "capStream"];
  }
  if (id.includes("gpt-image-1")) {
    return ["cap2k", "capStream", "capImageToImage", "capFidelity"];
  }
  if (id.includes("dall-e")) {
    return ["capTextToImageOnly"];
  }
  return [];
};

export function ImageGenSettingsPanel({
  onClose,
}: ImageGenSettingsPanelProps): React.JSX.Element {
  const { t } = useI18n();
  const [channels, setChannels] = useState<ImageGenChannelValue[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const isMountedRef = useRef(true);

  // 弹窗编辑状态
  const [editorOpen, setEditorOpen] = useState(false);
  const [isNewChannel, setIsNewChannel] = useState(false);
  const [draft, setDraft] = useState<ImageGenChannelValue | null>(null);
  const [draftSaving, setDraftSaving] = useState(false);

  // 弹窗内模型列表（基于草稿的 baseUrl/apiKey）
  const [draftModels, setDraftModels] = useState<Model[]>([]);
  const [draftModelsLoading, setDraftModelsLoading] = useState(false);
  const [draftModelsError, setDraftModelsError] = useState<string | null>(null);

  // 搜索
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    setIsLoading(true);
    setError("");

    try {
      const raw = await window.snow.getSystemSettingValue(
        IMAGE_GEN_SETTING_CODE
      );
      const settings = readImageGenSettingsJson(raw);
      setChannels(settings.channels);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.imagegenLoadError", {
              defaultValue: "Failed to load image generation settings",
            })
      );
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 将渠道数组写入存储（即时保存，与 API 设置交互一致）。 */
  const persistChannels = async (
    next: ImageGenChannelValue[],
    successMessage?: string
  ): Promise<boolean> => {
    setIsSaving(true);
    setError("");
    try {
      await window.snow.setSystemSetting(
        IMAGE_GEN_SETTING_NAME,
        IMAGE_GEN_SETTING_CODE,
        toImageGenSettingsJson({ channels: next })
      );
      setChannels(next);
      if (successMessage) {
        setStatus(successMessage);
      }
      return true;
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.imagegenSaveError", {
              defaultValue: "Failed to save image generation settings",
            })
      );
      return false;
    } finally {
      setIsSaving(false);
    }
  };

  /** 渠道显示名（name 留空回退协议默认名）。 */
  const channelLabel = (channel: ImageGenChannelValue): string => {
    if (channel.name.trim()) {
      return channel.name.trim();
    }
    return defaultChannelName(channel.provider);
  };

  /** 协议默认名（名称留空时的回退）。 */
  const defaultChannelName = (provider: ImageGenProvider): string => {
    if (provider === "gemini") {
      return t("settings.imagegenChannelGemini", {
        defaultValue: "Google Gemini",
      });
    }
    return t("settings.imagegenChannelOpenai", {
      defaultValue: "OpenAI-compatible",
    });
  };

  /** 渠道行内启用/禁用（立即保存）。 */
  const toggleEnabled = async (channel: ImageGenChannelValue) => {
    if (isSaving) {
      return;
    }
    const next = channels.map((item) =>
      item.id === channel.id ? { ...item, enabled: !item.enabled } : item
    );
    await persistChannels(next);
  };

  /** 打开添加弹窗。 */
  const openAddEditor = () => {
    setError("");
    setStatus("");
    const index = channels.length;
    setDraft({
      ...DEFAULT_IMAGE_GEN_CHANNEL,
      id: generateChannelId("openai", index),
      enabled: true,
    });
    setIsNewChannel(true);
    setDraftModels([]);
    setDraftModelsError(null);
    setEditorOpen(true);
  };

  /** 打开编辑弹窗。 */
  const openEditEditor = (channel: ImageGenChannelValue) => {
    setError("");
    setStatus("");
    setDraft({ ...channel });
    setIsNewChannel(false);
    setDraftModels([]);
    setDraftModelsError(null);
    setEditorOpen(true);
  };

  /** 关闭弹窗。 */
  const closeEditor = () => {
    if (draftSaving) {
      return;
    }
    setEditorOpen(false);
    setDraft(null);
  };

  /** 保存弹窗草稿（添加或编辑）。 */
  const saveDraft = async () => {
    if (!draft) {
      return;
    }
    setDraftSaving(true);
    setError("");
    setStatus("");

    const saved: ImageGenChannelValue = {
      ...draft,
      name: draft.name.trim(),
      baseUrl: draft.baseUrl.trim(),
      apiKey: draft.apiKey.trim(),
      model: draft.model.trim(),
      defaultSize: draft.defaultSize.trim(),
      defaultQuality: draft.defaultQuality.trim(),
      outputFormat: draft.outputFormat.trim(),
    };

    const next = isNewChannel
      ? [...channels, saved]
      : channels.map((item) => (item.id === saved.id ? saved : item));

    const ok = await persistChannels(
      next,
      isNewChannel
        ? t("settings.imagegenAddChannelSuccess", {
            defaultValue: "Channel {name} added.",
          }).replace("{name}", channelLabel(saved))
        : t("settings.imagegenEditChannelSuccess", {
            defaultValue: "Channel {name} updated.",
          }).replace("{name}", channelLabel(saved))
    );
    setDraftSaving(false);
    if (ok) {
      setEditorOpen(false);
      setDraft(null);
    }
  };

  /** 删除渠道（确认后立即保存）。 */
  const removeChannel = async (channel: ImageGenChannelValue) => {
    const label = channelLabel(channel);
    const confirmed = window.confirm(
      t("settings.imagegenDeleteConfirm", {
        values: { name: label },
        defaultValue: `Delete channel "${label}"?`,
      })
    );
    if (!confirmed) {
      return;
    }
    const next = channels.filter((item) => item.id !== channel.id);
    const ok = await persistChannels(
      next,
      t("settings.imagegenDeleteChannelSuccess", {
        defaultValue: "Channel {name} deleted.",
      }).replace("{name}", label)
    );
    if (ok && draft?.id === channel.id) {
      setEditorOpen(false);
      setDraft(null);
    }
  };

  /** 弹窗内草稿字段更新。 */
  const updateDraft = <K extends keyof ImageGenChannelValue>(
    field: K,
    value: ImageGenChannelValue[K]
  ) => {
    setDraft((previous) =>
      previous ? { ...previous, [field]: value } : previous
    );
  };

  const updateDraftEvent =
    (field: keyof ImageGenChannelValue) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value =
        event.target instanceof HTMLInputElement &&
        event.target.type === "checkbox"
          ? event.target.checked
          : event.target.value;
      updateDraft(field, value as never);
    };

  /** 弹窗内加载模型列表。 */
  const requestDraftModels = async () => {
    if (!draft || draftModelsLoading) {
      return;
    }
    setDraftModelsLoading(true);
    setDraftModelsError(null);
    const isGemini = draft.provider === "gemini";
    const defaultBaseUrl = isGemini
      ? DEFAULT_GEMINI_BASE_URL
      : DEFAULT_OPENAI_BASE_URL;

    try {
      const allModels = await window.snow.fetchAvailableModelsForConfig({
        baseUrl: draft.baseUrl.trim() || defaultBaseUrl,
        baseUrlMode: "custom",
        apiKey: draft.apiKey.trim(),
        requestMethod: isGemini ? "gemini" : "openai",
        customHeaderSchemeId: "",
      });
      setDraftModels(filterImageModels(allModels, draft.provider));
    } catch (e) {
      setDraftModelsError(e instanceof Error ? e.message : String(e));
    } finally {
      setDraftModelsLoading(false);
    }
  };

  const filteredChannels = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) {
      return channels;
    }
    return channels.filter((channel) => {
      const haystack = [
        channel.name,
        channel.baseUrl,
        channel.model,
        channel.provider,
      ]
        .join(" ")
        .toLowerCase();
      return haystack.includes(query);
    });
  }, [channels, searchQuery]);

  const enabledCount = channels.filter((channel) => channel.enabled).length;
  const isBusy = isLoading || isSaving;

  const renderDraftPanel = (): React.JSX.Element => {
    if (!draft) {
      return <></>;
    }
    const isGemini = draft.provider === "gemini";
    const defaultBaseUrl = isGemini
      ? DEFAULT_GEMINI_BASE_URL
      : DEFAULT_OPENAI_BASE_URL;
    const modelPlaceholder = isGemini
      ? GEMINI_MODEL_EXAMPLES
      : OPENAI_MODEL_EXAMPLES;
    const capabilities = getModelCapabilities(draft.model);

    return (
      <div className="imagegen-editor">
        <div className="api-settings-form-grid">
          <label className="api-settings-field imagegen-field-wide">
            <span className="api-settings-field-label">
              {t("settings.imagegenChannelName", {
                defaultValue: "Channel name",
              })}
            </span>
            <input
              type="text"
              value={draft.name}
              onChange={updateDraftEvent("name")}
              placeholder={defaultChannelName(draft.provider)}
              disabled={draftSaving}
              spellCheck={false}
              autoFocus
            />
            <small className="api-settings-field-hint">
              {t("settings.imagegenChannelNameHint", {
                defaultValue:
                  "Custom name shown in the list and used by the agent (leave empty to use the default).",
              })}
            </small>
          </label>

          <label className="api-settings-field">
            <span className="api-settings-field-label">
              {t("settings.imagegenProvider", { defaultValue: "Provider" })}
            </span>
            <select
              value={draft.provider}
              onChange={(event) =>
                updateDraft(
                  "provider",
                  event.target.value as ImageGenProvider
                )
              }
              disabled={draftSaving}
            >
              <option value="openai">
                {t("settings.imagegenProviderOpenai", {
                  defaultValue: "OpenAI-compatible",
                })}
              </option>
              <option value="gemini">
                {t("settings.imagegenProviderGemini", {
                  defaultValue: "Google Gemini (Imagen)",
                })}
              </option>
            </select>
          </label>

          <label className="api-settings-field">
            <span className="api-settings-field-label">
              {t("settings.imagegenEnabled", { defaultValue: "Enabled" })}
            </span>
            <label className="toggle-switch">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={updateDraftEvent("enabled")}
                disabled={draftSaving}
              />
              <span className="toggle-switch-slider" />
            </label>
          </label>
        </div>

        <div className="imagegen-groups">
          <section className="imagegen-group">
            <h4 className="imagegen-group-title">
              {t("settings.imagegenConnection", {
                defaultValue: "Provider connection",
              })}
            </h4>
            <div className="api-settings-form-grid">
              <label className="api-settings-field">
                <span className="api-settings-field-label">
                  {t("settings.imagegenBaseUrl", {
                    defaultValue: "Base URL",
                  })}
                </span>
                <input
                  type="text"
                  value={draft.baseUrl}
                  onChange={updateDraftEvent("baseUrl")}
                  placeholder={defaultBaseUrl}
                  disabled={draftSaving}
                  spellCheck={false}
                />
                <small className="api-settings-field-hint">
                  {t("settings.imagegenBaseUrlHint", {
                    defaultValue: "Leave empty to use the provider default",
                  })}
                </small>
              </label>

              <label className="api-settings-field">
                <span className="api-settings-field-label">
                  {t("settings.imagegenApiKey", { defaultValue: "API key" })}
                </span>
                <input
                  type="password"
                  value={draft.apiKey}
                  onChange={updateDraftEvent("apiKey")}
                  placeholder="sk-..."
                  disabled={draftSaving}
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
            </div>
          </section>

          <section className="imagegen-group">
            <h4 className="imagegen-group-title">
              {t("settings.imagegenModel", { defaultValue: "Model" })}
            </h4>
            <div className="api-settings-field imagegen-field-wide">
              <ApiModelCombobox
                label={t("settings.imagegenModel", { defaultValue: "Model" })}
                value={draft.model}
                placeholder={modelPlaceholder}
                disabled={draftSaving}
                models={draftModels}
                isLoading={draftModelsLoading}
                error={draftModelsError}
                hasLoaded={draftModels.length > 0 || Boolean(draftModelsError)}
                loadingText={t("settings.imagegenModelsLoading", {
                  defaultValue: "Loading image models...",
                })}
                noModelsText={t("settings.imagegenModelsEmpty", {
                  defaultValue:
                    "No image models found. Check the base URL and API key, or enter the model ID manually.",
                })}
                retryText={t("settings.imagegenModelsRetry", {
                  defaultValue: "Retry",
                })}
                onChange={(modelId) => updateDraft("model", modelId)}
                onRequestModels={() => void requestDraftModels()}
                onRetry={() => void requestDraftModels()}
              />
              {capabilities.length > 0 ? (
                <span className="imagegen-model-caps">
                  {capabilities.map((cap) => (
                    <span className="imagegen-model-cap" key={cap}>
                      {t(`settings.imagegenCap.${cap}`)}
                    </span>
                  ))}
                </span>
              ) : null}
            </div>
          </section>

          <section className="imagegen-group">
            <h4 className="imagegen-group-title">
              {t("settings.imagegenDefaults", {
                defaultValue: "Default parameters",
              })}
            </h4>
            <div className="api-settings-form-grid">
              <label
                className={`api-settings-field${
                  isGemini ? "" : " imagegen-field-wide"
                }`}
              >
                <span className="api-settings-field-label">
                  {t("settings.imagegenDefaultSize", {
                    defaultValue: "Default size",
                  })}
                </span>
                <input
                  type="text"
                  value={draft.defaultSize}
                  onChange={updateDraftEvent("defaultSize")}
                  placeholder={isGemini ? "16:9 / 1K / 2K / 4K" : "1024x1024"}
                  disabled={draftSaving}
                  spellCheck={false}
                />
                <small className="api-settings-field-hint">
                  {t("settings.imagegenDefaultSizeHint", {
                    defaultValue:
                      "Gemini: aspect ratio (16:9) or image size (1K/2K/4K). OpenAI: e.g. 1024x1024",
                  })}
                </small>
              </label>

              {isGemini ? (
                <label className="api-settings-field">
                  <span className="api-settings-field-label">
                    {t("settings.imagegenAspectRatio", {
                      defaultValue: "Aspect ratio",
                    })}
                  </span>
                  <select
                    value={
                      ASPECT_RATIOS.includes(draft.defaultSize.trim())
                        ? draft.defaultSize.trim()
                        : ""
                    }
                    onChange={(event) => {
                      const preset = event.target.value;
                      if (preset) {
                        updateDraft("defaultSize", preset);
                      }
                    }}
                    disabled={draftSaving}
                  >
                    <option value="">
                      {t("settings.imagegenAspectRatio", {
                        defaultValue: "Aspect ratio",
                      })}
                    </option>
                    {ASPECT_RATIOS.map((ratio) => (
                      <option key={ratio} value={ratio}>
                        {ratio}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}

              <label className="api-settings-field">
                <span className="api-settings-field-label">
                  {t("settings.imagegenDefaultQuality", {
                    defaultValue: "Default quality",
                  })}
                </span>
                <select
                  value={draft.defaultQuality}
                  onChange={updateDraftEvent("defaultQuality")}
                  disabled={draftSaving}
                >
                  <option value="">
                    {t("settings.imagegenQualityAuto", {
                      defaultValue: "Auto",
                    })}
                  </option>
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </select>
              </label>

              <label className="api-settings-field">
                <span className="api-settings-field-label">
                  {t("settings.imagegenOutputFormat", {
                    defaultValue: "Output format",
                  })}
                </span>
                <select
                  value={draft.outputFormat}
                  onChange={updateDraftEvent("outputFormat")}
                  disabled={draftSaving}
                >
                  <option value="">
                    {t("settings.imagegenFormatDefault", {
                      defaultValue: "Default (png)",
                    })}
                  </option>
                  <option value="png">png</option>
                  <option value="jpeg">jpeg</option>
                  <option value="webp">webp</option>
                </select>
                <small className="api-settings-field-hint">
                  {t("settings.imagegenFormatHint", {
                    defaultValue: "OpenAI only; ignored for Gemini",
                  })}
                </small>
              </label>
            </div>
          </section>

          <section className="imagegen-group">
            <h4 className="imagegen-group-title">
              {t("settings.imagegenAdvanced", {
                defaultValue: "Advanced",
              })}
            </h4>
            <div className="imagegen-toggle-list">
              {isGemini ? (
                <div className="imagegen-toggle-row">
                  <span className="imagegen-toggle-copy">
                    <span>
                      {t("settings.imagegenWebSearch", {
                        defaultValue: "Google Search grounding",
                      })}
                    </span>
                    <small>
                      {t("settings.imagegenWebSearchHint", {
                        defaultValue:
                          "Gemini only: let Imagen use real-time web information",
                      })}
                    </small>
                  </span>
                  <label className="toggle-switch">
                    <input
                      type="checkbox"
                      checked={draft.webSearch}
                      onChange={updateDraftEvent("webSearch")}
                      disabled={draftSaving}
                    />
                    <span className="toggle-switch-slider" />
                  </label>
                </div>
              ) : null}

              <div className="imagegen-toggle-row">
                <span className="imagegen-toggle-copy">
                  <span>
                    {t("settings.imagegenStreaming", {
                      defaultValue: "Streaming preview",
                    })}
                  </span>
                  <small>
                    {t("settings.imagegenStreamingHint", {
                      defaultValue:
                        "Show intermediate preview images while generating",
                    })}
                  </small>
                </span>
                <label className="toggle-switch">
                  <input
                    type="checkbox"
                    checked={draft.defaultStream}
                    onChange={updateDraftEvent("defaultStream")}
                    disabled={draftSaving}
                  />
                  <span className="toggle-switch-slider" />
                </label>
              </div>
            </div>
          </section>
        </div>
      </div>
    );
  };

  return (
    <div className="api-settings-page" role="region">
      <div className="api-settings-page-header">
        <div className="api-settings-title-group">
          <strong>
            {t("settings.imagegenSettings", {
              defaultValue: "Image generation",
            })}
          </strong>
          <span className="settings-item-description">
            {t("settings.imagegenDescription", {
              defaultValue:
                "Configure any number of independent channels, each with its own provider, base URL, API key and model. Channels can be enabled at the same time and the agent picks one per request. When no channel is configured, the image generation tool is hidden from the agent.",
            })}
          </span>
        </div>
        {onClose ? (
          <button
            type="button"
            className="icon-btn ghost"
            onClick={onClose}
            aria-label={t("settings.closeImagegenSettings", {
              defaultValue: "Close image generation settings",
            })}
            title={t("settings.closeImagegenSettings", {
              defaultValue: "Close image generation settings",
            })}
          >
            <X size={15} strokeWidth={1.8} />
          </button>
        ) : null}
      </div>

      {/* 操作区：与 API 设置页一致 */}
      <div className="imagegen-actions">
        <div className="api-settings-table-search imagegen-search">
          <Search size={14} strokeWidth={1.8} aria-hidden="true" />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder={t("settings.imagegenSearchPlaceholder", {
              defaultValue: "Search channels, models, or base URLs",
            })}
            aria-label={t("settings.imagegenSearchPlaceholder", {
              defaultValue: "Search channels",
            })}
            disabled={isBusy && channels.length === 0}
          />
        </div>
        <span className="imagegen-actions-count">
          {t("settings.imagegenChannelCount", {
            defaultValue: "{count} channels · {enabled} enabled",
          })
            .replace("{count}", String(channels.length))
            .replace("{enabled}", String(enabledCount))}
        </span>
        <button
          type="button"
          className="api-settings-form-btn primary"
          onClick={openAddEditor}
          disabled={isBusy}
        >
          <Plus size={13} strokeWidth={2} aria-hidden="true" />
          {t("settings.imagegenAddChannel", {
            defaultValue: "Add channel",
          })}
        </button>
      </div>

      {/* 渠道表格：复用 API 设置表格样式 */}
      <div className="api-settings-table-panel imagegen-table-panel">
        <div className="api-settings-table-wrap">
          {isLoading ? (
            <div className="api-settings-empty">
              <Loader2 size={16} className="spin" />
              {t("settings.imagegenModelsLoading", {
                defaultValue: "Loading...",
              })}
            </div>
          ) : channels.length === 0 ? (
            <div className="api-settings-empty">
              {t("settings.imagegenNoChannels", {
                defaultValue:
                  "No channels yet. Click \"Add channel\" to create one.",
              })}
            </div>
          ) : filteredChannels.length === 0 ? (
            <div className="api-settings-empty">
              {t("settings.imagegenSearchEmpty", {
                defaultValue: "No channels match your search.",
              })}
            </div>
          ) : (
            <table className="api-settings-table">
              <thead>
                <tr>
                  <th>
                    {t("settings.tableName", { defaultValue: "Name" })}
                  </th>
                  <th>
                    {t("settings.imagegenBaseUrl", { defaultValue: "Base URL" })}
                  </th>
                  <th>
                    {t("settings.imagegenModel", { defaultValue: "Model" })}
                  </th>
                  <th>
                    {t("settings.imagegenProvider", { defaultValue: "Provider" })}
                  </th>
                  <th>
                    {t("settings.tableStatus", { defaultValue: "Status" })}
                  </th>
                  <th className="api-settings-table-actions-col">
                    {t("settings.tableActions", { defaultValue: "Actions" })}
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredChannels.map((channel) => {
                  const isGemini = channel.provider === "gemini";
                  const statusLabel = channel.enabled
                    ? t("settings.imagegenEnabled", {
                        defaultValue: "Enabled",
                      })
                    : t("settings.imagegenDisabled", {
                        defaultValue: "Disabled",
                      });
                  return (
                    <tr key={channel.id}>
                      <td className="cell-name">
                        <span className="imagegen-table-name">
                          <span
                            className={`imagegen-table-icon${
                              isGemini ? " gemini" : ""
                            }`}
                          >
                            {isGemini ? (
                              <Gem size={13} strokeWidth={1.9} aria-hidden="true" />
                            ) : (
                              <Sparkles
                                size={13}
                                strokeWidth={1.9}
                                aria-hidden="true"
                              />
                            )}
                          </span>
                          <span className="imagegen-table-copy">
                            <strong>{channelLabel(channel)}</strong>
                            <small>{channel.id}</small>
                          </span>
                        </span>
                      </td>
                      <td className="cell-url">
                        {channel.baseUrl.trim() ||
                          t("settings.imagegenDefaultEndpoint", {
                            defaultValue: "Provider default",
                          })}
                      </td>
                      <td>{channel.model || "-"}</td>
                      <td>
                        <span
                          className={`badge method imagegen-provider-badge${
                            isGemini ? " gemini" : ""
                          }`}
                        >
                          {isGemini
                            ? t("settings.imagegenProviderGemini", {
                                defaultValue: "Gemini",
                              })
                            : t("settings.imagegenProviderOpenai", {
                                defaultValue: "OpenAI",
                              })}
                        </span>
                      </td>
                      <td>
                        <label
                          className="toggle-switch api-settings-table-switch"
                          title={t("settings.imagegenToggleHint", {
                            defaultValue:
                              "Click to enable or disable this channel",
                          })}
                          aria-label={t("settings.imagegenToggleHint", {
                            defaultValue:
                              "Click to enable or disable this channel",
                          })}
                        >
                          <input
                            type="checkbox"
                            checked={channel.enabled}
                            onChange={() => void toggleEnabled(channel)}
                            disabled={isBusy}
                          />
                          <span className="toggle-slider" />
                          <span>{statusLabel}</span>
                        </label>
                      </td>
                      <td className="api-settings-table-actions-col">
                        <div className="api-settings-table-actions">
                          <button
                            className="icon-btn ghost"
                            onClick={() => openEditEditor(channel)}
                            type="button"
                            title={t("settings.edit", { defaultValue: "Edit" })}
                            aria-label={t("settings.edit", {
                              defaultValue: "Edit",
                            })}
                            disabled={isBusy}
                          >
                            <Pencil size={13} strokeWidth={1.8} />
                          </button>
                          <button
                            className="icon-btn ghost danger"
                            onClick={() => void removeChannel(channel)}
                            type="button"
                            title={t("settings.delete", {
                              defaultValue: "Delete",
                            })}
                            aria-label={t("settings.delete", {
                              defaultValue: "Delete",
                            })}
                            disabled={isBusy}
                          >
                            <Trash2 size={13} strokeWidth={1.8} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <Modal
        open={editorOpen}
        title={
          isNewChannel
            ? t("settings.imagegenAddChannelTitle", {
                defaultValue: "Add channel",
              })
            : t("settings.imagegenEditChannelTitle", {
                defaultValue: "Edit channel",
              })
        }
        description={t("settings.imagegenEditorInfo", {
          defaultValue:
            "Each channel is fully independent: provider, base URL, API key, model and defaults.",
        })}
        closeLabel={t("settings.cancel", { defaultValue: "Cancel" })}
        onClose={closeEditor}
        closeDisabled={draftSaving}
        size="large"
        className="imagegen-editor-modal"
        footer={
          <div className="api-settings-form-actions imagegen-editor-actions">
            <button
              type="button"
              className="api-settings-form-btn secondary"
              onClick={closeEditor}
              disabled={draftSaving}
            >
              {t("settings.cancel", { defaultValue: "Cancel" })}
            </button>
            <button
              type="button"
              className="api-settings-form-btn primary"
              onClick={() => void saveDraft()}
              disabled={draftSaving || !draft}
            >
              {draftSaving ? (
                <Loader2
                  className="tool-call-icon-spinning"
                  size={13}
                  aria-hidden="true"
                />
              ) : (
                <Plus size={13} strokeWidth={2} aria-hidden="true" />
              )}
              {isNewChannel
                ? t("settings.imagegenAddChannel", {
                    defaultValue: "Add channel",
                  })
                : t("settings.imagegenSaveChannel", {
                    defaultValue: "Save channel",
                  })}
            </button>
          </div>
        }
      >
        {renderDraftPanel()}
      </Modal>

      <AutoDismissNotice
        message={error || status}
        tone={error ? "error" : "success"}
        onDismiss={() => {
          setError("");
          setStatus("");
        }}
        durationMs={error ? 6000 : 3000}
      />
    </div>
  );
}
