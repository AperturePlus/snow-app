import type { ReactNode } from "react";

export type UserMessageProps = {
  content: string;
};

export type AiResponseSection = {
  title: string;
  body: ReactNode;
};

export type AiResponseProps = {
  title: string;
  summary: ReactNode;
  sections?: AiResponseSection[];
};
