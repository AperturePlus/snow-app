import {
  BrainCircuit,
  Download,
  Loader2,
  Network,
  Save,
  SearchCode,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState, type ChangeEvent } from "react";
import { AutoDismissNotice } from "../AutoDismissNotice";
import { useI18n } from "../../i18n";
import type { CodebaseSettingsInput } from "../../../preload";

type CodebaseSettingsPanelProps = {
  onClose?: () => void;
};

const DEFAULT_SETTINGS: CodebaseSettingsInput = {
  profileName: "default",
  enabled: false,
  enableAgentReview: true,
  enableReranking: false,
  embeddingType: "jina",
  embeddingModelName: "",
  embeddingBaseUrl: "",
  embeddingApiKey: "",
  embeddingDimensions: 1536,
  batchMaxLines: 10,
  batchConcurrency: 3,
  chunkingMaxLinesPerChunk: 200,
  chunkingMinLinesPerChunk: 10,
  chunkingMinCharsPerChunk: 20,
  chunkingOverlapLines: 20,
  rerankingModelName: "",
  rerankingBaseUrl: "",
  rerankingApiKey: "",
  rerankingContextLength: 4096,
  rerankingTopN: 5,
  configJson: "{}",
  source: "manual",
};

const EMBEDDING_TYPE_OPTIONS = [
  { value: "jina", label: "Jina & OpenAI" },
  { value: "ollama", label: "Ollama" },
  { value: "gemini", label: "Gemini" },
  { value: "mistral", label: "Mistral" },
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const toText = (value: unknown, fallback = ""): string =>
  typeof value === "string" ? value : fallback;

const toBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

const toPositiveInteger = (value: unknown, fallback: number): number => {
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseInt(String(value ?? ""), 10);

  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

const toNonNegativeInteger = (value: unknown, fallback: number): number => {
  const parsed =
    typeof value === "number"
      ? value
      : Number.parseInt(String(value ?? ""), 10);

  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
};

const normalizeSettings = (value: unknown): CodebaseSettingsInput => {
  const source = isRecord(value) ? value : {};
  const profileName = toText(
    source.profileName,
    DEFAULT_SETTINGS.profileName
  ).trim();
  const embeddingType = toText(
    source.embeddingType,
    DEFAULT_SETTINGS.embeddingType
  ).trim();
  const sourceLabel = toText(source.source, DEFAULT_SETTINGS.source).trim();

  return {
    profileName: profileName || DEFAULT_SETTINGS.profileName,
    enabled: toBoolean(source.enabled, DEFAULT_SETTINGS.enabled),
    enableAgentReview: toBoolean(
      source.enableAgentReview,
      DEFAULT_SETTINGS.enableAgentReview
    ),
    enableReranking: toBoolean(
      source.enableReranking,
      DEFAULT_SETTINGS.enableReranking
    ),
    embeddingType: embeddingType || DEFAULT_SETTINGS.embeddingType,
    embeddingModelName: toText(source.embeddingModelName).trim(),
    embeddingBaseUrl: toText(source.embeddingBaseUrl).trim(),
    embeddingApiKey: toText(source.embeddingApiKey),
    embeddingDimensions: toPositiveInteger(
      source.embeddingDimensions,
      DEFAULT_SETTINGS.embeddingDimensions
    ),
    batchMaxLines: toPositiveInteger(
      source.batchMaxLines,
      DEFAULT_SETTINGS.batchMaxLines
    ),
    batchConcurrency: toPositiveInteger(
      source.batchConcurrency,
      DEFAULT_SETTINGS.batchConcurrency
    ),
    chunkingMaxLinesPerChunk: toPositiveInteger(
      source.chunkingMaxLinesPerChunk,
      DEFAULT_SETTINGS.chunkingMaxLinesPerChunk
    ),
    chunkingMinLinesPerChunk: toPositiveInteger(
      source.chunkingMinLinesPerChunk,
      DEFAULT_SETTINGS.chunkingMinLinesPerChunk
    ),
    chunkingMinCharsPerChunk: toPositiveInteger(
      source.chunkingMinCharsPerChunk,
      DEFAULT_SETTINGS.chunkingMinCharsPerChunk
    ),
    chunkingOverlapLines: toNonNegativeInteger(
      source.chunkingOverlapLines,
      DEFAULT_SETTINGS.chunkingOverlapLines
    ),
    rerankingModelName: toText(source.rerankingModelName).trim(),
    rerankingBaseUrl: toText(source.rerankingBaseUrl).trim(),
    rerankingApiKey: toText(source.rerankingApiKey),
    rerankingContextLength: toPositiveInteger(
      source.rerankingContextLength,
      DEFAULT_SETTINGS.rerankingContextLength
    ),
    rerankingTopN: toPositiveInteger(
      source.rerankingTopN,
      DEFAULT_SETTINGS.rerankingTopN
    ),
    configJson: toText(source.configJson, DEFAULT_SETTINGS.configJson),
    source: sourceLabel || DEFAULT_SETTINGS.source,
  };
};

const toForm = (settings: CodebaseSettingsInput) => ({
  profileName: settings.profileName,
  enabled: settings.enabled,
  enableAgentReview: settings.enableAgentReview,
  enableReranking: settings.enableReranking,
  embeddingType: settings.embeddingType,
  embeddingModelName: settings.embeddingModelName,
  embeddingBaseUrl: settings.embeddingBaseUrl,
  embeddingApiKey: settings.embeddingApiKey,
  embeddingDimensions: String(settings.embeddingDimensions),
  batchMaxLines: String(settings.batchMaxLines),
  batchConcurrency: String(settings.batchConcurrency),
  chunkingMaxLinesPerChunk: String(settings.chunkingMaxLinesPerChunk),
  chunkingMinLinesPerChunk: String(settings.chunkingMinLinesPerChunk),
  chunkingMinCharsPerChunk: String(settings.chunkingMinCharsPerChunk),
  chunkingOverlapLines: String(settings.chunkingOverlapLines),
  rerankingModelName: settings.rerankingModelName,
  rerankingBaseUrl: settings.rerankingBaseUrl,
  rerankingApiKey: settings.rerankingApiKey,
  rerankingContextLength: String(settings.rerankingContextLength),
  rerankingTopN: String(settings.rerankingTopN),
});

type CodebaseSettingsForm = ReturnType<typeof toForm>;

const toSnowCliConfigJson = (settings: CodebaseSettingsInput): string =>
  JSON.stringify({
    codebase: {
      enabled: settings.enabled,
      enableAgentReview: settings.enableAgentReview,
      enableReranking: settings.enableReranking,
      embedding: {
        type: settings.embeddingType,
        modelName: settings.embeddingModelName,
        baseUrl: settings.embeddingBaseUrl,
        apiKey: settings.embeddingApiKey,
        dimensions: settings.embeddingDimensions,
      },
      batch: {
        maxLines: settings.batchMaxLines,
        concurrency: settings.batchConcurrency,
      },
      chunking: {
        maxLinesPerChunk: settings.chunkingMaxLinesPerChunk,
        minLinesPerChunk: settings.chunkingMinLinesPerChunk,
        minCharsPerChunk: settings.chunkingMinCharsPerChunk,
        overlapLines: settings.chunkingOverlapLines,
      },
      reranking: {
        modelName: settings.rerankingModelName,
        baseUrl: settings.rerankingBaseUrl,
        apiKey: settings.rerankingApiKey,
        contextLength: settings.rerankingContextLength,
        topN: settings.rerankingTopN,
      },
    },
  });

const toSettings = (form: CodebaseSettingsForm): CodebaseSettingsInput => {
  const settings = normalizeSettings({
    profileName: form.profileName,
    enabled: form.enabled,
    enableAgentReview: form.enableAgentReview,
    enableReranking: form.enableReranking,
    embeddingType: form.embeddingType,
    embeddingModelName: form.embeddingModelName,
    embeddingBaseUrl: form.embeddingBaseUrl,
    embeddingApiKey: form.embeddingApiKey,
    embeddingDimensions: form.embeddingDimensions,
    batchMaxLines: form.batchMaxLines,
    batchConcurrency: form.batchConcurrency,
    chunkingMaxLinesPerChunk: form.chunkingMaxLinesPerChunk,
    chunkingMinLinesPerChunk: form.chunkingMinLinesPerChunk,
    chunkingMinCharsPerChunk: form.chunkingMinCharsPerChunk,
    chunkingOverlapLines: form.chunkingOverlapLines,
    rerankingModelName: form.rerankingModelName,
    rerankingBaseUrl: form.rerankingBaseUrl,
    rerankingApiKey: form.rerankingApiKey,
    rerankingContextLength: form.rerankingContextLength,
    rerankingTopN: form.rerankingTopN,
    source: "manual",
  });

  return {
    ...settings,
    configJson: toSnowCliConfigJson(settings),
  };
};

const maskSecret = (value: string): string => (value ? "********" : "-");

export function CodebaseSettingsPanel({
  onClose,
}: CodebaseSettingsPanelProps): React.JSX.Element {
  const { t } = useI18n();
  const [form, setForm] = useState<CodebaseSettingsForm>(() =>
    toForm(DEFAULT_SETTINGS)
  );
  const [lastSaved, setLastSaved] =
    useState<CodebaseSettingsInput>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setIsLoading(true);
    setError("");

    try {
      const settings = await window.snow.getCodebaseSettings();
      const normalized = normalizeSettings(settings);
      setForm(toForm(normalized));
      setLastSaved(normalized);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.codebaseLoadError", {
              defaultValue: "Failed to load codebase settings",
            })
      );
    } finally {
      setIsLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  const isBusy = isLoading || isSaving;
  const preview = toSettings(form);
  const embeddingLabel =
    EMBEDDING_TYPE_OPTIONS.find(
      (option) => option.value === preview.embeddingType
    )?.label ?? preview.embeddingType;
  const sourceLabel =
    lastSaved.source === "snow-cli"
      ? t("settings.sourceSnowCli", { defaultValue: "Snow CLI" })
      : t("settings.sourceManual", { defaultValue: "Manual" });

  const updateField =
    (field: keyof CodebaseSettingsForm) =>
    (event: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
      const value =
        event.target instanceof HTMLInputElement &&
        event.target.type === "checkbox"
          ? event.target.checked
          : event.target.value;

      setForm((previous) => ({ ...previous, [field]: value }));
    };

  const validatePositiveInteger = (
    value: string,
    message: string
  ): string | null => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? null : message;
  };

  const validate = (): string | null => {
    if (form.enabled) {
      if (!form.embeddingModelName.trim()) {
        return t("settings.codebaseValidationModelNameRequired", {
          defaultValue:
            "Embedding model name is required when codebase is enabled.",
        });
      }

      if (!form.embeddingBaseUrl.trim()) {
        return t("settings.codebaseValidationBaseUrlRequired", {
          defaultValue:
            "Embedding base URL is required when codebase is enabled.",
        });
      }
    }

    const numericChecks: Array<[string, string]> = [
      [
        form.embeddingDimensions,
        t("settings.codebaseValidationDimensionsPositive", {
          defaultValue: "Embedding dimensions must be greater than 0.",
        }),
      ],
      [
        form.batchMaxLines,
        t("settings.codebaseValidationMaxLinesPositive", {
          defaultValue: "Batch max lines must be greater than 0.",
        }),
      ],
      [
        form.batchConcurrency,
        t("settings.codebaseValidationConcurrencyPositive", {
          defaultValue: "Batch concurrency must be greater than 0.",
        }),
      ],
      [
        form.chunkingMaxLinesPerChunk,
        t("settings.codebaseValidationMaxLinesPerChunkPositive", {
          defaultValue: "Max lines per chunk must be greater than 0.",
        }),
      ],
      [
        form.chunkingMinLinesPerChunk,
        t("settings.codebaseValidationMinLinesPerChunkPositive", {
          defaultValue: "Min lines per chunk must be greater than 0.",
        }),
      ],
      [
        form.chunkingMinCharsPerChunk,
        t("settings.codebaseValidationMinCharsPerChunkPositive", {
          defaultValue: "Min chars per chunk must be greater than 0.",
        }),
      ],
    ];

    for (const [value, message] of numericChecks) {
      const validationError = validatePositiveInteger(value, message);

      if (validationError) {
        return validationError;
      }
    }

    const overlapLines = Number.parseInt(form.chunkingOverlapLines, 10);
    const maxLinesPerChunk = Number.parseInt(form.chunkingMaxLinesPerChunk, 10);

    if (!Number.isInteger(overlapLines) || overlapLines < 0) {
      return t("settings.codebaseValidationOverlapLinesNonNegative", {
        defaultValue: "Overlap lines must be 0 or greater.",
      });
    }

    if (
      Number.isInteger(maxLinesPerChunk) &&
      overlapLines >= maxLinesPerChunk
    ) {
      return t("settings.codebaseValidationOverlapLessThanMaxLines", {
        defaultValue: "Overlap lines must be less than max lines per chunk.",
      });
    }

    if (form.enabled && form.enableReranking) {
      if (!form.rerankingModelName.trim()) {
        return t("settings.codebaseValidationRerankingModelNameRequired", {
          defaultValue:
            "Reranking model name is required when reranking is enabled.",
        });
      }

      if (!form.rerankingBaseUrl.trim()) {
        return t("settings.codebaseValidationRerankingBaseUrlRequired", {
          defaultValue:
            "Reranking base URL is required when reranking is enabled.",
        });
      }

      const contextLengthError = validatePositiveInteger(
        form.rerankingContextLength,
        t("settings.codebaseValidationRerankingContextLengthPositive", {
          defaultValue: "Reranking context length must be greater than 0.",
        })
      );

      if (contextLengthError) {
        return contextLengthError;
      }

      const topNError = validatePositiveInteger(
        form.rerankingTopN,
        t("settings.codebaseValidationRerankingTopNPositive", {
          defaultValue: "Reranking top N must be greater than 0.",
        })
      );

      if (topNError) {
        return topNError;
      }
    }

    return null;
  };

  const handleSave = async () => {
    const validationError = validate();

    if (validationError) {
      setError(validationError);
      setStatus("");
      return;
    }

    const settings = toSettings(form);
    setIsSaving(true);
    setError("");
    setStatus("");

    try {
      const saved = await window.snow.upsertCodebaseSettings(settings);
      const normalized = normalizeSettings(saved);
      setForm(toForm(normalized));
      setLastSaved(normalized);
      setStatus(
        t("settings.codebaseSaveSuccess", {
          defaultValue: "Saved codebase settings.",
        })
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.codebaseSaveError", {
              defaultValue: "Failed to save codebase settings",
            })
      );
    } finally {
      setIsSaving(false);
    }
  };

  const handleImport = async () => {
    setIsLoading(true);
    setError("");
    setStatus("");

    try {
      const settings = await window.snow.importSnowCliCodebaseSettings();
      const normalized = normalizeSettings(settings);
      setForm(toForm(normalized));
      setLastSaved(normalized);
      setStatus(
        t("settings.codebaseImportSuccess", {
          defaultValue: "Synced codebase settings from Snow CLI.",
        })
      );
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : t("settings.codebaseImportError", {
              defaultValue: "Failed to sync Snow CLI codebase settings",
            })
      );
    } finally {
      setIsLoading(false);
    }
  };

  const renderTextInput = (
    field: keyof CodebaseSettingsForm,
    label: string,
    placeholder = "",
    type: "text" | "password" | "number" = "text",
    min?: number
  ) => (
    <label className="api-settings-field">
      <span>{label}</span>
      <input
        value={String(form[field])}
        onChange={updateField(field)}
        placeholder={placeholder}
        type={type}
        min={min}
        disabled={isBusy}
      />
    </label>
  );

  return (
    <div className="api-settings-page" role="region">
      <div className="api-settings-page-header">
        <div className="api-settings-title-group">
          <span className="api-settings-kicker">
            {t("settings.codebaseKicker", {
              defaultValue: "Snow CLI compatible",
            })}
          </span>
          <strong>
            {t("settings.codebaseTitle", {
              defaultValue: "Codebase settings",
            })}
          </strong>
        </div>
        {onClose && (
          <button
            className="icon-btn ghost"
            onClick={onClose}
            type="button"
            aria-label={t("settings.closeCodebaseSettings", {
              defaultValue: "Close codebase settings",
            })}
            title={t("settings.closeCodebaseSettings", {
              defaultValue: "Close codebase settings",
            })}
          >
            <X size={15} strokeWidth={1.8} />
          </button>
        )}
      </div>

      <div className="api-settings-summary-grid">
        <div className="api-settings-summary-card">
          <SearchCode size={15} strokeWidth={1.8} />
          <span>
            {preview.enabled
              ? t("settings.enabled", { defaultValue: "Enabled" })
              : t("settings.disabled", { defaultValue: "Disabled" })}
          </span>
          <small>
            {t("settings.codebaseIndexStatus", { defaultValue: "Indexing" })}
          </small>
        </div>
        <div className="api-settings-summary-card">
          <BrainCircuit size={15} strokeWidth={1.8} />
          <span>{embeddingLabel}</span>
          <small>
            {t("settings.codebaseEmbeddingProvider", {
              defaultValue: "Embedding provider",
            })}
          </small>
        </div>
        <div className="api-settings-summary-card">
          <Network size={15} strokeWidth={1.8} />
          <span>{sourceLabel}</span>
          <small>{t("settings.source", { defaultValue: "Source" })}</small>
        </div>
      </div>

      <div className="api-settings-actions">
        <button
          className="api-settings-action-btn primary"
          onClick={() => void handleImport()}
          type="button"
          disabled={isBusy}
        >
          {isLoading ? (
            <Loader2 size={15} className="spin" />
          ) : (
            <Download size={15} />
          )}
          <span>
            {t("settings.syncSnowCliCodebase", {
              defaultValue: "Sync Snow CLI codebase config",
            })}
          </span>
        </button>
      </div>

      <AutoDismissNotice
        message={error || status}
        tone={error ? "error" : "success"}
        onDismiss={() => {
          setError("");
          setStatus("");
        }}
      />

      <div className="api-settings-manual-form">
        <div className="api-settings-manual-header">
          <strong>
            {t("settings.codebaseManualTitle", {
              defaultValue: "Manual configuration",
            })}
          </strong>
          <span>
            {t("settings.codebaseManualInfo", {
              defaultValue:
                "These values are saved in the local app database and can be synced from Snow CLI settings.json files.",
            })}
          </span>
        </div>

        <div className="api-settings-form-body">
          <div className="api-settings-form-section">
            <div className="api-settings-form-section-header">
              <strong className="api-settings-form-section-title">
                {t("settings.codebaseGeneral", { defaultValue: "General" })}
              </strong>
            </div>
            <div className="api-settings-form-grid">
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={form.enabled}
                  onChange={updateField("enabled")}
                  disabled={isBusy}
                  hidden
                />
                <span className="toggle-slider" />
                <span>
                  {t("settings.codebaseEnabled", {
                    defaultValue: "Enable codebase indexing",
                  })}
                </span>
              </label>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={form.enableAgentReview}
                  onChange={updateField("enableAgentReview")}
                  disabled={isBusy}
                  hidden
                />
                <span className="toggle-slider" />
                <span>
                  {t("settings.codebaseAgentReview", {
                    defaultValue: "Enable agent review",
                  })}
                </span>
              </label>
              <label className="toggle-switch">
                <input
                  type="checkbox"
                  checked={form.enableReranking}
                  onChange={updateField("enableReranking")}
                  disabled={isBusy}
                  hidden
                />
                <span className="toggle-slider" />
                <span>
                  {t("settings.codebaseReranking", {
                    defaultValue: "Enable reranking",
                  })}
                </span>
              </label>
            </div>
          </div>

          <div className="api-settings-form-section">
            <strong className="api-settings-form-section-title">
              {t("settings.codebaseEmbeddingSettings", {
                defaultValue: "Embedding settings",
              })}
            </strong>
            <div className="api-settings-form-grid">
              <label className="api-settings-field">
                <span>
                  {t("settings.codebaseEmbeddingType", {
                    defaultValue: "Embedding type",
                  })}
                </span>
                <select
                  value={form.embeddingType}
                  onChange={updateField("embeddingType")}
                  disabled={isBusy}
                >
                  {EMBEDDING_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {renderTextInput(
                "embeddingModelName",
                t("settings.codebaseEmbeddingModelName", {
                  defaultValue: "Embedding model name",
                }),
                "jina-embeddings-v3"
              )}
              {renderTextInput(
                "embeddingBaseUrl",
                t("settings.codebaseEmbeddingBaseUrl", {
                  defaultValue: "Embedding base URL",
                }),
                "https://api.jina.ai/v1/embeddings"
              )}
              {renderTextInput(
                "embeddingDimensions",
                t("settings.codebaseEmbeddingDimensions", {
                  defaultValue: "Embedding dimensions",
                }),
                "1536",
                "number",
                1
              )}
              {renderTextInput(
                "embeddingApiKey",
                t("settings.codebaseEmbeddingApiKey", {
                  defaultValue: "Embedding API key",
                }),
                maskSecret(form.embeddingApiKey),
                "password"
              )}
            </div>
          </div>

          <div className="api-settings-form-section">
            <strong className="api-settings-form-section-title">
              {t("settings.codebaseRerankingSettings", {
                defaultValue: "Reranking settings",
              })}
            </strong>
            <div className="api-settings-form-grid">
              {renderTextInput(
                "rerankingModelName",
                t("settings.codebaseRerankingModelName", {
                  defaultValue: "Reranking model name",
                }),
                "jina-reranker-v2-base-multilingual"
              )}
              {renderTextInput(
                "rerankingBaseUrl",
                t("settings.codebaseRerankingBaseUrl", {
                  defaultValue: "Reranking base URL",
                }),
                "https://api.jina.ai/v1/rerank"
              )}
              {renderTextInput(
                "rerankingContextLength",
                t("settings.codebaseRerankingContextLength", {
                  defaultValue: "Reranking context length",
                }),
                "4096",
                "number",
                1
              )}
              {renderTextInput(
                "rerankingTopN",
                t("settings.codebaseRerankingTopN", {
                  defaultValue: "Reranking top N",
                }),
                "5",
                "number",
                1
              )}
              {renderTextInput(
                "rerankingApiKey",
                t("settings.codebaseRerankingApiKey", {
                  defaultValue: "Reranking API key",
                }),
                maskSecret(form.rerankingApiKey),
                "password"
              )}
            </div>
          </div>

          <div className="api-settings-form-section">
            <strong className="api-settings-form-section-title">
              {t("settings.codebaseBatchChunkingSettings", {
                defaultValue: "Batch and chunking",
              })}
            </strong>
            <div className="api-settings-form-grid">
              {renderTextInput(
                "batchMaxLines",
                t("settings.codebaseBatchMaxLines", {
                  defaultValue: "Batch max lines",
                }),
                "10",
                "number",
                1
              )}
              {renderTextInput(
                "batchConcurrency",
                t("settings.codebaseBatchConcurrency", {
                  defaultValue: "Batch concurrency",
                }),
                "3",
                "number",
                1
              )}
              {renderTextInput(
                "chunkingMaxLinesPerChunk",
                t("settings.codebaseChunkingMaxLinesPerChunk", {
                  defaultValue: "Max lines per chunk",
                }),
                "200",
                "number",
                1
              )}
              {renderTextInput(
                "chunkingMinLinesPerChunk",
                t("settings.codebaseChunkingMinLinesPerChunk", {
                  defaultValue: "Min lines per chunk",
                }),
                "10",
                "number",
                1
              )}
              {renderTextInput(
                "chunkingMinCharsPerChunk",
                t("settings.codebaseChunkingMinCharsPerChunk", {
                  defaultValue: "Min chars per chunk",
                }),
                "20",
                "number",
                1
              )}
              {renderTextInput(
                "chunkingOverlapLines",
                t("settings.codebaseChunkingOverlapLines", {
                  defaultValue: "Overlap lines",
                }),
                "20",
                "number",
                0
              )}
            </div>
          </div>
        </div>

        <div className="api-settings-form-actions">
          <button
            className="api-settings-form-btn secondary"
            onClick={() => setForm(toForm(lastSaved))}
            type="button"
            disabled={isBusy}
          >
            {t("settings.reset", { defaultValue: "Reset" })}
          </button>
          <button
            className="api-settings-form-btn primary"
            onClick={() => void handleSave()}
            type="button"
            disabled={isBusy}
          >
            {isSaving ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <Save size={15} strokeWidth={1.9} />
            )}
            <span>
              {t("settings.saveCodebaseSettings", {
                defaultValue: "Save settings",
              })}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
