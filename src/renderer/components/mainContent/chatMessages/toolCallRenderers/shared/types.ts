export type DiffLine = {
  type: "context" | "add" | "del" | "hunk";
  content: string;
  oldNum: string;
  newNum: string;
};
