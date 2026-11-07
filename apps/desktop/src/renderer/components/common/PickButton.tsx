export function PickButton({
  name,
  hint,
  disabled,
  onClick,
  children,
}: {
  name: string;
  hint?: string;
  disabled: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="flex items-center gap-2 px-3 py-1 text-left text-text-primary hover:bg-white/5 disabled:opacity-50"
    >
      {children}
      <span className="truncate">{name}</span>
      {hint && <span className="ml-auto shrink-0 text-[10px] text-text-muted">{hint}</span>}
    </button>
  );
}
