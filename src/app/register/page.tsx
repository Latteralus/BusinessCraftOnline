"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";

export default function RegisterPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setLoading(true);

    const formData = new FormData(event.currentTarget);
    const payload = {
      email: String(formData.get("email") ?? ""),
      password: String(formData.get("password") ?? ""),
      username: String(formData.get("username") ?? ""),
    };

    const response = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    const data = await response.json();
    setLoading(false);

    if (!response.ok) {
      setError(data.error ?? "Registration failed.");
      return;
    }

    setMessage(data.message ?? "Registration complete.");
    if (!data.requiresEmailVerification) {
      router.push("/login");
    }
  }

  return (
    <main className="lc-auth-wrap">
      <div className="lc-page-header">
        <div>
          <h1>Register</h1>
          <p>Create your LifeCraftOnline account.</p>
        </div>
      </div>
      <section>
      <form onSubmit={onSubmit} style={{ display: "grid", gap: 12 }}>
        <input name="username" placeholder="Username" required />
        <input name="email" type="email" placeholder="Email" required />
        <input name="password" type="password" placeholder="Password" required />
        <button type="submit" disabled={loading}>
          {loading ? "Creating account..." : "Create account"}
        </button>
      </form>
      {error ? <p style={{ color: "#f87171" }}>{error}</p> : null}
      {message ? <p style={{ color: "#34d399" }}>{message}</p> : null}
      <p>
        Already registered? <a href="/login">Sign in</a>
      </p>
      </section>
    </main>
  );
}
