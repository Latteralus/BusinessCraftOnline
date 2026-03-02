export default function HomePage() {
  return (
    <main>
      <div className="lc-page-header">
        <div>
          <h1>LifeCraftOnline</h1>
          <p>Economy simulation control center with full gameplay route navigation.</p>
        </div>
      </div>
      <section>
        <h2 style={{ marginTop: 0 }}>Jump To</h2>
        <ul className="lc-link-list">
          <li><a href="/register">Register</a></li>
          <li><a href="/login">Login</a></li>
          <li><a href="/character-setup">Character Setup</a></li>
          <li><a href="/dashboard">Dashboard</a></li>
          <li><a href="/businesses">Businesses</a></li>
          <li><a href="/inventory">Inventory</a></li>
          <li><a href="/market">Market</a></li>
          <li><a href="/production">Production</a></li>
          <li><a href="/employees">Employees</a></li>
          <li><a href="/contracts">Contracts</a></li>
          <li><a href="/travel">Travel</a></li>
          <li><a href="/banking">Banking</a></li>
        </ul>
      </section>
    </main>
  );
}
