export const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export const toText = (value: unknown, defaultValue = ""): string =>
  typeof value === "string" ? value : defaultValue;

export const toIntegerOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) ? value : null;

export const toInteger = (value: unknown, defaultValue: number): number => {
  const numberValue = typeof value === "number" ? value : Number(value);

  return Number.isInteger(numberValue) ? numberValue : defaultValue;
};

export const toPositiveInteger = (
  value: unknown,
  defaultValue: number
): number => {
  const numberValue = toInteger(value, defaultValue);

  return numberValue > 0 ? numberValue : defaultValue;
};

export const toBoolean = (value: unknown, defaultValue: boolean): boolean =>
  typeof value === "boolean" ? value : defaultValue;
