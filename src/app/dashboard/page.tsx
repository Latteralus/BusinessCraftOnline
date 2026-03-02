import { getCharacter, getPlayer } from "@/domains/auth-character";
import { getBankingSnapshot } from "@/domains/banking";
import { getBusinessSummary } from "@/domains/businesses";
import { getActiveTravel, getCityById } from "@/domains/cities-travel";
import { getEmployeeSummary } from "@/domains/employees";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import Link from "next/link";
import { redirect } from "next/navigation";

async function logout() {
  "use server";

  const supabase = createSupabaseServerClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export default async function DashboardPage() {
  const supabase = createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const [player, character] = await Promise.all([
    getPlayer(supabase, user.id),
    getCharacter(supabase, user.id),
  ]);

  if (!character) {
    redirect("/character-setup");
  }

  const [activeTravel, currentCity] = await Promise.all([
    getActiveTravel(supabase, user.id),
    character.current_city_id
      ? getCityById(supabase, character.current_city_id)
      : Promise.resolve(null),
  ]);

  const destinationCity = activeTravel
    ? await getCityById(supabase, activeTravel.to_city_id)
    : null;

  const bankingSnapshot = await getBankingSnapshot(supabase, user.id).catch(() => null);
  const businessSummary = await getBusinessSummary(supabase, user.id).catch(() => null);
  const employeeSummary = await getEmployeeSummary(supabase, user.id).catch(() => null);
  const checkingAccount =
    bankingSnapshot?.accounts.find((account) => account.account_type === "checking") ?? null;
  const pocketCashAccount =
    bankingSnapshot?.accounts.find((account) => account.account_type === "pocket_cash") ?? null;

  const travelRemainingMs = activeTravel
    ? new Date(activeTravel.arrives_at).getTime() - Date.now()
    : null;

  const travelRemainingMinutes =
    travelRemainingMs !== null ? Math.max(0, Math.ceil(travelRemainingMs / 60000)) : null;

  return (
    <main style={{ maxWidth: 900, margin: "0 auto", padding: "48px 24px" }}>
      <h1>Dashboard</h1>
      <p style={{ color: "#94a3b8" }}>Phase 1 auth-character is active.</p>
      <section
        style={{
          border: "1px solid #334155",
          borderRadius: 8,
          padding: 16,
          marginTop: 16,
        }}
      >
        <p>
          <strong>Player:</strong> {player?.username ?? "Unknown"}
        </p>
        <p>
          <strong>Email:</strong> {user.email}
        </p>
        <p>
          <strong>Character:</strong> {character.first_name} {character.last_name}
        </p>
        <p>
          <strong>Gender:</strong> {character.gender}
        </p>
        <p>
          <strong>Business Level:</strong> {character.business_level}
        </p>
        <hr style={{ borderColor: "#334155", margin: "12px 0" }} />
        <p>
          <strong>Current City:</strong> {currentCity?.name ?? "Unknown"}
        </p>
        <p>
          <strong>Travel Status:</strong>{" "}
          {activeTravel
            ? `Traveling to ${destinationCity?.name ?? "destination"} (${travelRemainingMinutes} min remaining)`
            : "Not traveling"}
        </p>
        <p>
          <Link href="/travel">Open Travel Page</Link>
        </p>
        <hr style={{ borderColor: "#334155", margin: "12px 0" }} />
        <p>
          <strong>Pocket Cash:</strong>{" "}
          {pocketCashAccount ? `$${pocketCashAccount.balance.toFixed(2)}` : "Unavailable"}
        </p>
        <p>
          <strong>Checking:</strong>{" "}
          {checkingAccount ? `$${checkingAccount.balance.toFixed(2)}` : "Unavailable"}
        </p>
        <p>
          <strong>Loan:</strong>{" "}
          {bankingSnapshot?.activeLoan
            ? `Active (${bankingSnapshot.activeLoan.balance_remaining.toFixed(2)} remaining)`
            : "No active loan"}
        </p>
        <p>
          <Link href="/banking">Open Banking Page</Link>
        </p>
        <hr style={{ borderColor: "#334155", margin: "12px 0" }} />
        <p>
          <strong>Total Businesses:</strong> {businessSummary?.totalBusinesses ?? 0}
        </p>
        <p>
          <strong>Total Business Balances:</strong>{" "}
          ${businessSummary?.totalBusinessBalance.toFixed(2) ?? "0.00"}
        </p>
        <p>
          <strong>Top Business:</strong>{" "}
          {businessSummary?.topBusiness
            ? `${businessSummary.topBusiness.name} ($${businessSummary.topBusiness.balance.toFixed(2)})`
            : "N/A"}
        </p>
        <p>
          <Link href="/businesses">Open Businesses Page</Link>
        </p>
        <hr style={{ borderColor: "#334155", margin: "12px 0" }} />
        <p>
          <strong>Total Employees:</strong> {employeeSummary?.totalEmployees ?? 0}
        </p>
        <p>
          <strong>Assigned / Resting / Available:</strong> {employeeSummary?.assignedCount ?? 0} /{" "}
          {employeeSummary?.restingCount ?? 0} / {employeeSummary?.availableCount ?? 0}
        </p>
        <p>
          <Link href="/employees">Open Employees Page</Link>
        </p>
        <p>
          <Link href="/production">Open Production Page</Link>
        </p>
        <p>
          <Link href="/contracts">Open Contracts Page</Link>
        </p>
        <p>
          <Link href="/market">Open Market Page</Link>
        </p>
      </section>
      <form action={logout} style={{ marginTop: 20 }}>
        <button type="submit">Sign out</button>
      </form>
    </main>
  );
}
