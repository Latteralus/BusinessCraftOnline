import { requireAuthedPageContext } from "../../server-data";

export default async function PlayerProfilePlaceholderPage({
  params,
}: {
  params: { id: string };
}) {
  await requireAuthedPageContext();

  return (
    <div className="card anim" style={{ marginTop: 24 }}>
      <div className="card-header">
        <div className="card-title">Player Profile</div>
      </div>
      <div className="card-body">
        <p style={{ marginTop: 0 }}>Profile pages are not implemented yet.</p>
        <p style={{ color: "var(--text-muted)", marginBottom: 0 }}>
          Placeholder target for player id: <span style={{ fontFamily: "'JetBrains Mono', monospace" }}>{params.id}</span>
        </p>
      </div>
    </div>
  );
}
