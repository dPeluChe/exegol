import {
  DICTATION_VOCABULARY_BOOST_LABELS,
  DICTATION_VOCABULARY_BOOSTS,
  DICTATION_VOCABULARY_MAX,
  type DictationSettings as DictationPrefs,
  parseVocabulary,
} from "@exegol/shared";
import { useState } from "react";
import { useProjects } from "../../hooks/use-trpc";
import { useDictationStatus } from "../../hooks/use-trpc-dictation";
import { SECTION_HEADING, SelectRow, SwitchRow } from "./settings-ui";

const BOX =
  "w-full resize-y rounded-xl border border-border bg-bg-secondary px-3 py-2 font-mono text-[11px] text-text-primary placeholder:text-text-muted focus:border-accent/50 focus:outline-none";

/** Spoken punctuation and the terms recognition is biased toward (global and per project) */
export function DictationVocabulary({
  prefs,
  set,
}: {
  prefs: DictationPrefs;
  set: (patch: Partial<DictationPrefs>) => void;
}) {
  const { data: status } = useDictationStatus();
  const { data: projects } = useProjects();
  const [projectId, setProjectId] = useState("");
  const projectTerms = projectId ? (prefs.projectVocabulary[projectId] ?? []) : [];

  const saveProject = (terms: string[]) => {
    const { [projectId]: _old, ...rest } = prefs.projectVocabulary;
    set({ projectVocabulary: terms.length > 0 ? { ...rest, [projectId]: terms } : rest });
  };

  return (
    <div>
      <h3 className={SECTION_HEADING}>Vocabulary</h3>
      <div className="space-y-2">
        <SwitchRow
          label="Spoken punctuation"
          description='Say "coma", "punto", "nueva línea" or "comma", "period", "new line" to write them. "punto" and "period" count only at the end of a sentence; after "el", "la", "the"... they stay words'
          value={prefs.spokenPunctuation}
          onToggle={() => set({ spokenPunctuation: !prefs.spokenPunctuation })}
        />
        <TermsBox
          key="global"
          terms={prefs.vocabulary}
          placeholder={"worktree\npull request\nExegol"}
          onSave={(vocabulary) => set({ vocabulary })}
        />
        <p className="text-[10px] text-text-muted">
          One term per line (up to {DICTATION_VOCABULARY_MAX}), written as it should come out. Used
          by Parakeet TDT v3 (hotwords) and Qwen3-ASR (prompt); Whisper, Nemotron and Moonshine
          ignore it.
          {status && !status.model.vocabulary && (
            <span className="text-warning">
              {" "}
              The current model ({status.model.name}) ignores it.
            </span>
          )}
        </p>
        <SelectRow
          label="Boost"
          value={prefs.vocabularyBoost}
          options={DICTATION_VOCABULARY_BOOSTS.map((b, i) => [
            b,
            DICTATION_VOCABULARY_BOOST_LABELS[i] ?? String(b),
          ])}
          onChange={(vocabularyBoost) => set({ vocabularyBoost })}
        />
        <SelectRow
          label="Extra terms for a project"
          value={projectId}
          options={[
            ["", "Pick a project"],
            ...(projects ?? []).map((p): [string, string] => [
              p.id,
              `${p.name}${prefs.projectVocabulary[p.id]?.length ? ` (${prefs.projectVocabulary[p.id]?.length})` : ""}`,
            ]),
          ]}
          onChange={setProjectId}
        />
        {projectId && (
          <TermsBox
            key={projectId}
            terms={projectTerms}
            placeholder="Terms added when dictating into this project"
            onSave={saveProject}
          />
        )}
      </div>
    </div>
  );
}

/** Edited as text, saved as a list on blur: a save per key would eat the new line being typed */
function TermsBox({
  terms,
  placeholder,
  onSave,
}: {
  terms: string[];
  placeholder: string;
  onSave: (terms: string[]) => void;
}) {
  const [text, setText] = useState(terms.join("\n"));
  return (
    <textarea
      className={BOX}
      rows={5}
      spellCheck={false}
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => {
        const next = parseVocabulary(text);
        setText(next.join("\n"));
        if (next.join("\n") !== terms.join("\n")) onSave(next);
      }}
    />
  );
}
