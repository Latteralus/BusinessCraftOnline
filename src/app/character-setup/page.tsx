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
    <main className="lc-auth-wrap">
      <div className="lc-page-header">
        <div>
          <h1>Character Setup</h1>
          <p>Complete this once to begin progression.</p>
        </div>
      </div>
      <section>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <input name="firstName" placeholder="First name" required />
        <input name="lastName" placeholder="Last name" required />
        <label>
          Gender
          <select name="gender" title="Gender" defaultValue="other" required>
          <option value="male">Male</option>
          <option value="female">Female</option>
          <option value="other">Other</option>
          </select>
        </label>
        <button type="submit" disabled={loading}>
          {loading ? "Saving..." : "Create character"}
        </button>
      </form>
      {error ? <p style={{ color: "#f87171" }}>{error}</p> : null}
      </section>
    </main>
  );
}
