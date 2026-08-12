import { PermanentError, TimeoutError, TransientError, withRetry } from "./errors";

export interface AnthropicMessageResult {
  text: string;
  inputTokens: number;
  outputTokens: number;
}

export interface AnthropicCallOptions {
  apiKey: string;
  model: string;
  maxTokens: number;
  prompt: string;
  timeoutMs: number;
  /** Label for retry log lines, e.g. "scoring.tier3". */
  label: string;
  maxRetries?: number;
}

/**
 * Single entry point for Haiku/API calls (T150 closes T80): network errors,
 * timeouts and 429/5xx are TransientError and retried via withRetry; other
 * HTTP errors (401/403/400) are PermanentError and fail immediately.
 */
export async function callAnthropicMessage(
  opts: AnthropicCallOptions,
): Promise<AnthropicMessageResult> {
  return withRetry(
    async () => {
      let res: Response;
      try {
        res = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-api-key": opts.apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: opts.model,
            max_tokens: opts.maxTokens,
            messages: [{ role: "user", content: opts.prompt }],
          }),
          signal: AbortSignal.timeout(opts.timeoutMs),
        });
      } catch (err) {
        throw classifyFetchFailure(err);
      }

      if (!res.ok) {
        const message = `Anthropic API ${res.status}: ${res.statusText}`;
        if (res.status === 429 || res.status >= 500) {
          throw new TransientError(message, "ANTHROPIC_API");
        }
        throw new PermanentError(message, "ANTHROPIC_API");
      }

      const data = (await res.json()) as {
        content?: Array<{ text?: string }>;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      return {
        text: (data.content?.[0]?.text ?? "").trim(),
        inputTokens: data.usage?.input_tokens ?? 0,
        outputTokens: data.usage?.output_tokens ?? 0,
      };
    },
    { label: opts.label, maxRetries: opts.maxRetries },
  );
}

function classifyFetchFailure(err: unknown): Error {
  if (err instanceof Error) {
    if (err.name === "TimeoutError" || err.name === "AbortError") {
      return new TimeoutError(`Anthropic API request timed out: ${err.message}`, err);
    }
    // undici surfaces network failures as TypeError("fetch failed")
    if (err instanceof TypeError) {
      return new TransientError(`Anthropic API network error: ${err.message}`, "NETWORK", err);
    }
    return err;
  }
  return new Error(String(err));
}
