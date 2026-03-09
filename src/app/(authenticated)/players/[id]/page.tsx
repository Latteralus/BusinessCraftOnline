import Link from "next/link";
import { notFound } from "next/navigation";
import {
  getPlayerProfilePreview,
  getPublicPlayerBusinesses,
} from "@/domains/auth-character";
import PlayerProfileClient from "@/components/players/PlayerProfileClient";
import { requireAuthedPageContext } from "../../server-data";

export default async function PlayerProfilePage(props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const [{ id }, searchParams, { supabase, user }] = await Promise.all([
    props.params,
    props.searchParams,
    requireAuthedPageContext(),
  ]);

  const [profile, businesses] = await Promise.all([
    getPlayerProfilePreview(supabase, id).catch(() => null),
    getPublicPlayerBusinesses(supabase, id).catch(() => []),
  ]);

  if (!profile) {
    notFound();
  }

  const isCurrentPlayer = id === user.id;

  return (
    <>
      <div className="page-header anim">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link
            href="/dashboard"
            className="back-button"
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              background: "var(--bg-elevated)",
              borderRadius: "50%",
              color: "var(--text-secondary)",
              textDecoration: "none",
            }}
          >
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </Link>
          <div>
            <h1>{profile.character_name}</h1>
            <p>
              @{profile.username} • {profile.current_city_name ?? "Unknown City"} •{" "}
              {profile.is_online ? "Online now" : "Offline"}
            </p>
          </div>
        </div>
      </div>

      <PlayerProfileClient
        profile={profile}
        businesses={businesses}
        initialTab={searchParams.tab}
        isCurrentPlayer={isCurrentPlayer}
      />
    </>
  );
}
