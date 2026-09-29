import { GroupIconColorPicker } from "./GroupIconColorPicker";

export interface ProjectAppearance {
  color: string | null;
  icon: string | null;
  iconImage: string | null;
}

export interface FoundIcon {
  path: string;
  rel: string;
  dataUrl: string;
}

/** An image found in the repo, or a built-in icon and color: one or the other */
export function ProjectIconPicker({
  found,
  isLoading,
  value,
  onChange,
}: {
  found: FoundIcon[];
  isLoading: boolean;
  value: ProjectAppearance;
  onChange: (next: ProjectAppearance) => void;
}) {
  return (
    <>
      <p className="mb-1 text-[10px] uppercase tracking-wider text-text-muted">
        Found in the project
      </p>
      {isLoading ? (
        <p className="mb-3 text-[11px] text-text-muted">Looking...</p>
      ) : found.length === 0 ? (
        <p className="mb-3 text-[11px] text-text-muted">No favicon or app icon found.</p>
      ) : (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {found.map((f) => (
            <button
              key={f.path}
              type="button"
              onClick={() => onChange({ color: null, icon: null, iconImage: f.path })}
              className={
                value.iconImage === f.path
                  ? "rounded-md bg-white/10 p-1.5 ring-1 ring-accent/60"
                  : "rounded-md p-1.5 hover:bg-white/10"
              }
              title={f.rel}
            >
              <img src={f.dataUrl} alt={f.rel} className="h-7 w-7 object-contain" />
            </button>
          ))}
        </div>
      )}

      <p className="mb-1 text-[10px] uppercase tracking-wider text-text-muted">
        Built-in icon and color
      </p>
      <GroupIconColorPicker
        color={value.color}
        icon={value.icon}
        unselected={!!value.iconImage}
        // An image and a built-in icon exclude each other: picking here drops the image
        onChange={(color, icon) => onChange({ color, icon, iconImage: null })}
      />
    </>
  );
}
