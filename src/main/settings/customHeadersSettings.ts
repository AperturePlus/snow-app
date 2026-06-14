import { existsSync } from "node:fs";
import { join } from "node:path";
import type {
  CustomHeaderSchemeInput,
  CustomHeaderSchemeRecord,
  NativeBridge,
} from "../native/types";
import { SNOW_CLI_CONFIG_DIR } from "../snowCli/paths";
import { readJsonFile } from "../utils/jsonFile";
import { isRecord, toText } from "../utils/value";

const SNOW_CLI_CUSTOM_HEADERS_FILE = join(
  SNOW_CLI_CONFIG_DIR,
  "custom-headers.json"
);

type SnowCliCustomHeaderScheme = {
  id: string;
  name: string;
  headers: Record<string, string>;
  createdAt?: string;
};

type SnowCliCustomHeadersConfig = {
  active: string;
  schemes: SnowCliCustomHeaderScheme[];
};

const normalizeHeaders = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) {
    return {};
  }

  const headers: Record<string, string> = {};

  for (const [key, rawValue] of Object.entries(value)) {
    const trimmedKey = key.trim();
    if (!trimmedKey || typeof rawValue !== "string") {
      continue;
    }

    headers[trimmedKey] = rawValue.trim();
  }

  return headers;
};

const isLegacyHeadersRecord = (value: unknown): value is Record<string, unknown> =>
  isRecord(value) && !("active" in value) && !("schemes" in value);

const normalizeScheme = (
  value: unknown,
  fallbackIndex: number
): SnowCliCustomHeaderScheme | null => {
  if (!isRecord(value)) {
    return null;
  }

  const id = toText(value.id).trim() || String(Date.now() + fallbackIndex);
  const name = toText(value.name).trim() || "Unnamed Scheme";
  const headers = normalizeHeaders(value.headers);

  return {
    id,
    name,
    headers,
    createdAt: toText(value.createdAt).trim() || undefined,
  };
};

const normalizeConfig = (value: unknown): SnowCliCustomHeadersConfig => {
  if (isLegacyHeadersRecord(value)) {
    const headers = normalizeHeaders(value);

    if (Object.keys(headers).length === 0) {
      return { active: "", schemes: [] };
    }

    const defaultId = "default";
    return {
      active: defaultId,
      schemes: [
        {
          id: defaultId,
          name: "Default Headers",
          headers,
        },
      ],
    };
  }

  const source = isRecord(value) ? value : {};
  const active = toText(source.active).trim();
  const schemes: SnowCliCustomHeaderScheme[] = [];

  if (Array.isArray(source.schemes)) {
    source.schemes.forEach((item, index) => {
      const scheme = normalizeScheme(item, index);
      if (scheme) {
        schemes.push(scheme);
      }
    });
  }

  return { active, schemes };
};

const toNativeInput = (
  scheme: SnowCliCustomHeaderScheme,
  isActive: boolean,
  sortOrder: number
): CustomHeaderSchemeInput => ({
  schemeId: scheme.id,
  name: scheme.name.trim() || "Unnamed Scheme",
  headersJson: JSON.stringify(scheme.headers),
  isActive,
  sortOrder,
});

const persistCustomHeadersConfig = (
  native: NativeBridge,
  config: SnowCliCustomHeadersConfig
): void => {
  const existing = native.listCustomHeaderSchemes();
  const nextIds = new Set(config.schemes.map((scheme) => scheme.id));

  for (const item of existing) {
    if (!nextIds.has(item.schemeId)) {
      native.deleteCustomHeaderScheme(item.schemeId);
    }
  }

  config.schemes.forEach((scheme, index) => {
    native.upsertCustomHeaderScheme(
      toNativeInput(scheme, scheme.id === config.active, index)
    );
  });
};

export const readSnowCliCustomHeadersConfig = (
  native: NativeBridge
): CustomHeaderSchemeRecord[] => {
  if (!existsSync(SNOW_CLI_CUSTOM_HEADERS_FILE)) {
    return native.listCustomHeaderSchemes();
  }

  const config = readJsonFile(SNOW_CLI_CUSTOM_HEADERS_FILE);
  const normalized = normalizeConfig(config);
  persistCustomHeadersConfig(native, normalized);
  return native.listCustomHeaderSchemes();
};

const assertValidHeadersJson = (headersJson: string): void => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(headersJson || "{}");
  } catch {
    throw new Error("Headers must be valid JSON");
  }

  if (!isRecord(parsed)) {
    throw new Error("Headers must be a JSON object");
  }

  for (const [key, value] of Object.entries(parsed)) {
    if (!key.trim()) {
      throw new Error("Header name is required");
    }

    if (typeof value !== "string") {
      throw new Error("Header value must be a string");
    }
  }
};

export const normalizeCustomHeaderScheme = (
  value: unknown
): CustomHeaderSchemeInput => {
  const source = isRecord(value) ? value : {};
  const schemeId = toText(source.schemeId).trim();
  const name = toText(source.name).trim();
  const headersJson = toText(source.headersJson, "{}");
  const rawSortOrder = Number(source.sortOrder ?? 0);
  const sortOrder = Number.isInteger(rawSortOrder) ? rawSortOrder : 0;

  assertValidHeadersJson(headersJson);

  return {
    schemeId: schemeId || String(Date.now()),
    name: name || "Unnamed Scheme",
    headersJson,
    isActive: source.isActive === true,
    sortOrder,
  };
};
