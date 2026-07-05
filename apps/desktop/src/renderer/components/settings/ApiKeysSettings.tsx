import { Button, Input } from "@exegol/ui";
import { AlertTriangle, KeyRound, ShieldCheck, Trash2, X } from "lucide-react";
import { useState } from "react";
import {
  useApiKeys,
  useDeleteApiKey,
  useKeystoreEncryptionAvailable,
  useSetApiKey,
} from "../../hooks/use-trpc";

const PROVIDERS = [
  { id: "anthropic", label: "Anthropic", envVar: "ANTHROPIC_API_KEY" },
  { id: "openai", label: "OpenAI", envVar: "OPENAI_API_KEY" },
  { id: "google", label: "Google", envVar: "GOOGLE_API_KEY" },
];

function ProviderRow({
  provider,
  hasKey,
}: {
  provider: (typeof PROVIDERS)[number];
  hasKey: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const setApiKey = useSetApiKey();
  const deleteKey = useDeleteApiKey();

  const handleSave = () => {
    if (!value.trim()) return;
    setApiKey.mutate(
      { provider: provider.id, key: value.trim() },
      {
        onSuccess: () => {
          setValue("");
          setEditing(false);
        },
        onError: (err) => console.error("[ApiKeys] Save failed:", err),
      },
    );
  };

  const handleDelete = () => {
    deleteKey.mutate(
      { provider: provider.id },
      { onError: (err) => console.error("[ApiKeys] Delete failed:", err) },
    );
  };

  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-bg-tertiary px-3 py-2.5">
      <KeyRound className="h-4 w-4 shrink-0 text-text-muted" />
      <div className="flex-1">
        <div className="text-sm font-medium text-text-primary">{provider.label}</div>
        <div className="text-[10px] text-text-muted">{provider.envVar}</div>
      </div>

      {editing ? (
        <div className="flex items-center gap-1.5">
          <Input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="sk-..."
            className="h-7 w-52 border-[var(--border)] bg-[var(--bg-secondary)] text-xs text-[var(--text-primary)]"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") handleSave();
              if (e.key === "Escape") {
                setEditing(false);
                setValue("");
              }
            }}
          />
          <Button
            type="button"
            size="sm"
            onClick={handleSave}
            disabled={!value.trim() || setApiKey.isPending}
            className="h-7 bg-accent text-xs text-white"
          >
            Save
          </Button>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setValue("");
            }}
            className="p-1 text-text-muted hover:text-text-secondary"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          {hasKey ? (
            <>
              <span className="flex items-center gap-1 text-xs text-success">
                <ShieldCheck className="h-3.5 w-3.5" />
                Configured
              </span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setEditing(true)}
                className="h-7 text-xs text-[var(--text-secondary)]"
              >
                Update
              </Button>
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteKey.isPending}
                className="p-1 text-text-muted hover:text-error"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </>
          ) : (
            <>
              <span className="text-xs text-text-muted">Not set</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setEditing(true)}
                className="h-7 text-xs text-[var(--text-secondary)]"
              >
                Add key
              </Button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function ApiKeysSettings() {
  const { data: keys, isLoading } = useApiKeys();
  const { data: encryptionAvailable } = useKeystoreEncryptionAvailable();

  const keyMap = new Map(keys?.map((k) => [k.provider, k.hasKey]) ?? []);

  return (
    <div className="space-y-4 rounded-lg border border-border bg-bg-secondary p-4">
      <p className="text-xs text-text-muted">
        Keys are encrypted using your OS keychain and injected as environment variables when
        spawning agents.
      </p>

      {encryptionAvailable === false && (
        <div className="flex items-start gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-2">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" />
          <p className="text-[11px] text-warning">
            OS keychain encryption is unavailable on this system — keys will be stored in plain text
            in the local database. Avoid saving sensitive keys here.
          </p>
        </div>
      )}

      {isLoading ? (
        <p className="text-xs text-text-muted">Loading...</p>
      ) : (
        <div className="space-y-2">
          {PROVIDERS.map((provider) => (
            <ProviderRow
              key={provider.id}
              provider={provider}
              hasKey={keyMap.get(provider.id) ?? false}
            />
          ))}
        </div>
      )}
    </div>
  );
}
