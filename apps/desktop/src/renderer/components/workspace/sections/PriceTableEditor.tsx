import { Button, Input } from "@exegol/ui";
import { useState } from "react";
import { type ModelPrice, useModelCatalog, useUpdateModelCatalog } from "./model-pricing";

function PriceRow({
  model,
  price,
  onSave,
}: {
  model: string;
  price: ModelPrice;
  onSave: (model: string, input: number, output: number) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [inputPerM, setInputPerM] = useState((price.input * 1e6).toFixed(2));
  const [outputPerM, setOutputPerM] = useState((price.output * 1e6).toFixed(2));

  const handleSave = () => {
    const inVal = Number.parseFloat(inputPerM);
    const outVal = Number.parseFloat(outputPerM);
    if (Number.isNaN(inVal) || Number.isNaN(outVal)) return;
    onSave(model, inVal / 1e6, outVal / 1e6);
    setEditing(false);
  };

  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-bg-tertiary px-3 py-2 text-xs">
      <span className="flex-1 truncate font-medium text-text-primary">{model}</span>
      {editing ? (
        <>
          <Input
            value={inputPerM}
            onChange={(e) => setInputPerM(e.target.value)}
            className="h-6 w-20 border-[var(--border)] bg-[var(--bg-secondary)] text-xs"
          />
          <span className="text-text-muted">/</span>
          <Input
            value={outputPerM}
            onChange={(e) => setOutputPerM(e.target.value)}
            className="h-6 w-20 border-[var(--border)] bg-[var(--bg-secondary)] text-xs"
          />
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            className="h-6 bg-accent px-2 text-[10px] text-white"
          >
            Save
          </Button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="text-[10px] text-text-muted hover:text-text-secondary"
          >
            Cancel
          </button>
        </>
      ) : (
        <>
          <span className="tabular-nums text-text-muted">
            ${(price.input * 1e6).toFixed(2)}/M in · ${(price.output * 1e6).toFixed(2)}/M out
          </span>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-[10px] text-accent hover:underline"
          >
            Edit
          </button>
        </>
      )}
    </div>
  );
}

/** T147: editable provider price table, ships with defaults from settings.modelCatalog. */
export function PriceTableEditor() {
  const { data: catalog } = useModelCatalog();
  const updateCatalog = useUpdateModelCatalog();

  if (!catalog) return <p className="text-xs text-text-muted">Loading pricing...</p>;

  const handleSave = (model: string, input: number, output: number) => {
    updateCatalog.mutate({ [model]: { input, output } });
  };

  return (
    <div className="space-y-1.5">
      {Object.entries(catalog).map(([model, price]) => (
        <PriceRow key={model} model={model} price={price} onSave={handleSave} />
      ))}
    </div>
  );
}
