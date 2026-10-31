export interface Message {
  role: string;
  content: unknown;
  [key: string]: unknown;
}

export type Tokenizer = (messages: Message[]) => number;

function messageText(message: Message): string {
  const { content } = message;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) => {
        if (typeof block === "string") return block;
        if (block && typeof block === "object") {
          const b = block as Record<string, unknown>;
          return String(b.text ?? b.content ?? "");
        }
        return "";
      })
      .join("");
  }
  return content == null ? "" : String(content);
}

/**
 * Fast, offline token estimate (no network call). Uses a
 * ~4-characters-per-token heuristic plus a small per-message overhead for
 * role/formatting tokens. Good enough for threshold/budget decisions; swap
 * in an exact provider token-count API via the `tokenizer` option on
 * `ContextGuard` if you need precision.
 */
export function estimateTokens(messages: Message[]): number {
  let total = 0;
  for (const message of messages) {
    const text = messageText(message);
    total += Math.max(1, Math.floor(text.length / 4));
    total += 4; // role + message formatting overhead
  }
  return total;
}
