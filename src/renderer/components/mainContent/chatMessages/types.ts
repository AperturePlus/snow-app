export type UserMessageProps = {
  content: string;
};

export type AiResponseSection = {
  title: string;
  body: string;
};

export type AiResponseProps = {
  title?: string;
  summary: string;
  thinking?: string;
  sections?: AiResponseSection[];
  isStreaming?: boolean;
};
