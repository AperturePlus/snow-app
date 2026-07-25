export type MemoStatus = "pending" | "done";

export type MemoRecord = {
  id: string;
  memoId: string;
  directoryId: string;
  content: string;
  status: MemoStatus;
  createdAt: string;
  updatedAt: string;
};

export type MemoPage = {
  items: MemoRecord[];
  total: number;
  hasMore: boolean;
};

export type MemoCountSummary = {
  total: number;
  pending: number;
  done: number;
};
