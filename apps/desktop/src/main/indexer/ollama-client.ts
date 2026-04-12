/**
 * T100: Ollama embedding client. Generates vector embeddings for code
 * chunks using a local Ollama instance.
 *
 * Verifies Ollama availability + model presence before use.
 */

import { logger } from "../lib/logger";

const DEFAULT_OLLAMA_URL = "http://localhost:11434";
const DEFAULT_MODEL = "nomic-embed-text";

export interface OllamaConfig {
  url: string;
  model: string;
}

export interface OllamaStatus {
  available: boolean;
  modelInstalled: boolean;
  version?: string;
  error?: string;
}

/** Check if Ollama is running and the embedding model is available */
export async function checkOllamaStatus(
  config: OllamaConfig = { url: DEFAULT_OLLAMA_URL, model: DEFAULT_MODEL },
): Promise<OllamaStatus> {
  try {
    // Check if Ollama is running
    const versionRes = await fetch(`${config.url}/api/version`, {
      signal: AbortSignal.timeout(3000),
    });
    if (!versionRes.ok) {
      return { available: false, modelInstalled: false, error: "Ollama not responding" };
    }
    const versionData = (await versionRes.json()) as { version?: string };

    // Check if the model is installed
    const modelsRes = await fetch(`${config.url}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!modelsRes.ok) {
      return {
        available: true,
        modelInstalled: false,
        version: versionData.version,
        error: "Could not list models",
      };
    }
    const modelsData = (await modelsRes.json()) as {
      models?: Array<{ name: string }>;
    };
    const installed = modelsData.models?.some(
      (m) => m.name === config.model || m.name.startsWith(`${config.model}:`),
    );

    return {
      available: true,
      modelInstalled: !!installed,
      version: versionData.version,
      error: installed
        ? undefined
        : `Model "${config.model}" not installed. Run: ollama pull ${config.model}`,
    };
  } catch (err) {
    return {
      available: false,
      modelInstalled: false,
      error: `Cannot connect to Ollama at ${config.url}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Generate an embedding vector for a text chunk */
export async function generateEmbedding(
  text: string,
  config: OllamaConfig = { url: DEFAULT_OLLAMA_URL, model: DEFAULT_MODEL },
): Promise<number[] | null> {
  try {
    const res = await fetch(`${config.url}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: config.model, input: text }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      logger.warn(`[Indexer] Ollama embed failed: ${res.status} ${res.statusText}`);
      return null;
    }
    const data = (await res.json()) as { embeddings?: number[][] };
    return data.embeddings?.[0] ?? null;
  } catch (err) {
    logger.warn(
      `[Indexer] Ollama embed error: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  }
}

/** Generate embeddings for multiple texts in a single batch call */
export async function generateEmbeddingsBatch(
  texts: string[],
  config: OllamaConfig = { url: DEFAULT_OLLAMA_URL, model: DEFAULT_MODEL },
): Promise<(number[] | null)[]> {
  // Ollama's /api/embed supports array input for batching
  try {
    const res = await fetch(`${config.url}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: config.model, input: texts }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      logger.warn(`[Indexer] Ollama batch embed failed: ${res.status}`);
      return texts.map(() => null);
    }
    const data = (await res.json()) as { embeddings?: number[][] };
    if (!data.embeddings) return texts.map(() => null);
    return data.embeddings;
  } catch (err) {
    logger.warn(`[Indexer] Ollama batch error: ${err}`);
    return texts.map(() => null);
  }
}
