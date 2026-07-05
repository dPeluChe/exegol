import {
  EVALUATOR_HARD_MAX_LOOPS,
  type EvaluatorStepDef,
  type PipelineStepDef,
} from "@exegol/shared";

function defaultEvaluator(): EvaluatorStepDef {
  return { acceptanceCriteria: "" };
}

/** T88v2 — acceptance criteria + loop targets + judge/gate tuning for an evaluator step. */
export function EvaluatorStepFields({
  step,
  stepIndex,
  totalSteps,
  onLabelChange,
  onChange,
}: {
  step: PipelineStepDef;
  stepIndex: number;
  totalSteps: number;
  onLabelChange: (label: string) => void;
  onChange: (evaluator: EvaluatorStepDef) => void;
}) {
  const evaluator = step.evaluator ?? defaultEvaluator();
  const stepOptions = Array.from({ length: totalSteps }, (_, si) => si).filter(
    (si) => si !== stepIndex,
  );

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={step.label}
        onChange={(e) => onLabelChange(e.target.value)}
        placeholder="Label"
        className="w-full rounded border border-border bg-bg-primary px-2 py-1.5 text-[11px] text-text-primary placeholder:text-text-muted/50 focus:border-accent focus:outline-none"
      />
      <textarea
        value={evaluator.acceptanceCriteria}
        onChange={(e) => onChange({ ...evaluator, acceptanceCriteria: e.target.value })}
        placeholder="Acceptance criteria — what does 'done' look like for this diff?"
        className="w-full rounded border border-border bg-bg-primary px-2 py-1.5 text-[10px] text-text-primary placeholder:text-text-muted/40 focus:border-accent focus:outline-none"
        rows={2}
      />
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-1.5 text-[10px] text-text-muted">
          On pass →
          <select
            value={evaluator.onPassNext ?? -1}
            onChange={(e) => {
              const val = Number(e.target.value);
              onChange({ ...evaluator, onPassNext: val >= 0 ? val : undefined });
            }}
            className="rounded border border-border bg-bg-primary px-1.5 py-0.5 text-[10px] text-text-primary focus:outline-none"
          >
            <option value={-1}>Next step</option>
            {stepOptions.map((si) => (
              <option key={`pass-${si}`} value={si}>
                Step {si + 1}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[10px] text-text-muted">
          On retry →
          <select
            value={evaluator.onFailNext ?? -1}
            onChange={(e) => {
              const val = Number(e.target.value);
              onChange({ ...evaluator, onFailNext: val >= 0 ? val : undefined });
            }}
            className="rounded border border-border bg-bg-primary px-1.5 py-0.5 text-[10px] text-text-primary focus:outline-none"
          >
            <option value={-1}>Pause (no loop)</option>
            {stepOptions.map((si) => (
              <option key={`fail-${si}`} value={si}>
                Step {si + 1}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-[10px] text-text-muted">
          Max loops
          <input
            type="number"
            min={1}
            max={EVALUATOR_HARD_MAX_LOOPS}
            value={evaluator.maxLoops ?? EVALUATOR_HARD_MAX_LOOPS}
            onChange={(e) => onChange({ ...evaluator, maxLoops: Number(e.target.value) })}
            className="w-14 rounded border border-border bg-bg-primary px-1.5 py-0.5 text-[10px] text-text-primary focus:outline-none"
          />
        </label>
        <label className="flex items-center gap-1.5 text-[10px] text-text-muted">
          Judge calls
          <input
            type="number"
            min={1}
            max={9}
            value={evaluator.judgeCalls ?? 3}
            onChange={(e) => onChange({ ...evaluator, judgeCalls: Number(e.target.value) })}
            className="w-14 rounded border border-border bg-bg-primary px-1.5 py-0.5 text-[10px] text-text-primary focus:outline-none"
          />
        </label>
      </div>
    </div>
  );
}
