import type { Message, Tokenizer } from "./tokenizer.js";
import { estimateTokens } from "./tokenizer.js";

export type Compressor = (
  messages: Message[],
  targetTokens: number,
  pinnedPrefixLen: number,
  tokenizer: Tokenizer,
) => Message[];

/**
 * Default, zero-dependency compressor. Keeps `messages[:pinnedPrefixLen]`
 * (the system message and anything before the provider's cache breakpoint)
 * untouched, then drops the oldest remaining messages until the result
 * fits `targetTokens`. Never reorders or edits a message, so it never
 * busts a cache breakpoint that falls inside the pinned prefix.
 */
export const truncateCompressor: Compressor = (
  messages,
  targetTokens,
  pinnedPrefixLen,
  tokenizer = estimateTokens,
) => {
  const pinned = messages.slice(0, pinnedPrefixLen);
  const rest = messages.slice(pinnedPrefixLen);

  if (tokenizer(pinned) >= targetTokens) {
    return pinned;
  }

  let kept: Message[] = [];
  for (let i = rest.length - 1; i >= 0; i--) {
    const candidate = [rest[i], ...kept];
    if (tokenizer([...pinned, ...candidate]) > targetTokens) break;
    kept = candidate;
  }
  return [...pinned, ...kept];
};

function isToolRelated(message: Message): boolean {
  if (message.role === "tool") return true; // OpenAI-style tool result
  const content = message.content;
  if (Array.isArray(content)) {
    return content.some(
      (block) =>
        block &&
        typeof block === "object" &&
        ((block as Record<string, unknown>).type === "tool_use" ||
          (block as Record<string, unknown>).type === "tool_result"),
    );
  }
  return false;
}

/**
 * Like `truncateCompressor`, but drops ordinary text turns before
 * tool-call/tool-result turns, since a dropped tool result usually
 * costs more (in lost signal, or a confused follow-up call) than a
 * dropped line of chat. Still zero-dependency, still never touches the
 * pinned prefix.
 *
 * Fills the budget in two passes, newest-first within each: first the
 * tool-related messages, then whatever ordinary messages still fit. The
 * result is re-sorted back into the original chronological order.
 */
export const priorityTruncateCompressor: Compressor = (
  messages,
  targetTokens,
  pinnedPrefixLen,
  tokenizer = estimateTokens,
) => {
  const pinned = messages.slice(0, pinnedPrefixLen);
  const rest = messages.slice(pinnedPrefixLen);

  if (tokenizer(pinned) >= targetTokens) {
    return pinned;
  }

  const indexed = rest.map((message, i) => ({ i, message }));
  const important = indexed.filter(({ message }) => isToolRelated(message));
  const ordinary = indexed.filter(({ message }) => !isToolRelated(message));

  const keptIndices = new Set<number>();

  function tryAdd(pool: { i: number; message: Message }[]): void {
    for (let p = pool.length - 1; p >= 0; p--) {
      const { i } = pool[p];
      const candidateIndices = [...keptIndices, i].sort((a, b) => a - b);
      const candidate = candidateIndices.map((j) => rest[j]);
      if (tokenizer([...pinned, ...candidate]) > targetTokens) continue;
      keptIndices.add(i);
    }
  }

  tryAdd(important);
  tryAdd(ordinary);

  const kept = [...keptIndices].sort((a, b) => a - b).map((j) => rest[j]);
  return [...pinned, ...kept];
};

export interface SummarizingCompressorOptions {
  keepRecent?: number;
  fallback?: Compressor;
}

/**
 * Build a `Compressor` that summarizes the turns it would otherwise
 * drop into one note, instead of losing them outright.
 *
 * `summarize(droppedMessages) -> string` is *your own* call to an LLM
 * (or any other summarizer) — thanos never calls a model itself. Keeps
 * the pinned prefix and the last `keepRecent` messages verbatim;
 * summarizes everything in between into a single system message
 * inserted right after the pinned prefix. Falls back to `fallback`
 * (default `truncateCompressor`) when there's nothing worth
 * summarizing, or the summary itself still doesn't fit.
 */
export function makeSummarizingCompressor(
  summarize: (dropped: Message[]) => string,
  options: SummarizingCompressorOptions = {},
): Compressor {
  const keepRecent = options.keepRecent ?? 4;
  const fallback = options.fallback ?? truncateCompressor;

  return (
    messages,
    targetTokens,
    pinnedPrefixLen,
    tokenizer = estimateTokens,
  ) => {
    const pinned = messages.slice(0, pinnedPrefixLen);
    const rest = messages.slice(pinnedPrefixLen);

    if (tokenizer(pinned) >= targetTokens || rest.length <= keepRecent) {
      return fallback(messages, targetTokens, pinnedPrefixLen, tokenizer);
    }

    const toSummarize = rest.slice(0, rest.length - keepRecent);
    const recent = rest.slice(rest.length - keepRecent);
    if (toSummarize.length === 0) {
      return fallback(messages, targetTokens, pinnedPrefixLen, tokenizer);
    }

    const summaryText = summarize(toSummarize);
    const summaryMessage: Message = {
      role: "system",
      content: `[Summary of ${toSummarize.length} earlier messages]\n${summaryText}`,
    };

    const candidate = [...pinned, summaryMessage, ...recent];
    if (tokenizer(candidate) <= targetTokens) {
      return candidate;
    }

    // Summary + recent still doesn't fit — truncate that, protecting
    // the summary itself the same way the real pinned prefix is
    // protected.
    return fallback(candidate, targetTokens, pinnedPrefixLen + 1, tokenizer);
  };
}
