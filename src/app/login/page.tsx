"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useState, ChangeEvent } from "react";

export default function LoginPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [formData, setFormData] = useState({ username: "", password: "" });

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(formData),
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

  const handleChange = (e: ChangeEvent<HTMLInputElement>) =>
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));

  const spark = [38, 45, 42, 55, 50, 62, 58, 70, 65, 78, 74, 85];

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&family=DM+Mono:wght@400;500&display=swap');

        *, *::before, *::after { margin:0; padding:0; box-sizing:border-box; }

        :root {
          --bg:        #080c14;
          --surface:   #0f1520;
          --surface-2: #151d2b;
          --surface-3: #1a2435;
          --border:    #1a2332;
          --border-h:  #243044;
          --text:      #cdd6e0;
          --text-bright:#e8edf3;
          --text-dim:  #4e6076;
          --accent:    #2dd4a0;
          --accent-dim:#22a87e;
          --accent-glow:rgba(45,212,160,.07);
          --danger:    #f87171;
          --yellow:    #fbbf24;
        }

        body {
          background: var(--bg);
          color: var(--text);
          font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
          min-height: 100vh;
          overflow-x: hidden;
        }

        .lco-shell {
          display: grid;
          grid-template-columns: 1fr 1fr;
          min-height: 100vh;
        }
        @media (max-width: 900px) {
          .lco-shell { grid-template-columns: 1fr; }
          .lco-left { display: none; }
        }

        .lco-topbar {
          position: fixed;
          top: 0;
          left: 0;
          right: 0;
          height: 48px;
          background: var(--surface);
          border-bottom: 1px solid var(--border);
          display: flex;
          align-items: center;
          padding: 0 20px;
          z-index: 100;
          gap: 16px;
        }
        .lco-topbar-logo {
          display: flex;
          align-items: center;
          gap: 0;
          font-weight: 700;
          font-size: 14px;
          color: var(--text-bright);
          letter-spacing: -.01em;
          white-space: nowrap;
        }
        .lco-topbar-logo span:first-child { color: var(--accent); }
        .lco-topbar-badge {
          background: var(--surface-2);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 3px 10px;
          font-size: 11px;
          color: var(--text-dim);
          margin-left: 12px;
        }
        .lco-topbar-right {
          margin-left: auto;
          display: flex;
          align-items: center;
          gap: 10px;
        }
        .lco-topbar-status {
          width: 7px;
          height: 7px;
          background: var(--accent);
          border-radius: 50%;
          box-shadow: 0 0 6px rgba(45,212,160,.4);
          animation: lco-pulse 2s ease infinite;
        }
        @keyframes lco-pulse {
          0%,100% { opacity:1; }
          50%     { opacity:.4; }
        }
        .lco-topbar-status-text {
          font-size: 12px;
          color: var(--text-dim);
        }

        .lco-left {
          padding: 48px 0 0 0;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          border-right: 1px solid var(--border);
          position: relative;
          overflow: hidden;
        }
        .lco-left::before {
          content: '';
          position: absolute;
          inset: 0;
          background:
            radial-gradient(ellipse at 40% 70%, rgba(45,212,160,.05) 0%, transparent 55%),
            radial-gradient(ellipse at 80% 20%, rgba(45,212,160,.03) 0%, transparent 50%);
          pointer-events: none;
        }

        .lco-left-inner {
          position: relative;
          z-index: 1;
          padding: 48px;
          width: 100%;
          max-width: 520px;
        }

        .lco-hero-label {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          background: var(--surface-2);
          border: 1px solid var(--border);
          border-radius: 6px;
          padding: 5px 12px;
          font-size: 11px;
          font-weight: 600;
          color: var(--accent);
          text-transform: uppercase;
          letter-spacing: .06em;
          margin-bottom: 24px;
        }
        .lco-hero-label::before {
          content: '';
          width: 6px;
          height: 6px;
          background: var(--accent);
          border-radius: 50%;
        }

        .lco-hero-title {
          font-size: 36px;
          font-weight: 700;
          line-height: 1.2;
          letter-spacing: -.03em;
          color: var(--text-bright);
          margin-bottom: 14px;
        }
        .lco-hero-title em {
          font-style: normal;
          color: var(--accent);
        }
        .lco-hero-sub {
          font-size: 14px;
          line-height: 1.7;
          color: var(--text-dim);
          max-width: 400px;
          margin-bottom: 36px;
        }

        .lco-stat-row {
          display: grid;
          grid-template-columns: 1fr 1fr 1fr;
          gap: 12px;
          margin-bottom: 28px;
        }
        .lco-stat-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 16px;
          display: flex;
          flex-direction: column;
          gap: 2px;
        }
        .lco-stat-card-label {
          font-size: 10px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: .07em;
          color: var(--text-dim);
        }
        .lco-stat-card-val {
          font-family: 'DM Mono', monospace;
          font-size: 20px;
          font-weight: 500;
          color: var(--text-bright);
          letter-spacing: -.02em;
        }
        .lco-stat-card-val .lco-up {
          color: var(--accent);
          font-size: 11px;
          margin-left: 4px;
        }

        .lco-chart-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 16px 16px 12px;
        }
        .lco-chart-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          margin-bottom: 12px;
        }
        .lco-chart-title {
          font-size: 12px;
          font-weight: 600;
          color: var(--text);
          display: flex;
          align-items: center;
          gap: 6px;
        }
        .lco-chart-title svg { color: var(--text-dim); }
        .lco-chart-badge {
          font-family: 'DM Mono', monospace;
          font-size: 11px;
          color: var(--accent);
          background: rgba(45,212,160,.08);
          border: 1px solid rgba(45,212,160,.15);
          border-radius: 5px;
          padding: 2px 8px;
        }
        .lco-chart-card svg { display: block; width: 100%; }

        .lco-right {
          padding: 48px 0 0 0;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          position: relative;
        }

        .lco-mobile-brand {
          display: none;
          font-weight: 700;
          font-size: 16px;
          color: var(--text-bright);
          margin-bottom: 32px;
        }
        .lco-mobile-brand span { color: var(--accent); }
        @media (max-width: 900px) {
          .lco-mobile-brand { display: block; }
        }

        .lco-auth-box {
          width: 100%;
          max-width: 380px;
          padding: 0 24px;
        }

        .lco-auth-header { margin-bottom: 32px; }
        .lco-auth-title {
          font-size: 22px;
          font-weight: 700;
          color: var(--text-bright);
          letter-spacing: -.02em;
          margin-bottom: 6px;
        }
        .lco-auth-desc {
          font-size: 13px;
          color: var(--text-dim);
        }

        .lco-form { display: flex; flex-direction: column; gap: 16px; }

        .lco-field { display: flex; flex-direction: column; gap: 5px; }
        .lco-label {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: .06em;
          color: var(--text-dim);
        }
        .lco-input {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 8px;
          padding: 11px 14px;
          font-size: 14px;
          color: var(--text-bright);
          font-family: 'DM Sans', sans-serif;
          outline: none;
          transition: border-color .2s, box-shadow .2s;
        }
        .lco-input::placeholder { color: var(--text-dim); opacity: .6; }
        .lco-input:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 2px rgba(45,212,160,.1);
        }

        .lco-btn {
          background: var(--accent);
          border: none;
          border-radius: 8px;
          padding: 11px 20px;
          font-size: 14px;
          font-weight: 600;
          font-family: 'DM Sans', sans-serif;
          color: var(--bg);
          cursor: pointer;
          transition: background .15s, transform .1s, box-shadow .2s;
          margin-top: 4px;
          position: relative;
          overflow: hidden;
        }
        .lco-btn:hover:not(:disabled) {
          background: #38e8b0;
          box-shadow: 0 4px 16px rgba(45,212,160,.2);
          transform: translateY(-1px);
        }
        .lco-btn:active:not(:disabled) { transform: translateY(0); }
        .lco-btn:disabled { opacity: .55; cursor: not-allowed; }

        .lco-spinner {
          display: inline-block;
          width: 14px;
          height: 14px;
          border: 2px solid rgba(8,12,20,.2);
          border-top-color: var(--bg);
          border-radius: 50%;
          animation: lco-spin .55s linear infinite;
          vertical-align: middle;
          margin-right: 8px;
        }
        @keyframes lco-spin { to { transform: rotate(360deg); } }

        .lco-error {
          display: flex;
          align-items: center;
          gap: 8px;
          background: rgba(248,113,113,.06);
          border: 1px solid rgba(248,113,113,.15);
          border-radius: 8px;
          padding: 10px 14px;
          font-size: 13px;
          color: var(--danger);
          animation: lco-shake .35s ease;
        }
        @keyframes lco-shake {
          0%,100% { transform: translateX(0); }
          25%     { transform: translateX(-5px); }
          75%     { transform: translateX(5px); }
        }

        .lco-sep {
          display: flex;
          align-items: center;
          gap: 14px;
          margin: 20px 0;
          color: var(--text-dim);
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: .06em;
        }
        .lco-sep::before, .lco-sep::after {
          content: '';
          flex: 1;
          height: 1px;
          background: var(--border);
        }

        .lco-footer-text {
          text-align: center;
          font-size: 13px;
          color: var(--text-dim);
        }
        .lco-footer-text a {
          color: var(--accent);
          text-decoration: none;
          font-weight: 600;
        }
        .lco-footer-text a:hover { text-decoration: underline; }

        .lco-bottom {
          position: absolute;
          bottom: 24px;
          left: 50%;
          transform: translateX(-50%);
          font-size: 11px;
          color: var(--text-dim);
          opacity: .4;
          white-space: nowrap;
        }

        @keyframes lco-fadeIn {
          from { opacity: 0; transform: translateY(12px); }
          to   { opacity: 1; transform: translateY(0); }
        }
        .lco-anim { animation: lco-fadeIn .45s ease both; }
        .lco-d1 { animation-delay: .06s; }
        .lco-d2 { animation-delay: .12s; }
        .lco-d3 { animation-delay: .18s; }
        .lco-d4 { animation-delay: .24s; }
        .lco-d5 { animation-delay: .30s; }
      `}</style>

      <nav className="lco-topbar">
        <div className="lco-topbar-logo">
          <span>Life</span>Craft<span>Online</span>
        </div>
        <span className="lco-topbar-badge">v0.1 · Early Access</span>
        <div className="lco-topbar-right">
          <div className="lco-topbar-status" />
          <span className="lco-topbar-status-text">Systems Online</span>
        </div>
      </nav>

      <div className="lco-shell">
        <div className="lco-left">
          <div className="lco-left-inner">
            <div className="lco-hero-label">Live Simulation</div>

            <h2 className="lco-hero-title">
              Build. Trade.<br />
              <em>Dominate the market.</em>
            </h2>
            <p className="lco-hero-sub">
              Run your own business empire in a persistent, real-time economy.
              Hire employees, manage manufacturing, trade on the open market —
              every decision counts.
            </p>

            <div className="lco-stat-row">
              <div className="lco-stat-card">
                <span className="lco-stat-card-label">Active Players</span>
                <span className="lco-stat-card-val">12,408<span className="lco-up">↑8%</span></span>
              </div>
              <div className="lco-stat-card">
                <span className="lco-stat-card-label">GDP Simulated</span>
                <span className="lco-stat-card-val">$2.1B</span>
              </div>
              <div className="lco-stat-card">
                <span className="lco-stat-card-label">Corps Founded</span>
                <span className="lco-stat-card-val">847</span>
              </div>
            </div>

            <div className="lco-chart-card">
              <div className="lco-chart-header">
                <span className="lco-chart-title">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>
                  </svg>
                  Market Activity
                </span>
                <span className="lco-chart-badge">+12.3% 24h</span>
              </div>
              <svg viewBox="0 0 400 64" preserveAspectRatio="none" style={{height:56}}>
                <defs>
                  <linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--accent)" stopOpacity=".15" />
                    <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path
                  d={`M0,${64 - (spark[0] / 100) * 64} ${spark
                    .map((v, i) => `L${(i / (spark.length - 1)) * 400},${64 - (v / 100) * 64}`)
                    .join(" ")} L400,64 L0,64 Z`}
                  fill="url(#areaFill)"
                />
                <polyline
                  points={spark
                    .map((v, i) => `${(i / (spark.length - 1)) * 400},${64 - (v / 100) * 64}`)
                    .join(" ")}
                  fill="none"
                  stroke="var(--accent)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="400" cy={64 - (spark[spark.length - 1] / 100) * 64} r="3" fill="var(--accent)">
                  <animate attributeName="opacity" values="1;.3;1" dur="2s" repeatCount="indefinite" />
                </circle>
              </svg>
            </div>
          </div>
        </div>

        <div className="lco-right">
          <div className="lco-auth-box">
            <div className="lco-mobile-brand">
              <span>Life</span>Craft<span>Online</span>
            </div>

            <div className="lco-auth-header lco-anim">
              <h1 className="lco-auth-title">Sign in</h1>
              <p className="lco-auth-desc">Continue your LifeCraftOnline session.</p>
            </div>

            <form className="lco-form" onSubmit={onSubmit}>
              <div className="lco-field lco-anim lco-d1">
                <label className="lco-label" htmlFor="username">Username</label>
                <input
                  className="lco-input"
                  id="username"
                  name="username"
                  placeholder="Enter your username"
                  value={formData.username}
                  onChange={handleChange}
                  required
                  autoComplete="username"
                />
              </div>

              <div className="lco-field lco-anim lco-d2">
                <label className="lco-label" htmlFor="password">Password</label>
                <input
                  className="lco-input"
                  id="password"
                  name="password"
                  type="password"
                  placeholder="Enter your password"
                  value={formData.password}
                  onChange={handleChange}
                  required
                  autoComplete="current-password"
                />
              </div>

              {error && (
                <div className="lco-error">
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M8 4.5v4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                    <circle cx="8" cy="11.5" r=".75" fill="currentColor" />
                  </svg>
                  {error}
                </div>
              )}

              <button className="lco-btn lco-anim lco-d3" type="submit" disabled={loading}>
                {loading ? (<><span className="lco-spinner" />Signing in…</>) : "Sign in"}
              </button>
            </form>

            <div className="lco-sep lco-anim lco-d4">or</div>

            <p className="lco-footer-text lco-anim lco-d5">
              Need an account? <a href="/register">Register</a>
            </p>
          </div>

          <span className="lco-bottom">© 2026 LifeCraftOnline — All rights reserved</span>
        </div>
      </div>
    </>
  );
}