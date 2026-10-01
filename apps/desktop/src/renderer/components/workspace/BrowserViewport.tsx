import { cn } from "@exegol/ui";
import { Check, X } from "lucide-react";
import { type ReactNode, useState } from "react";
import { type PageSize, PRESET_SIZES, parseSize, sizeKey } from "../../lib/browser-viewports";
import { useBrowserSizesStore } from "../../stores/browser-sizes";

const ADD = "__add__";

/** The presets and the sizes the user added */
export function useAllSizes(): PageSize[] {
  const custom = useBrowserSizesStore((s) => s.custom);
  return [...PRESET_SIZES, ...custom];
}

/** Size picker for a browser: fit the pane, a device size, or a new one (saved for next time) */
export function ViewportSelect({
  value,
  onChange,
}: {
  value: PageSize | undefined;
  onChange: (size: PageSize | undefined) => void;
}) {
  const custom = useBrowserSizesStore((s) => s.custom);
  const [adding, setAdding] = useState(false);
  const byKey = new Map([...PRESET_SIZES, ...custom].map((s) => [sizeKey(s), s]));
  if (adding) {
    return (
      <AddSizeForm
        onDone={(size) => {
          setAdding(false);
          if (size) onChange(size);
        }}
      />
    );
  }
  const isCustom = !!value && custom.some((c) => sizeKey(c) === sizeKey(value));
  return (
    <span className="flex items-center gap-0.5">
      <select
        value={value ? sizeKey(value) : ""}
        onChange={(e) => {
          if (e.target.value === ADD) setAdding(true);
          else onChange(byKey.get(e.target.value));
        }}
        aria-label="Page size"
        title="Show the page at a device size (its responsive layout)"
        className={cn(
          "h-5 rounded border border-border bg-bg-secondary px-1 text-[10px] outline-none",
          value ? "text-accent" : "text-text-muted",
        )}
      >
        <option value="">Fit pane</option>
        {PRESET_SIZES.map((s) => (
          <option key={sizeKey(s)} value={sizeKey(s)}>
            {s.label} {s.width}
          </option>
        ))}
        {custom.length > 0 && (
          <optgroup label="Yours">
            {custom.map((s) => (
              <option key={sizeKey(s)} value={sizeKey(s)}>
                {s.label} {s.width}×{s.height}
              </option>
            ))}
          </optgroup>
        )}
        <option value={ADD}>Add a size...</option>
      </select>
      {isCustom && value && (
        <button
          type="button"
          onClick={() => {
            useBrowserSizesStore.getState().remove(value);
            onChange(undefined);
          }}
          aria-label={`Remove ${value.label} from the sizes`}
          title="Remove this size from the list"
          className="rounded p-0.5 text-text-muted hover:text-red-400"
        >
          <X className="h-3 w-3" />
        </button>
      )}
    </span>
  );
}

/** W×H and an optional name; Enter adds it to the picker */
function AddSizeForm({ onDone }: { onDone: (size: PageSize | null) => void }) {
  const add = useBrowserSizesStore((s) => s.add);
  const [text, setText] = useState("");
  const [label, setLabel] = useState("");
  const size = parseSize(text, label);
  const submit = () => {
    if (!size) return;
    add(size);
    onDone(size);
  };
  const field =
    "h-5 rounded border border-border bg-bg-secondary px-1 text-[10px] text-text-primary outline-none";
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      onKeyDown={(e) => e.key === "Escape" && onDone(null)}
    >
      <input
        // biome-ignore lint/a11y/noAutofocus: opened by choosing "Add a size", typing is next
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="1920x1080"
        aria-label="Width x height"
        className={cn(field, "w-20", text && !size && "border-red-500/60")}
      />
      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="Name"
        aria-label="Size name"
        maxLength={20}
        className={cn(field, "w-16")}
      />
      <button
        type="submit"
        disabled={!size}
        aria-label="Add size"
        className="rounded p-0.5 text-text-muted hover:text-accent disabled:opacity-40"
      >
        <Check className="h-3 w-3" />
      </button>
      <button
        type="button"
        onClick={() => onDone(null)}
        aria-label="Cancel"
        className="rounded p-0.5 text-text-muted hover:text-text-primary"
      >
        <X className="h-3 w-3" />
      </button>
    </form>
  );
}

/** The page's box: the whole area, or a device-sized frame centered in it (scrolls when the area
 *  is smaller). Same tree either way, so switching size never remounts the webview inside */
export function DeviceFrame({
  size,
  caption,
  children,
}: {
  size: PageSize | undefined;
  caption?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "h-full w-full",
        size && "flex flex-col items-center overflow-auto bg-bg-tertiary p-3",
      )}
    >
      {size && caption}
      <div
        className={cn("h-full w-full", size && "shrink-0 border border-border shadow-lg")}
        style={size ? { width: size.width, height: size.height } : undefined}
      >
        {children}
      </div>
    </div>
  );
}
