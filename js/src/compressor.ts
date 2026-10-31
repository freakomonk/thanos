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
