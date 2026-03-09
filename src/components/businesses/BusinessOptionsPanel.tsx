"use client";

import { useEffect, useState, type FormEvent } from "react";

type Props = {
  businessName: string;
  busy: boolean;
  onRename: (nextName: string) => Promise<void>;
  onDelete: () => Promise<void>;
};

export default function BusinessOptionsPanel({ businessName, busy, onRename, onDelete }: Props) {
  const [renameValue, setRenameValue] = useState(businessName);

  useEffect(() => {
    setRenameValue(businessName);
  }, [businessName]);

  async function handleRenameSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmedName = renameValue.trim();
    if (!trimmedName || trimmedName === businessName) return;

    const confirmed = window.confirm(`Rename "${businessName}" to "${trimmedName}"?`);
    if (!confirmed) return;

    await onRename(trimmedName);
  }

  async function handleDeleteClick() {
    const firstConfirmation = window.confirm(
      `Delete "${businessName}"? This will permanently remove the business and its related records.`
    );
    if (!firstConfirmation) return;

    const secondConfirmation = window.confirm(
      `Final check: are you absolutely sure you want to delete "${businessName}"?`
    );
    if (!secondConfirmation) return;

    await onDelete();
  }

  const renameDisabled = busy || !renameValue.trim() || renameValue.trim() === businessName;

  return (
    <div style={{ display: "grid", gap: 24 }}>
      <section
        style={{
          padding: 20,
          borderRadius: 12,
          border: "1px solid var(--border-subtle)",
          background: "var(--bg-primary)",
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: 8 }}>Rename Business</h3>
        <p style={{ marginTop: 0, marginBottom: 16, color: "var(--text-muted)", fontSize: "0.9rem" }}>
          Update the public name shown across finance, contracts, and business lists.
        </p>
        <form onSubmit={(event) => void handleRenameSubmit(event)} style={{ display: "grid", gap: 12, maxWidth: 480 }}>
          <input
            type="text"
            value={renameValue}
            onChange={(event) => setRenameValue(event.target.value)}
            maxLength={80}
            disabled={busy}
            aria-label="Business name"
            style={{
              padding: "10px 12px",
              borderRadius: 8,
              border: "1px solid var(--border-subtle)",
              background: "var(--bg-elevated)",
              color: "var(--text-primary)",
            }}
          />
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button type="submit" disabled={renameDisabled} style={{ padding: "8px 14px", fontWeight: 600 }}>
              Save Name
            </button>
            <button
              type="button"
              disabled={busy || renameValue === businessName}
              onClick={() => setRenameValue(businessName)}
              style={{
                padding: "8px 14px",
                background: "transparent",
                color: "var(--text-primary)",
                border: "1px solid var(--border-subtle)",
              }}
            >
              Reset
            </button>
          </div>
        </form>
      </section>

      <section
        style={{
          padding: 20,
          borderRadius: 12,
          border: "1px solid rgba(248, 113, 113, 0.25)",
          background: "rgba(248, 113, 113, 0.08)",
        }}
      >
        <h3 style={{ marginTop: 0, marginBottom: 8, color: "#fecaca" }}>Delete Business</h3>
        <p style={{ marginTop: 0, marginBottom: 16, color: "var(--text-muted)", fontSize: "0.9rem" }}>
          This action is permanent. You will be asked to confirm twice before the business is removed.
        </p>
        <button
          type="button"
          onClick={() => void handleDeleteClick()}
          disabled={busy}
          style={{
            padding: "8px 14px",
            fontWeight: 600,
            background: "rgba(248, 113, 113, 0.16)",
            color: "#fca5a5",
            border: "1px solid rgba(248, 113, 113, 0.35)",
          }}
        >
          Delete Business
        </button>
      </section>
    </div>
  );
}
