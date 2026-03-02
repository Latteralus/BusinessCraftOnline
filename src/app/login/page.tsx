"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function LoginPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    const formData = new FormData(event.currentTarget);
    const payload = {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
    };

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const data = await response.json();
    setLoading(false);

    if (!response.ok) {
      setError(data.error ?? "Sign in failed.");
      return;
    }

    if (data.needsCharacterSetup) {
      router.push("/character-setup");
      return;
    }

    router.push("/dashboard");
  }

  return (
    <main className="lc-auth-wrap">
      <div className="lc-page-header">
        <div>
          <h1>Sign in</h1>
          <p>Continue your LifeCraftOnline session.</p>
        </div>
      </div>
      <section>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <input name="email" type="email" placeholder="Email" required />
        <input name="password" type="password" placeholder="Password" required />
        <button type="submit" disabled={loading}>
          {loading ? "Signing in..." : "Sign in"}
        </button>
      </form>
      {error ? <p style={{ color: "#f87171" }}>{error}</p> : null}
      <p>
        Need an account? <a href="/register">Register</a>
      </p>
      </section>
    </main>
  );
}
