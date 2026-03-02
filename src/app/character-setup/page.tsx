"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function CharacterSetupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const formData = new FormData(event.currentTarget);
    const payload = {
      firstName: String(formData.get("firstName") ?? ""),
      lastName: String(formData.get("lastName") ?? ""),
      gender: String(formData.get("gender") ?? ""),
      currentCityId: null,
    };

    const response = await fetch("/api/character", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    setLoading(false);

    if (!response.ok && response.status !== 409) {
      setError(data.error ?? "Character setup failed.");
      return;
    }

    router.push("/dashboard");
  }

  return (
    <main style={{ maxWidth: 560, margin: "0 auto", padding: "48px 24px" }}>
      <h1>Character Setup</h1>
      <p style={{ color: "#94a3b8" }}>
        Complete this once to start Phase 1 progression.
      </p>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <input name="firstName" placeholder="First name" required />
        <input name="lastName" placeholder="Last name" required />
        <select name="gender" defaultValue="other" required>
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="other">Other</option>
        </select>
        <button type="submit" disabled={loading}>
          {loading ? "Saving..." : "Create character"}
        </button>
      </form>
      {error ? <p style={{ color: "#f87171" }}>{error}</p> : null}
    </main>
  );
}
