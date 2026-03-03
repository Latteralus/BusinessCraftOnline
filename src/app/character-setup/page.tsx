"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState, ChangeEvent } from "react";

type City = {
  id: string;
  name: string;
  state: string;
  region: string;
};

export default function CharacterSetupPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cities, setCities] = useState<City[]>([]);
  const [formData, setFormData] = useState({
    firstName: "",
    lastName: "",
    gender: "other",
    currentCityId: "",
  });

  useEffect(() => {
    async function loadCities() {
      try {
        const res = await fetch("/api/cities");
        const data = await res.json();
        if (res.ok && data.cities) {
          setCities(data.cities);
        }
      } catch (err) {
        console.error("Failed to load cities", err);
      }
    }
    loadCities();
  }, []);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const payload = {
      firstName: formData.firstName,
      lastName: formData.lastName,
      gender: formData.gender,
      currentCityId: formData.currentCityId || null,
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

  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setFormData((prev) => ({ ...prev, [e.target.name]: e.target.value }));

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
          --danger:    #f87171;
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

        /* ═══ LEFT PANEL ═══ */
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

        /* steps preview */
        .lco-steps {
          display: flex;
          flex-direction: column;
          gap: 0;
          margin-bottom: 28px;
        }
        .lco-step {
          display: flex;
          align-items: flex-start;
          gap: 16px;
          position: relative;
        }
        .lco-step-track {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 0;
        }
        .lco-step-dot {
          width: 32px;
          height: 32px;
          min-width: 32px;
          border-radius: 50%;
          display: grid;
          place-items: center;
          font-family: 'DM Mono', monospace;
          font-size: 12px;
          font-weight: 500;
          border: 1px solid var(--border);
          background: var(--surface);
          color: var(--text-dim);
          position: relative;
          z-index: 1;
        }
        .lco-step.active .lco-step-dot {
          background: var(--accent);
          border-color: var(--accent);
          color: var(--bg);
          box-shadow: 0 0 12px rgba(45,212,160,.25);
        }
        .lco-step.done .lco-step-dot {
          background: var(--surface-2);
          border-color: var(--accent-dim);
          color: var(--accent);
        }
        .lco-step-line {
          width: 1px;
          height: 28px;
          background: var(--border);
        }
        .lco-step.done .lco-step-line {
          background: var(--accent-dim);
        }
        .lco-step-content {
          padding: 5px 0 28px 0;
        }
        .lco-step:last-child .lco-step-content {
          padding-bottom: 0;
        }
        .lco-step-title {
          font-size: 14px;
          font-weight: 600;
          color: var(--text-bright);
          margin-bottom: 3px;
        }
        .lco-step.active .lco-step-title { color: var(--accent); }
        .lco-step-desc {
          font-size: 12px;
          color: var(--text-dim);
          line-height: 1.5;
        }

        /* info card */
        .lco-info-card {
          background: var(--surface);
          border: 1px solid var(--border);
          border-radius: 10px;
          padding: 18px;
        }
        .lco-info-card-header {
          display: flex;
          align-items: center;
          gap: 8px;
          margin-bottom: 10px;
          font-size: 12px;
          font-weight: 600;
          color: var(--text);
        }
        .lco-info-card-header svg { color: var(--text-dim); }
        .lco-info-items {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }
        .lco-info-item {
          display: flex;
          align-items: center;
          gap: 10px;
          font-size: 13px;
          color: var(--text-dim);
        }
        .lco-info-check {
          width: 18px;
          height: 18px;
          min-width: 18px;
          border-radius: 50%;
          background: rgba(45,212,160,.08);
          border: 1px solid rgba(45,212,160,.2);
          display: grid;
          place-items: center;
          color: var(--accent);
        }

        /* ═══ RIGHT PANEL ═══ */
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
          max-width: 400px;
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

        .lco-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }

        .lco-field { display: flex; flex-direction: column; gap: 5px; }
        .lco-label {
          font-size: 11px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: .06em;
          color: var(--text-dim);
        }
        .lco-input,
        .lco-select {
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
        .lco-input:focus,
        .lco-select:focus {
          border-color: var(--accent);
          box-shadow: 0 0 0 2px rgba(45,212,160,.1);
        }
        .lco-select {
          appearance: none;
          background-image: url("data:image/svg+xml,%3Csvg width='12' height='8' viewBox='0 0 12 8' fill='none' xmlns='http://www.w3.org/2000/svg'%3E%3Cpath d='M1 1.5L6 6.5L11 1.5' stroke='%234e6076' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
          background-repeat: no-repeat;
          background-position: right 14px center;
          padding-right: 36px;
          cursor: pointer;
        }
        .lco-select option {
          background: var(--surface);
          color: var(--text-bright);
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
        {/* ═══ LEFT PANEL ═══ */}
        <div className="lco-left">
          <div className="lco-left-inner">
            <div className="lco-hero-label">Getting Started</div>

            <h2 className="lco-hero-title">
              Define your<br />
              <em>identity.</em>
            </h2>
            <p className="lco-hero-sub">
              Every tycoon starts somewhere. Set up your character, pick a
              starting city, and enter the economy. This only takes a moment.
            </p>

            {/* progress steps */}
            <div className="lco-steps">
              <div className="lco-step done">
                <div className="lco-step-track">
                  <div className="lco-step-dot">
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                      <path d="M4 8.5l3 3 5.5-6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  <div className="lco-step-line" />
                </div>
                <div className="lco-step-content">
                  <div className="lco-step-title">Create Account</div>
                  <div className="lco-step-desc">Username and password set.</div>
                </div>
              </div>

              <div className="lco-step active">
                <div className="lco-step-track">
                  <div className="lco-step-dot">2</div>
                  <div className="lco-step-line" />
                </div>
                <div className="lco-step-content">
                  <div className="lco-step-title">Character Setup</div>
                  <div className="lco-step-desc">Name, gender, and starting city.</div>
                </div>
              </div>

              <div className="lco-step">
                <div className="lco-step-track">
                  <div className="lco-step-dot">3</div>
                </div>
                <div className="lco-step-content">
                  <div className="lco-step-title">Enter the Economy</div>
                  <div className="lco-step-desc">Start your first business and begin trading.</div>
                </div>
              </div>
            </div>

            {/* what you get card */}
            <div className="lco-info-card">
              <div className="lco-info-card-header">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 2L2 7l10 5 10-5-10-5z"/>
                  <path d="M2 17l10 5 10-5"/>
                  <path d="M2 12l10 5 10-5"/>
                </svg>
                Starting Package
              </div>
              <div className="lco-info-items">
                <div className="lco-info-item">
                  <div className="lco-info-check">
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                      <path d="M4 8.5l3 3 5.5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  $5,000 starting capital
                </div>
                <div className="lco-info-item">
                  <div className="lco-info-check">
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                      <path d="M4 8.5l3 3 5.5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  Access to the Player Market
                </div>
                <div className="lco-info-item">
                  <div className="lco-info-check">
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                      <path d="M4 8.5l3 3 5.5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  Banking &amp; savings account
                </div>
                <div className="lco-info-item">
                  <div className="lco-info-check">
                    <svg width="10" height="10" viewBox="0 0 16 16" fill="none">
                      <path d="M4 8.5l3 3 5.5-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </div>
                  Ability to found your first business
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* ═══ RIGHT PANEL ═══ */}
        <div className="lco-right">
          <div className="lco-auth-box">
            <div className="lco-mobile-brand">
              <span>Life</span>Craft<span>Online</span>
            </div>

            <div className="lco-auth-header lco-anim">
              <h1 className="lco-auth-title">Character Setup</h1>
              <p className="lco-auth-desc">Complete this once to begin progression.</p>
            </div>

            <form className="lco-form" onSubmit={onSubmit}>
              <div className="lco-row lco-anim lco-d1">
                <div className="lco-field">
                  <label className="lco-label" htmlFor="firstName">First Name</label>
                  <input
                    className="lco-input"
                    id="firstName"
                    name="firstName"
                    placeholder="First name"
                    value={formData.firstName}
                    onChange={handleChange}
                    required
                  />
                </div>
                <div className="lco-field">
                  <label className="lco-label" htmlFor="lastName">Last Name</label>
                  <input
                    className="lco-input"
                    id="lastName"
                    name="lastName"
                    placeholder="Last name"
                    value={formData.lastName}
                    onChange={handleChange}
                    required
                  />
                </div>
              </div>

              <div className="lco-field lco-anim lco-d2">
                <label className="lco-label" htmlFor="gender">Gender</label>
                <select
                  className="lco-select"
                  id="gender"
                  name="gender"
                  value={formData.gender}
                  onChange={handleChange}
                  required
                >
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                  <option value="other">Other</option>
                </select>
              </div>

              {cities.length > 0 && (
                <div className="lco-field lco-anim lco-d3">
                  <label className="lco-label" htmlFor="currentCityId">Starting City</label>
                  <select
                    className="lco-select"
                    id="currentCityId"
                    name="currentCityId"
                    value={formData.currentCityId}
                    onChange={handleChange}
                    required
                  >
                    <option value="" disabled>Select a city…</option>
                    {cities.map((city) => (
                      <option key={city.id} value={city.id}>
                        {city.name}, {city.state}
                      </option>
                    ))}
                  </select>
                </div>
              )}

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

              <button className="lco-btn lco-anim lco-d4" type="submit" disabled={loading}>
                {loading ? (<><span className="lco-spinner" />Saving…</>) : "Create character"}
              </button>
            </form>
          </div>

          <span className="lco-bottom">© 2026 LifeCraftOnline — All rights reserved</span>
        </div>
      </div>
    </>
  );
}