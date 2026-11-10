import { beforeEach, describe, expect, it } from "vitest";
import { clearClips, clipKey, getClip, putClip } from "./audio-cache";

const chunk = (samples: number) => ({ samples: new Float32Array(samples), sampleRate: 24_000 });

describe("audio cache", () => {
  beforeEach(clearClips);

  it("keys a clip by its words, voice and speed", () => {
    expect(clipKey(["a", "b"], "em_alex", 1)).toBe(clipKey(["a", "b"], "em_alex", 1));
    expect(clipKey(["a", "b"], "em_alex", 1)).not.toBe(clipKey(["a", "b"], "em_santa", 1));
    expect(clipKey(["a", "b"], "em_alex", 1)).not.toBe(clipKey(["a", "b"], "em_alex", 1.1));
    expect(clipKey(["a", "b"], "em_alex", 1)).not.toBe(clipKey(["ab"], "em_alex", 1));
  });

  it("drops the clip read longest ago once over the limit, and never keeps one too large", () => {
    putClip("a", [chunk(10)], 100);
    putClip("b", [chunk(10)], 100);
    getClip("a");
    putClip("c", [chunk(10)], 100);
    expect(getClip("b")).toBeUndefined();
    expect(getClip("a")).toBeDefined();
    expect(getClip("c")).toBeDefined();
    // Put again: its bytes are counted once
    putClip("c", [chunk(10)], 100);
    putClip("d", [chunk(5)], 100);
    expect(getClip("a")).toBeDefined();
    putClip("huge", [chunk(100)], 100);
    expect(getClip("huge")).toBeUndefined();
  });
});
