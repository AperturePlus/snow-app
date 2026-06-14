import type { CustomHeaderSchemeRecord } from "../../../../preload";

export type HeaderPair = {
  id: string;
  key: string;
  value: string;
};

export type SchemeDraft = {
  schemeId: string;
  name: string;
  headers: HeaderPair[];
};

export type CustomHeadersStatus = {
  status: string;
  error: string;
};

export type CustomHeaderScheme = CustomHeaderSchemeRecord;
