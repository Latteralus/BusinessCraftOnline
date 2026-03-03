"use client";

import type {
  BusinessType,
  BusinessWithBalance,
  BusinessSummary,
} from "@/domains/businesses";
import type { UpgradeDefinition, UpgradePreview } from "@/domains/upgrades";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type BusinessesResponse = {
  businesses: BusinessWithBalance[];
  summary: BusinessSummary;
};

type CitiesResponse = {
  cities: Array<{ id: string; name: string; state: string }>;
};

type TravelResponse = {
  currentCity: { id: string; name: string; state: string } | null;
  activeTravel: { id: string } | null;
  canPurchaseBusiness: boolean;
};

type UpgradeDefinitionsResponse = {
  definitions: UpgradeDefinition[];
};

type UpgradePreviewResponse = {
  preview: UpgradePreview;
};

const TYPE_LABELS: Record<BusinessType, string> = {
  mine: "Mine",
  farm: "Farm",
  water_company: "Water Company",
  logging_camp: "Logging Camp",
  oil_well: "Oil Well",
  sawmill: "Sawmill",
  metalworking_factory: "Metalworking Factory",
  food_processing_plant: "Food Processing Plant",
  winery_distillery: "Winery / Distillery",
  carpentry_workshop: "Carpentry Workshop",
  general_store: "General Store",
  specialty_store: "Specialty Store",
};

function formatCurrency(value: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
  }).format(value);
}

export default function BusinessesPage() {
  const [businesses, setBusinesses] = useState<BusinessWithBalance[]>([]);
  const [summary, setSummary] = useState<BusinessSummary | null>(null);
  const [cities, setCities] = useState<Array<{ id: string; name: string; state: string }>>([]);
  const [travelState, setTravelState] = useState<TravelResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [createName, setCreateName] = useState("");
  const [createType, setCreateType] = useState<BusinessType>("farm");
  const [createCityId, setCreateCityId] = useState("");
  const [creating, setCreating] = useState(false);

  const [upgradeBusinessId, setUpgradeBusinessId] = useState("");
  const [upgradeKey, setUpgradeKey] = useState("extraction_efficiency");
  const [upgradeDefinitions, setUpgradeDefinitions] = useState<UpgradeDefinition[]>([]);
  const [upgradePreview, setUpgradePreview] = useState<UpgradePreview | null>(null);
  const [upgrading, setUpgrading] = useState(false);

  async function loadData() {
    setLoading(true);
    setError(null);

    const [businessesRes, citiesRes, travelRes, definitionsRes] = await Promise.all([
      fetch("/api/businesses", { cache: "no-store" }),
      fetch("/api/cities", { cache: "no-store" }),
      fetch("/api/travel", { cache: "no-store" }),
      fetch("/api/upgrades", { cache: "no-store" }),
    ]);

    const businessesJson = (await businessesRes.json()) as BusinessesResponse & {
      error?: string;
    };
    const citiesJson = (await citiesRes.json()) as CitiesResponse & { error?: string };
    const travelJson = (await travelRes.json()) as TravelResponse & { error?: string };
    const definitionsJson = (await definitionsRes.json()) as UpgradeDefinitionsResponse & {
      error?: string;
    };

    if (!businessesRes.ok) {
      setError(businessesJson.error ?? "Failed to fetch businesses.");
      setLoading(false);
      return;
    }

    if (!citiesRes.ok) {
      setError(citiesJson.error ?? "Failed to fetch cities.");
      setLoading(false);
      return;
    }

    if (!travelRes.ok) {
      setError(travelJson.error ?? "Failed to fetch travel state.");
      setLoading(false);
      return;
    }

    if (!definitionsRes.ok) {
      setError(definitionsJson.error ?? "Failed to fetch upgrade definitions.");
      setLoading(false);
      return;
    }

    setBusinesses(businessesJson.businesses ?? []);
    setSummary(businessesJson.summary ?? null);
    setCities(citiesJson.cities ?? []);
    setTravelState(travelJson);
    setUpgradeDefinitions(definitionsJson.definitions ?? []);

    if (travelJson.currentCity?.id) {
      setCreateCityId(travelJson.currentCity.id);
    }

    setLoading(false);
  }

  useEffect(() => {
    void loadData();
  }, []);

  const selectedBusiness = useMemo(
    () => businesses.find((business) => business.id === upgradeBusinessId) ?? null,
    [businesses, upgradeBusinessId]
  );

  const upgradeOptions = useMemo(() => {
    if (!selectedBusiness) return upgradeDefinitions;
    return upgradeDefinitions.filter((definition) =>
      definition.applies_to_business_types.includes(selectedBusiness.type)
    );
  }, [selectedBusiness, upgradeDefinitions]);

  useEffect(() => {
    if (!upgradeOptions.some((option) => option.upgrade_key === upgradeKey)) {
      setUpgradeKey(upgradeOptions[0]?.upgrade_key ?? "");
    }
  }, [upgradeOptions, upgradeKey]);

  useEffect(() => {
    async function loadUpgradePreview() {
      if (!selectedBusiness || !upgradeKey) {
        setUpgradePreview(null);
        return;
      }

      const response = await fetch("/api/upgrades/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId: selectedBusiness.id, upgradeKey }),
      });

      const payload = (await response.json()) as UpgradePreviewResponse & { error?: string };
      if (!response.ok) {
        setUpgradePreview(null);
        return;
      }

      setUpgradePreview(payload.preview ?? null);
    }

    void loadUpgradePreview();
  }, [selectedBusiness, upgradeKey]);

  async function submitCreateBusiness() {
    if (creating) return;
    setCreating(true);
    setError(null);

    const response = await fetch("/api/businesses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: createName,
        type: createType,
        cityId: createCityId,
      }),
    });

    const data = await response.json();
    setCreating(false);

    if (!response.ok) {
      setError(data.error ?? "Failed to create business.");
      return;
    }

    setCreateName("");
    await loadData();
  }

  async function submitUpgrade() {
    if (!upgradeBusinessId || upgrading) return;
    setUpgrading(true);
    setError(null);

    const response = await fetch(`/api/businesses/${upgradeBusinessId}/upgrade`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ upgradeKey }),
    });

    const data = await response.json();
    setUpgrading(false);

    if (!response.ok) {
      setError(data.error ?? "Failed to purchase upgrade.");
      return;
    }

    await loadData();
  }

  return (
    <div className="anim">
      <header className="lc-page-header">
        <div>
          <h1>Businesses</h1>
          <p>
            Register businesses, review balances, and purchase upgrades.
          </p>
        </div>
        <div style={{ alignSelf: "center" }}>
          <Link href="/dashboard">Back to Dashboard</Link>
        </div>
      </header>

      {loading ? <p>Loading business data...</p> : null}
      {error ? <p style={{ color: "#f87171" }}>{error}</p> : null}

      {!loading ? (
        <>
          <section>
            <h2 style={{ marginTop: 0 }}>Business Summary</h2>
            <p style={{ margin: "6px 0" }}>
              <strong>Total Businesses:</strong> {summary?.totalBusinesses ?? 0}
            </p>
            <p style={{ margin: "6px 0" }}>
              <strong>Total Business Balances:</strong>{" "}
              {formatCurrency(summary?.totalBusinessBalance ?? 0)}
            </p>
            <p style={{ margin: "6px 0" }}>
              <strong>Producing Types Owned:</strong> {summary?.producingTypesOwned ?? 0}
            </p>
            <p style={{ margin: "6px 0" }}>
              <strong>Top Business:</strong>{" "}
              {summary?.topBusiness
                ? `${summary.topBusiness.name} (${formatCurrency(summary.topBusiness.balance)})`
                : "N/A"}
            </p>
            <p style={{ margin: "6px 0", color: "#94a3b8" }}>
              Current City: {travelState?.currentCity?.name ?? "Unknown"}
              {travelState?.activeTravel ? " (Traveling)" : ""}
            </p>
          </section>

          <section>
            <h2 style={{ marginTop: 0 }}>Create Business</h2>
            <div style={{ display: "grid", gap: 8, maxWidth: 560 }}>
              <label>
                Name
                <input
                  type="text"
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                  placeholder="Heartland Wheat Farm"
                />
              </label>

              <label>
                Type
                <select
                  value={createType}
                  onChange={(event) => setCreateType(event.target.value as BusinessType)}
                  title="Business type"
                >
                  {Object.entries(TYPE_LABELS).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>

              <label>
                City
                <select
                  value={createCityId}
                  onChange={(event) => setCreateCityId(event.target.value)}
                  title="City"
                >
                  <option value="">Select city</option>
                  {cities.map((city) => (
                    <option key={city.id} value={city.id}>
                      {city.name}, {city.state}
                    </option>
                  ))}
                </select>
              </label>

              <button
                onClick={submitCreateBusiness}
                disabled={
                  !createName.trim() ||
                  !createCityId ||
                  !travelState?.canPurchaseBusiness ||
                  creating
                }
              >
                {creating ? "Creating..." : "Create Business"}
              </button>
            </div>
          </section>

          <section>
            <h2 style={{ marginTop: 0 }}>Businesses</h2>
            <div style={{ display: "grid", gap: 10 }}>
              {businesses.length === 0 ? <p>No businesses yet.</p> : null}
              {businesses.map((business) => (
                <div
                  key={business.id}
                  style={{ border: "1px solid #334155", borderRadius: 8, padding: 12 }}
                >
                  <p style={{ margin: 0, fontWeight: 700 }}>{business.name}</p>
                  <p style={{ margin: "6px 0", color: "#94a3b8" }}>
                    {TYPE_LABELS[business.type]} · {business.entity_type} · Balance{" "}
                    {formatCurrency(business.balance)}
                  </p>
                  <p style={{ margin: 0, color: "#94a3b8" }}>
                    Value: {formatCurrency(business.value)}
                  </p>
                </div>
              ))}
            </div>
          </section>

          <section>
            <h2 style={{ marginTop: 0 }}>Purchase Upgrade</h2>
            <div style={{ display: "grid", gap: 8, maxWidth: 560 }}>
              <label>
                Business
                <select
                  value={upgradeBusinessId}
                  onChange={(event) => setUpgradeBusinessId(event.target.value)}
                  title="Business"
                >
                  <option value="">Select business</option>
                  {businesses.map((business) => (
                    <option key={business.id} value={business.id}>
                      {business.name} ({formatCurrency(business.balance)})
                    </option>
                  ))}
                </select>
              </label>

              <label>
                Upgrade
                <select
                  value={upgradeKey}
                  onChange={(event) => setUpgradeKey(event.target.value)}
                  title="Upgrade"
                >
                  <option value="">Select upgrade</option>
                  {upgradeOptions.map((definition) => (
                    <option key={definition.upgrade_key} value={definition.upgrade_key}>
                      {definition.display_name} ({definition.upgrade_key})
                    </option>
                  ))}
                </select>
              </label>

              {selectedBusiness ? (
                <p style={{ margin: 0, color: "#94a3b8" }}>
                  Selected balance: {formatCurrency(selectedBusiness.balance)}
                </p>
              ) : null}

              {upgradePreview ? (
                <p style={{ margin: 0, color: "#94a3b8" }}>
                  Next Level {upgradePreview.nextLevel} · Cost {formatCurrency(upgradePreview.nextCost)} ·
                  Effect {upgradePreview.nextEffect} {upgradePreview.effectLabel}
                </p>
              ) : null}

              <button onClick={submitUpgrade} disabled={!upgradeBusinessId || !upgradeKey || upgrading}>
                {upgrading ? "Purchasing..." : "Purchase Upgrade"}
              </button>
            </div>
          </section>
        </>
      ) : null}
    </div>
  );
}
