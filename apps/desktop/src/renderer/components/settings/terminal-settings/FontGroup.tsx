import { FontCard } from "./FontCard";
import type { RecommendedFont } from "./recommended-fonts";

interface FontGroupProps {
  title: string;
  subtitle: string;
  fonts: RecommendedFont[];
  fontStatus: Record<string, boolean>;
  activeFamily: string;
  nerdPreview: string;
  plainPreview: string;
  onSelect: (family: string) => void;
  onDeselect: (family: string) => void;
  trailing?: React.ReactNode;
}

export function FontGroup({
  title,
  subtitle,
  fonts,
  fontStatus,
  activeFamily,
  nerdPreview,
  plainPreview,
  onSelect,
  onDeselect,
  trailing,
}: FontGroupProps) {
  if (fonts.length === 0) return null;
  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <div>
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">
            {title}
          </h3>
          <p className="text-[9px] text-text-muted/70">{subtitle}</p>
        </div>
        {trailing}
      </div>
      <div className="space-y-1">
        {fonts.map((font) => {
          // Normalize both sides of the comparison so quoted, unquoted,
          // and differently-cased entries all match. Must match
          // normalizeFamily in the parent component.
          const targetKey = font.family
            .trim()
            .replace(/^["']|["']$/g, "")
            .toLowerCase();
          const chain = activeFamily
            .split(",")
            .map((s) =>
              s
                .trim()
                .replace(/^["']|["']$/g, "")
                .toLowerCase(),
            )
            .filter(Boolean);
          const isActive = chain.includes(targetKey);
          return (
            <FontCard
              key={font.family}
              font={font}
              installed={fontStatus[font.family] ?? false}
              isActive={isActive}
              nerdPreview={nerdPreview}
              plainPreview={plainPreview}
              onSelect={onSelect}
              onDeselect={onDeselect}
            />
          );
        })}
      </div>
    </div>
  );
}
