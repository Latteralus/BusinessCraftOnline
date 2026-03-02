export default function HomePage() {
  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "48px 24px" }}>
      <h1 style={{ margin: 0, fontSize: "2rem" }}>LifeCraftOnline</h1>
      <p style={{ color: "#94a3b8" }}>
        Phase 1 in place: registration, login, session handling, and character
        setup.
      </p>
      <ul>
        <li>
          <a href="/register">Register</a>
        </li>
        <li>
          <a href="/login">Login</a>
        </li>
        <li>
          <a href="/character-setup">Character Setup</a>
        </li>
        <li>
          <a href="/dashboard">Dashboard</a>
        </li>
        <li>
          <a href="/businesses">Businesses</a>
        </li>
        <li>
          <a href="/employees">Employees</a>
        </li>
        <li>
          <a href="/production">Production</a>
        </li>
        <li>
          <a href="/contracts">Contracts</a>
        </li>
      </ul>
    </main>
  );
}
