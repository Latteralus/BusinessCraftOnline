export default function AuthenticatedLoading() {
  return (
    <div className="main-container anim">
      <div className="card">
        <div className="card-header">
          <div className="card-title">Loading</div>
        </div>
        <div className="card-body">
          <p style={{ color: "var(--text-secondary)", margin: 0 }}>
            Loading page data...
          </p>
        </div>
      </div>
    </div>
  );
}
