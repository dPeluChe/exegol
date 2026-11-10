import { beforeEach, expect, it, vi } from "vitest";
import { noteReading } from "./reading";
import { releaseReadingMedia, syncReadingMedia } from "./reading-media";

vi.mock("../dictation/media-pause", () => ({ holdMedia: vi.fn(), mediaBackend: () => null }));

const on = () => ({ pauseMedia: true, pauseMediaDirect: false });

beforeEach(() => {
  noteReading(1, false);
  releaseReadingMedia();
});

it("holds once for readings in a row and releases when none is left", () => {
  const held = { release: vi.fn(), extend: vi.fn(() => true) };
  const start = vi.fn(() => held);
  noteReading(1, true);
  syncReadingMedia(on, start);
  syncReadingMedia(on, start);
  expect(start).toHaveBeenCalledTimes(1);
  expect(held.extend).toHaveBeenCalledTimes(1);
  noteReading(1, false);
  syncReadingMedia(on, start);
  expect(held.release).toHaveBeenCalledTimes(1);
});

it("pauses nothing when the setting is off", () => {
  const start = vi.fn();
  noteReading(1, true);
  syncReadingMedia(() => ({ pauseMedia: false, pauseMediaDirect: false }), start);
  expect(start).not.toHaveBeenCalled();
});
