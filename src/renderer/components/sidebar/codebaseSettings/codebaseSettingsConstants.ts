import type { CodebaseSettingsInput } from "../../../../preload";

export const DEFAULT_CODEBASE_SETTINGS: CodebaseSettingsInput = {
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

export const EMBEDDING_TYPE_OPTIONS = [
  { value: "jina", label: "Jina & OpenAI" },
  { value: "ollama", label: "Ollama" },
  { value: "gemini", label: "Gemini" },
  { value: "mistral", label: "Mistral" },
];
