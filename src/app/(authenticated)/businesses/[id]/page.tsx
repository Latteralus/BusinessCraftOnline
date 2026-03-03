import { getCharacter } from "@/domains/auth-character";
import { getBusinessById } from "@/domains/businesses";
import { getCityById } from "@/domains/cities-travel";
import { getEmployeeSummary } from "@/domains/employees";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";
import Link from "next/link";
import BusinessDetailsClient from "@/components/businesses/BusinessDetailsClient";

export default async function BusinessDetailsPage({ params }: { params: { id: string } }) {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const character = await getCharacter(supabase, user.id).catch(() => null);
  if (!character) {
    redirect("/character-setup");
  }

  const business = await getBusinessById(supabase, user.id, params.id).catch(() => null);

  if (!business || business.player_id !== user.id) {
    redirect("/businesses"); // Redirect if it doesn't exist or isn't theirs
  }

  const city = await getCityById(supabase, business.city_id).catch(() => null);

  return (
    <>
      <div className="page-header anim">
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Link href="/businesses" className="back-button" style={{ 
            display: "flex", 
            alignItems: "center", 
            justifyContent: "center",
            width: 32, 
            height: 32, 
            background: "var(--bg-elevated)", 
            borderRadius: "50%",
            color: "var(--text-secondary)",
            textDecoration: "none"
          }}>
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
          </Link>
          <div>
            <h1>{business.name}</h1>
            <p>{business.type.replace(/_/g, " ")} • {city?.name ?? "Unknown City"}</p>
          </div>
        </div>
      </div>

      <BusinessDetailsClient business={business} />
    </>
  );
}
