import type { SpeechFeedbackEntry } from "@exegol/shared";
import { describe, expect, it } from "vitest";
import { feedbackDate, feedbackMarkdown } from "./speech-feedback";

const at = new Date(2026, 10, 10, 9, 5).getTime();

const entry = (over: Partial<SpeechFeedbackEntry> = {}): SpeechFeedbackEntry => ({
  id: 1,
  at,
  agentId: "a1",
  turnId: "t1",
  rating: "bad",
  note: "said almohadilla 37",
  voice: "ef_dora",
  speed: 1.1,
  model: "kokoro-multi",
  spoken: "Merged #37.\n\nIt cost $4.",
  ...over,
});

describe("feedbackMarkdown", () => {
  it("writes date, mark, voice, note and the spoken text quoted", () => {
    expect(feedbackDate(at)).toBe("2026-11-10 09:05");
    expect(
      feedbackMarkdown([entry(), entry({ id: 2, rating: "good", note: null, spoken: "Done." })]),
    ).toBe(`# Reading notes (2)

## 2026-11-10 09:05: Bad

- Voice: ef_dora (kokoro-multi), speed 1.1x
- Note: said almohadilla 37

> Merged #37.
>
> It cost $4.

## 2026-11-10 09:05: Good

- Voice: ef_dora (kokoro-multi), speed 1.1x
- Note: (none)

> Done.
`);
  });
});
