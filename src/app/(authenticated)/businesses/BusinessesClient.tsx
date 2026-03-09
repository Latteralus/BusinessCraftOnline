"use client";

import type {
  BusinessType,
  BusinessesResponse,
  BusinessWithBalance,
  BusinessSummary,
} from "@/domains/businesses";
import type { CitiesResponse, City, TravelState, TravelStateResponse } from "@/domains/cities-travel";
import type { UpgradeDefinition, UpgradePreview } from "@/domains/upgrades";
import { apiGet, apiPost } from "@/lib/client/api";
import { apiRoutes } from "@/lib/client/routes";
import { formatCurrency, formatLabel } from "@/lib/formatters";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Props = {
  initialData: {
    businesses: BusinessWithBalance[];
    summary: BusinessSummary;
    cities: City[];
    travelState: TravelState;
    upgradeDefinitions: UpgradeDefinition[];
  };
};

type UpgradeDefinitionsResponse = {
  definitions: UpgradeDefinition[];
  error?: string;
};

type UpgradePreviewResponse = {
  preview: UpgradePreview;
  error?: string;
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

export default function BusinessesClient({ initialData }: Props) {
  const [businesses, setBusinesses] = useState<BusinessWithBalance[]>(initialData.businesses);
  const [summary, setSummary] = useState<BusinessSummary | null>(initialData.summary);
  const [cities, setCities] = useState<City[]>(initialData.cities);
  const [travelState, setTravelState] = useState<TravelState | null>(initialData.travelState);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [createName, setCreateName] = useState("");
  const [createType, setCreateType] = useState<BusinessType>("farm");
  const [createCityId, setCreateCityId] = useState(initialData.travelState.currentCity?.id ?? "");
  const [creating, setCreating] = useState(false);

  const [upgradeBusinessId, setUpgradeBusinessId] = useState("");
  const [upgradeKey, setUpgradeKey] = useState("extraction_efficiency");
  const [upgradeDefinitions, setUpgradeDefinitions] = useState<UpgradeDefinition[]>(initialData.upgradeDefinitions);
  const [upgradePreview, setUpgradePreview] = useState<UpgradePreview | null>(null);
  const [upgrading, setUpgrading] = useState(false);

  async function loadData(showLoading = false) {
    if (showLoading) setLoading(true);
    setError(null);

    try {
      const [businessesJson, citiesJson, travelJson, definitionsJson] = await Promise.all([
        apiGet<BusinessesResponse>(apiRoutes.businesses.root, { fallbackError: "Failed to fetch businesses." }),
        apiGet<CitiesResponse>(apiRoutes.cities, { fallbackError: "Failed to fetch cities." }),
        apiGet<TravelStateResponse>(apiRoutes.travel, { fallbackError: "Failed to fetch travel state." }),
        apiGet<UpgradeDefinitionsResponse>(apiRoutes.upgrades.root, { fallbackError: "Failed to fetch upgrade definitions." }),
      ]);

      setBusinesses(businessesJson.businesses ?? []);
      setSummary(businessesJson.summary ?? null);
      setCities(citiesJson.cities ?? []);
      setTravelState(travelJson);
      setUpgradeDefinitions(definitionsJson.definitions ?? []);
      if (travelJson.currentCity?.id) {
        setCreateCityId((current) => current || travelJson.currentCity!.id);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh businesses.");
    } finally {
      if (showLoading) setLoading(false);
    }
  }

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

      try {
        const payload = await apiPost<UpgradePreviewResponse>(
          apiRoutes.upgrades.preview,
          { businessId: selectedBusiness.id, upgradeKey },
          { fallbackError: "Failed to load upgrade preview." }
        );
        setUpgradePreview(payload.preview ?? null);
      } catch {
        setUpgradePreview(null);
      }
    }

    void loadUpgradePreview();
  }, [selectedBusiness, upgradeKey]);

  async function submitCreateBusiness() {
    if (creating) return;
    setCreating(true);
    setError(null);
    try {
      await apiPost(
        apiRoutes.businesses.root,
        {
          name: createName,
          type: createType,
          cityId: createCityId,
        },
        { fallbackError: "Failed to create business." }
      );

      setCreateName("");
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create business.");
    } finally {
      setCreating(false);
    }
  }

  async function submitUpgrade() {
    if (!upgradeBusinessId || upgrading) return;
    setUpgrading(true);
    setError(null);
    try {
      await apiPost(apiRoutes.businesses.upgrade(upgradeBusinessId), { upgradeKey }, { fallbackError: "Failed to purchase upgrade." });
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to purchase upgrade.");
    } finally {
      setUpgrading(false);
    }
  }

  return (
    <div className="anim">
      <header className="lc-page-header">
        <div>
          <h1>Businesses</h1>
          <p>Register businesses, review balances, and purchase upgrades.</p>
        </div>
        <div style={{ alignSelf: "center" }}>
          <Link href="/dashboard">Back to Dashboard</Link>
        </div>
      </header>

      {loading ? <p>Refreshing business data...</p> : null}
      {error ? <p style={{ color: "#f87171" }}>{error}</p> : null}

      <section>
        <h2 style={{ marginTop: 0 }}>Business Summary</h2>
        <p style={{ margin: "6px 0" }}>
          <strong>Total Businesses:</strong> {summary?.totalBusinesses ?? 0}
        </p>
        <p style={{ margin: "6px 0" }}>
          <strong>Total Business Balances:</strong> {formatCurrency(summary?.totalBusinessBalance ?? 0)}
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
            <select value={createCityId} onChange={(event) => setCreateCityId(event.target.value)} title="City">
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
            disabled={!createName.trim() || !createCityId || !travelState?.canPurchaseBusiness || creating}
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
            <Link
              key={business.id}
              href={`/businesses/${business.id}`}
              style={{ border: "1px solid #334155", borderRadius: 8, padding: 12, textDecoration: "none", color: "inherit", display: "block" }}
            >
              <p style={{ margin: 0, fontWeight: 700 }}>{business.name}</p>
              <p style={{ margin: "6px 0", color: "#94a3b8" }}>
                {TYPE_LABELS[business.type]} · {formatLabel(business.entity_type)} · Balance {formatCurrency(business.balance)}
              </p>
              <p style={{ margin: 0, color: "#94a3b8" }}>Value: {formatCurrency(business.value)}</p>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 style={{ marginTop: 0 }}>Purchase Upgrade</h2>
        <div style={{ display: "grid", gap: 8, maxWidth: 560 }}>
          <label>
            Business
            <select value={upgradeBusinessId} onChange={(event) => setUpgradeBusinessId(event.target.value)} title="Business">
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
            <select value={upgradeKey} onChange={(event) => setUpgradeKey(event.target.value)} title="Upgrade">
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
              Next Level {upgradePreview.nextLevel} · Cost {formatCurrency(upgradePreview.nextCost)} · Effect{" "}
              {upgradePreview.nextEffect} {upgradePreview.effectLabel}
            </p>
          ) : null}

          <button onClick={submitUpgrade} disabled={!upgradeBusinessId || !upgradeKey || upgrading}>
            {upgrading ? "Purchasing..." : "Purchase Upgrade"}
          </button>
        </div>
      </section>
    </div>
  );
}
