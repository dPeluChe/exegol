import type { SpeechFeedbackEntry } from "@exegol/shared";

const pad = (n: number) => String(n).padStart(2, "0");

/** Local `YYYY-MM-DD HH:MM` */
export function feedbackDate(at: number): string {
  const d = new Date(at);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export const ratingLabel = (rating: SpeechFeedbackEntry["rating"]) =>
  rating === "good" ? "Good" : "Bad";

const quoted = (text: string) =>
  text
    .split("\n")
    .map((line) => (line ? `> ${line}` : ">"))
    .join("\n");

/** Every reading note for the clipboard, in the order given */
export function feedbackMarkdown(entries: SpeechFeedbackEntry[]): string {
  const parts = entries.map((e) =>
    [
      `## ${feedbackDate(e.at)}: ${ratingLabel(e.rating)}`,
      "",
      `- Voice: ${e.voice} (${e.model}), speed ${e.speed}x`,
      `- Note: ${e.note ?? "(none)"}`,
      "",
      quoted(e.spoken),
    ].join("\n"),
  );
  return [`# Reading notes (${entries.length})`, ...parts].join("\n\n").concat("\n");
}
