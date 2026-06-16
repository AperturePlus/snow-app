import type { ApiConfigItem } from "./types";

const toSearchText = (value: unknown): string =>
  typeof value === "string" ? value.toLowerCase() : "";

export const filterApiConfigs = (
  configs: ApiConfigItem[],
  searchQuery: string
): ApiConfigItem[] => {
  const normalizedQuery = searchQuery.trim().toLowerCase();

  if (!normalizedQuery) {
    return configs;
  }

  return configs.filter((config) => {
    const searchableFields = [
      config.displayName,
      config.profileName,
      config.baseUrl,
      config.advancedModel,
      config.basicModel,
      config.requestMethod,
    ];

    return searchableFields.some((field) =>
      toSearchText(field).includes(normalizedQuery)
    );
  });
};
