import type { CustomHeaderSchemeRecord } from "../../../../preload";
import type { HeaderPair, SchemeDraft } from "./types";

export const EMPTY_CUSTOM_HEADERS_DRAFT: SchemeDraft = {
  schemeId: "",
  name: "",
  headers: [],
};

export const createHeaderPair = (key = "", value = ""): HeaderPair => ({
  id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
  key,
  value,
});

export const parseHeadersJson = (headersJson: string): Record<string, string> => {
  try {
    const parsed = JSON.parse(headersJson || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }

    return Object.entries(parsed).reduce<Record<string, string>>(
      (headers, [key, value]) => {
        if (typeof value === "string") {
          headers[key] = value;
        }
        return headers;
      },
      {}
    );
  } catch {
    return {};
  }
};

export const toHeaderPairs = (headersJson: string): HeaderPair[] =>
  Object.entries(parseHeadersJson(headersJson)).map(([key, value]) =>
    createHeaderPair(key, value)
  );

export const toHeadersJson = (pairs: HeaderPair[]): string => {
  const headers: Record<string, string> = {};

  pairs.forEach((pair) => {
    const key = pair.key.trim();
    if (key) {
      headers[key] = pair.value.trim();
    }
  });

  return JSON.stringify(headers);
};

export const getHeaderCount = (scheme: CustomHeaderSchemeRecord): number =>
  Object.keys(parseHeadersJson(scheme.headersJson)).length;

export const getHeaderPreview = (scheme: CustomHeaderSchemeRecord): string =>
  Object.entries(parseHeadersJson(scheme.headersJson))
    .slice(0, 2)
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ");

export const hasDuplicateHeaderKey = (pairs: HeaderPair[]): boolean => {
  const keys = pairs.map((pair) => pair.key.trim()).filter(Boolean);
  return keys.some((key, index) => keys.indexOf(key) !== index);
};
