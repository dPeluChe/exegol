import { afterEach, describe, expect, it, vi } from "vitest";
import { generateEmbeddingsBatch } from "./ollama-client";

const reply = (body: unknown, ok = true) =>
  vi.fn(
    async (_url: string, _init?: RequestInit) =>
      ({ ok, status: ok ? 200 : 500, json: async () => body }) as Response,
  );

afterEach(() => vi.unstubAllGlobals());

describe("generateEmbeddingsBatch", () => {
  it("sends every chunk in one request and returns the vectors in order", async () => {
    const fetchMock = reply({ embeddings: [[1], [2], [3]] });
    vi.stubGlobal("fetch", fetchMock);
    expect(await generateEmbeddingsBatch(["a", "b", "c"])).toEqual([[1], [2], [3]]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body as string).input).toEqual(["a", "b", "c"]);
  });

  it("a count that does not match the chunks is not guessed: all null", async () => {
    vi.stubGlobal("fetch", reply({ embeddings: [[1], [2]] }));
    expect(await generateEmbeddingsBatch(["a", "b", "c"])).toEqual([null, null, null]);
  });

  it("Ollama down or failing: all null, never a throw", async () => {
    vi.stubGlobal("fetch", reply({}, false));
    expect(await generateEmbeddingsBatch(["a"])).toEqual([null]);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNREFUSED");
      }),
    );
    expect(await generateEmbeddingsBatch(["a", "b"])).toEqual([null, null]);
  });
});
