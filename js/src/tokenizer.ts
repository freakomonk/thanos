import { createRequire } from "node:module";

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

/**
 * Build a `Tokenizer` backed by `js-tiktoken`, for exact (or near-exact)
 * counts on OpenAI-family models. Not Claude's tokenizer — that isn't
 * public. (There's no JS equivalent of Python's
 * `anthropic_count_tokens_tokenizer`: Anthropic's count-tokens call is
 * async, and `Tokenizer`/`prepare()` here are synchronous by design. For
 * an exact Claude count, call the API yourself and reconcile afterward
 * with `ContextGuard.recordActual()` instead of pre-counting.)
 *
 * Requires `npm install js-tiktoken` — not a dependency of `thanos`
 * itself, so this throws a clear error if it's missing rather than
 * forcing the install on everyone.
 */
export function tiktokenTokenizer(
  model = "gpt-5",
  encodingName?: string,
): Tokenizer {
  // Loaded via createRequire (sync) rather than a dynamic import, so this
  // factory can stay synchronous like every other Tokenizer here.
  const req = createRequire(import.meta.url);

  let tiktoken: {
    getEncoding: (name: string) => { encode: (text: string) => unknown[] };
    encodingForModel: (model: string) => {
      encode: (text: string) => unknown[];
    };
  };
  try {
    tiktoken = req("js-tiktoken");
  } catch {
    throw new Error(
      "tiktokenTokenizer requires the `js-tiktoken` package. Install it with " +
        "`npm install js-tiktoken`.",
    );
  }

  const encoding = encodingName
    ? tiktoken.getEncoding(encodingName)
    : (() => {
        try {
          return tiktoken.encodingForModel(model);
        } catch {
          return tiktoken.getEncoding("o200k_base");
        }
      })();

  return (messages: Message[]) => {
    let total = 0;
    for (const message of messages) {
      total += encoding.encode(messageText(message)).length;
      total += 4; // role + message formatting overhead, same as estimateTokens
    }
    return total;
  };
}
