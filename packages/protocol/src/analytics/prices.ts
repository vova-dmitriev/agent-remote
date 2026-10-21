/** Dollars per million tokens. */
export interface TokenPrice {
  input: number;
  output: number;
  cacheRead: number;
  /** Claude 5-minute cache write; OpenAI 30-minute write. */
  cacheWrite: number;
  /** Claude 1-hour cache write; OpenAI 12-hour write. */
  cacheWriteLong: number;
}

export interface ModelPrice extends TokenPrice {
  /** A request whose prompt (input, cache reads and writes) is over `above` tokens pays `price` instead. */
  long?: { above: number; price: TokenPrice };
}

/** Tokens of one request, or a sum of requests priced alike. */
export interface PricedUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cacheWriteLong: number;
}

const price = (
  input: number,
  cacheWrite: number,
  cacheWriteLong: number,
  cacheRead: number,
  output: number,
) => ({
  input,
  output,
  cacheRead,
  cacheWrite,
  cacheWriteLong,
});

/**
 * Standard-tier API prices, columns in the order of the Anthropic table: input, short cache write, long cache write,
 * cache read, output.
 * Claude: https://platform.claude.com/docs/en/about-claude/pricing (2026-10-21).
 * OpenAI: https://developers.openai.com/api/docs/pricing (2026-10-21); a model without cache-write prices there
 * takes its input price for writes, which Codex does not report anyway.
 * ponytail: OpenAI's over-272K prices are not applied; add `long` once they are checked against the page.
 */
const PRICES: Readonly<Record<string, ModelPrice>> = {
  'claude-fable-5-1': price(10, 12.5, 20, 0.25, 50),
  'claude-fable-5': price(10, 12.5, 20, 1, 50),
  'claude-opus-5-5': price(4, 5, 8, 0.2, 20),
  'claude-opus-5': price(5, 6.25, 10, 0.5, 25),
  'claude-opus-4-8': price(5, 6.25, 10, 0.5, 25),
  'claude-opus-4-7': price(5, 6.25, 10, 0.5, 25),
  'claude-opus-4-6': price(5, 6.25, 10, 0.5, 25),
  'claude-opus-4-5': price(5, 6.25, 10, 0.5, 25),
  'claude-sonnet-5-5': price(2, 2.5, 4, 0.1, 10),
  'claude-sonnet-5': price(2, 2.5, 4, 0.2, 10),
  'claude-sonnet-4-6': price(3, 3.75, 6, 0.3, 15),
  'claude-sonnet-4-5': price(3, 3.75, 6, 0.3, 15),
  'claude-haiku-5-5': {
    ...price(0.1, 0.125, 0.2, 0.01, 0.5),
    long: { above: 100_000, price: price(0.5, 0.625, 1, 0.05, 2.5) },
  },
  'claude-haiku-4-5': price(1, 1.25, 2, 0.1, 5),
  'gpt-6-astra': price(10, 12.5, 25, 1, 50),
  'gpt-6.1-sol': price(2, 2.5, 5, 0.1, 10),
  'gpt-6-sol': price(2, 2.5, 2.5, 0.2, 10),
  'gpt-6-luna': price(0.1, 0.125, 0.25, 0.01, 0.5),
  'gpt-5.6-sol': price(4, 5, 10, 0.4, 20),
  'gpt-5.5': price(5, 5, 5, 0.5, 30),
  'gpt-5.4': price(2.5, 2.5, 2.5, 0.25, 15),
  'gpt-5.3-codex': price(1.75, 1.75, 1.75, 0.175, 14),
};

/** What may follow a priced id and still name the same model: a release date or a context tag like `[1m]`. */
const SAME_MODEL_SUFFIX = /^(?:-\d{4}-?\d{2}-?\d{2})?(?:\[[^\]]*\])?$/u;

/** The price of a model id, or undefined for a model not in the table: never another model's price. */
export function priceFor(model: string): ModelPrice | undefined {
  const id = Object.keys(PRICES).find(
    (key) => model.startsWith(key) && SAME_MODEL_SUFFIX.test(model.slice(key.length)),
  );

  return id ? PRICES[id] : undefined;
}

const MILLION = 1_000_000;

/** API-equivalent dollars for `usage` at `price`, with the long-context price when its prompt is over the line. */
export function costUsd(usage: PricedUsage, price: ModelPrice) {
  const prompt = usage.input + usage.cacheRead + usage.cacheWrite + usage.cacheWriteLong;
  const rate = price.long && prompt > price.long.above ? price.long.price : price;

  return (
    (usage.input * rate.input +
      usage.output * rate.output +
      usage.cacheRead * rate.cacheRead +
      usage.cacheWrite * rate.cacheWrite +
      usage.cacheWriteLong * rate.cacheWriteLong) /
    MILLION
  );
}
