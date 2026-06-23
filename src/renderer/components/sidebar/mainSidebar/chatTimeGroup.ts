import type { ChatConversationRecord } from "../../../../preload";

export type TimeGroupKey = "today" | "yesterday" | "last7days" | "earlier";

export type TimeGroup = {
  key: TimeGroupKey;
  conversations: ChatConversationRecord[];
};

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Parse a SQLite datetime string ("YYYY-MM-DD HH:MM:SS" in UTC)
 * into a JavaScript Date object.
 */
export const parseDbTimestamp = (dateStr: string): Date => {
  if (!dateStr) {
    return new Date(0);
  }

  const normalized = dateStr.replace(" ", "T");
  return new Date(`${normalized}Z`);
};

/**
 * Determine which time group a date falls into, relative to "now".
 */
export const getTimeGroup = (date: Date, now: Date): TimeGroupKey => {
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfYesterday = new Date(startOfToday.getTime() - ONE_DAY_MS);
  const startOf7Days = new Date(startOfToday.getTime() - 6 * ONE_DAY_MS);

  if (date.getTime() >= startOfToday.getTime()) {
    return "today";
  }

  if (date.getTime() >= startOfYesterday.getTime()) {
    return "yesterday";
  }

  if (date.getTime() >= startOf7Days.getTime()) {
    return "last7days";
  }

  return "earlier";
};

/**
 * Format a short time label for display on a chat item.
 * - Today: "HH:mm"
 * - Yesterday: "昨天" / "Yesterday" (caller provides via i18n)
 * - This week: weekday name
 * - Earlier: "M/D"
 */
export const formatTimeLabel = (date: Date, now: Date): string => {
  const group = getTimeGroup(date, now);

  if (group === "today") {
    const hours = String(date.getHours()).padStart(2, "0");
    const minutes = String(date.getMinutes()).padStart(2, "0");
    return `${hours}:${minutes}`;
  }

  if (group === "yesterday") {
    return "yesterday";
  }

  if (group === "last7days") {
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return weekdays[date.getDay()];
  }

  return `${date.getMonth() + 1}/${date.getDate()}`;
};

/**
 * Group a list of conversations (already sorted by updatedAt DESC)
 * into time-based sections. Consecutive items in the same group
 * are merged into a single group entry.
 */
export const groupConversationsByTime = (
  conversations: ChatConversationRecord[],
  now: Date = new Date()
): TimeGroup[] => {
  const groups: TimeGroup[] = [];

  for (const conversation of conversations) {
    const date = parseDbTimestamp(conversation.updatedAt);
    const key = getTimeGroup(date, now);

    const lastGroup = groups[groups.length - 1];
    if (lastGroup && lastGroup.key === key) {
      lastGroup.conversations.push(conversation);
    } else {
      groups.push({ key, conversations: [conversation] });
    }
  }

  return groups;
};
