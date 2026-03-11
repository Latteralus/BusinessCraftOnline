"use client";

import { NPC_PRICE_CEILINGS } from "@/config/items";
import { apiPost } from "@/lib/client/api";
import { apiRoutes } from "@/lib/client/routes";
import type { InventoryPageData } from "@/lib/client/queries";
import { formatBusinessType } from "@/lib/businesses";
import { formatCurrency, formatDateTime } from "@/lib/formatters";
import { formatItemKey } from "@/lib/items";
import { TooltipLabel } from "@/components/ui/tooltip";
import { detailSyncTarget, mergeDetailSyncTargets, syncMutationViews } from "@/stores/mutation-sync";
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useInventorySlice } from "@/stores/game-store";

type Props = {
  initialData: InventoryPageData;
};

function InventoryMetric(props: {
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "positive" | "accent" | "warn";
}) {
  const color =
    props.tone === "positive"
      ? "#86efac"
      : props.tone === "accent"
        ? "#7dd3fc"
        : props.tone === "warn"
          ? "#fcd34d"
          : "#f8fafc";

  return (
    <div
      style={{
        background: "linear-gradient(180deg, rgba(10, 17, 31, 0.95), rgba(6, 10, 19, 0.94))",
        border: "1px solid rgba(148, 163, 184, 0.14)",
        borderRadius: 14,
        padding: 16,
      }}
    >
      <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>
        {props.label}
      </div>
      <div style={{ fontSize: "1.35rem", fontWeight: 800, color }}>{props.value}</div>
      <div style={{ marginTop: 6, color: "var(--text-secondary)", fontSize: 12 }}>{props.sub}</div>
    </div>
  );
}

function Panel(props: { title: string; eyebrow?: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <section
      style={{
        marginTop: 0,
        background: "linear-gradient(180deg, rgba(9, 14, 25, 0.98), rgba(5, 10, 19, 0.98))",
        border: "1px solid rgba(148, 163, 184, 0.16)",
        borderRadius: 18,
        padding: 18,
        ...props.style,
      }}
    >
      <div style={{ marginBottom: 14 }}>
        {props.eyebrow ? (
          <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 6 }}>
            {props.eyebrow}
          </div>
        ) : null}
        <h2 style={{ margin: 0, fontSize: "1.05rem" }}>{props.title}</h2>
      </div>
      {props.children}
    </section>
  );
}

function FieldLabel(props: { children: ReactNode }) {
  return (
    <div style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: "0.14em", color: "var(--text-muted)", marginBottom: 6 }}>
      {props.children}
    </div>
  );
}

function StatusBadge(props: { children: ReactNode; tone?: "good" | "bad" | "neutral" | "warn" }) {
  const styles =
    props.tone === "good"
      ? { border: "1px solid rgba(34, 197, 94, 0.3)", background: "rgba(34, 197, 94, 0.12)", color: "#86efac" }
      : props.tone === "bad"
        ? { border: "1px solid rgba(248, 113, 113, 0.3)", background: "rgba(248, 113, 113, 0.12)", color: "#fca5a5" }
        : props.tone === "warn"
          ? { border: "1px solid rgba(251, 191, 36, 0.3)", background: "rgba(251, 191, 36, 0.12)", color: "#fcd34d" }
          : { border: "1px solid rgba(96, 165, 250, 0.28)", background: "rgba(96, 165, 250, 0.12)", color: "#bfdbfe" };

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        borderRadius: 999,
        padding: "4px 9px",
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        ...styles,
      }}
    >
      {props.children}
    </span>
  );
}

function EmptyState(props: { children: ReactNode }) {
  return <div style={{ color: "var(--text-muted)", fontSize: 14 }}>{props.children}</div>;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

function InventoryRowCard(props: {
  title: string;
  meta: string;
  stats: Array<{ label: string; value: string }>;
  tone?: "neutral" | "accent";
}) {
  return (
    <article
      style={{
        border: "1px solid rgba(148, 163, 184, 0.14)",
        borderRadius: 16,
        padding: 16,
        background:
          props.tone === "accent"
            ? "radial-gradient(circle at top right, rgba(96, 165, 250, 0.07), transparent 24%), linear-gradient(180deg, rgba(11, 17, 29, 0.96), rgba(6, 10, 19, 0.95))"
            : "linear-gradient(180deg, rgba(11, 17, 29, 0.96), rgba(6, 10, 19, 0.95))",
        display: "grid",
        gap: 12,
      }}
    >
      <div>
        <div style={{ fontWeight: 700, fontSize: "1rem", color: "#f8fafc" }}>{props.title}</div>
        <div style={{ marginTop: 4, color: "var(--text-secondary)", fontSize: 12 }}>{props.meta}</div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
        {props.stats.map((stat) => (
          <div
            key={stat.label}
            style={{
              padding: 12,
              borderRadius: 12,
              background: "rgba(15, 23, 42, 0.58)",
              border: "1px solid rgba(148,163,184,0.08)",
            }}
          >
            <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>{stat.label}</div>
            <div style={{ marginTop: 6, fontWeight: 700 }}>{stat.value}</div>
          </div>
        ))}
      </div>
    </article>
  );
}

export default function InventoryClient({ initialData }: Props) {
  const availableItemKeys = Object.keys(NPC_PRICE_CEILINGS);
  const inventory = useInventorySlice();
  const { personalInventory, businessInventory, shippingQueue, accounts, businesses, businessNamesById, cityNamesById } =
    inventory;

  const [sourceType, setSourceType] = useState<"personal" | "business">("personal");
  const [sourceBusinessId, setSourceBusinessId] = useState(initialData.businesses[0]?.id ?? "");
  const [destinationType, setDestinationType] = useState<"personal" | "business">("business");
  const [destinationBusinessId, setDestinationBusinessId] = useState(initialData.businesses[0]?.id ?? "");
  const [itemKey, setItemKey] = useState(availableItemKeys[0] ?? "");
  const [quantity, setQuantity] = useState("1");
  const [quality, setQuality] = useState("40");
  const [unitPrice, setUnitPrice] = useState("1");
  const [fundingAccountId, setFundingAccountId] = useState(
    initialData.accounts.find((account) => account.account_type === "checking")?.id ?? ""
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [nowMs, setNowMs] = useState(Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    return () => window.clearInterval(interval);
  }, []);

  const businessOptions = useMemo(
    () =>
      businesses.map((business) => ({
        businessId: business.id,
        businessName: business.name,
        businessType: formatBusinessType(business.type),
        cityId: business.city_id,
        balance: business.balance,
      })),
    [businesses]
  );

  const selectedSourceBusiness = useMemo(
    () => businessOptions.find((option) => option.businessId === sourceBusinessId) ?? null,
    [businessOptions, sourceBusinessId]
  );

  const selectedDestinationBusiness = useMemo(
    () => businessOptions.find((option) => option.businessId === destinationBusinessId) ?? null,
    [businessOptions, destinationBusinessId]
  );

  const selectedFundingAccount = useMemo(
    () => accounts.find((account) => account.id === fundingAccountId) ?? null,
    [accounts, fundingAccountId]
  );

  const maxTransferQuantity = useMemo(() => {
    const normalizedItemKey = itemKey.trim();
    const normalizedQuality = Number(quality);
    if (!normalizedItemKey || !Number.isFinite(normalizedQuality) || normalizedQuality < 1) return 0;

    if (sourceType === "personal") {
      return personalInventory
        .filter((row) => row.item_key === normalizedItemKey && row.quality === normalizedQuality)
        .reduce((sum, row) => sum + row.quantity, 0);
    }

    if (!sourceBusinessId) return 0;
    return businessInventory
      .filter(
        (row) =>
          row.business_id === sourceBusinessId &&
          row.item_key === normalizedItemKey &&
          row.quality === normalizedQuality
      )
      .reduce((sum, row) => sum + Math.max(0, row.quantity - row.reserved_quantity), 0);
  }, [businessInventory, itemKey, personalInventory, quality, sourceBusinessId, sourceType]);

  const summary = useMemo(() => {
    const personalUnits = personalInventory.reduce((sum, row) => sum + row.quantity, 0);
    const businessUnits = businessInventory.reduce((sum, row) => sum + row.quantity, 0);
    const reservedUnits = businessInventory.reduce((sum, row) => sum + row.reserved_quantity, 0);
    const readyUnits = businessInventory.reduce((sum, row) => sum + Math.max(0, row.quantity - row.reserved_quantity), 0);
    const shippingUnits = shippingQueue
      .filter((row) => row.status === "in_transit")
      .reduce((sum, row) => sum + row.quantity, 0);
    const shippingCost = shippingQueue
      .filter((row) => row.status === "in_transit")
      .reduce((sum, row) => sum + row.cost, 0);

    return {
      personalUnits,
      businessUnits,
      reservedUnits,
      readyUnits,
      shippingUnits,
      shippingCost,
    };
  }, [businessInventory, personalInventory, shippingQueue]);

  const personalByItem = useMemo(() => {
    const grouped = new Map<string, { quantity: number; averageQuality: number; lines: number }>();
    for (const row of personalInventory) {
      const current = grouped.get(row.item_key) ?? { quantity: 0, averageQuality: 0, lines: 0 };
      const totalQuality = current.averageQuality * current.quantity + row.quality * row.quantity;
      current.quantity += row.quantity;
      current.lines += 1;
      current.averageQuality = current.quantity > 0 ? totalQuality / current.quantity : 0;
      grouped.set(row.item_key, current);
    }

    return [...grouped.entries()]
      .map(([key, value]) => ({ key, ...value }))
      .sort((a, b) => b.quantity - a.quantity);
  }, [personalInventory]);

  const businessByBusiness = useMemo(() => {
    const itemKeysByBusiness = new Map<string, Set<string>>();
    const grouped = new Map<
      string,
      {
        businessId: string;
        businessName: string;
        cityName: string;
        totalUnits: number;
        reservedUnits: number;
        lineCount: number;
      }
    >();

    for (const row of businessInventory) {
      const current = grouped.get(row.business_id) ?? {
        businessId: row.business_id,
        businessName: businessNamesById[row.business_id] ?? row.business_id,
        cityName: cityNamesById[row.city_id] ?? row.city_id,
        totalUnits: 0,
        reservedUnits: 0,
        lineCount: 0,
      };

      current.totalUnits += row.quantity;
      current.reservedUnits += row.reserved_quantity;
      current.lineCount += 1;
      grouped.set(row.business_id, current);

      const itemKeys = itemKeysByBusiness.get(row.business_id) ?? new Set<string>();
      itemKeys.add(row.item_key);
      itemKeysByBusiness.set(row.business_id, itemKeys);
    }

    return [...grouped.values()]
      .map((entry) => ({
        ...entry,
        distinctItems: itemKeysByBusiness.get(entry.businessId)?.size ?? 0,
      }))
      .sort((a, b) => b.totalUnits - a.totalUnits);
  }, [businessInventory, businessNamesById, cityNamesById]);

  const shippingFeed = useMemo(
    () => [...shippingQueue].sort((a, b) => new Date(a.arrives_at).getTime() - new Date(b.arrives_at).getTime()),
    [shippingQueue]
  );

  const transferQuantity = Number(quantity);
  const transferQuality = Number(quality);
  const transferUnitPrice = Number(unitPrice);
  const sourceLabel =
    sourceType === "business"
      ? selectedSourceBusiness?.businessName ?? "Select source business"
      : "Personal inventory";
  const destinationLabel =
    destinationType === "business"
      ? selectedDestinationBusiness?.businessName ?? "Select destination business"
      : "Personal inventory";
  const destinationCityName =
    destinationType === "business"
      ? selectedDestinationBusiness
        ? cityNamesById[selectedDestinationBusiness.cityId] ?? selectedDestinationBusiness.cityId
        : "Select destination business"
      : "Personal destination";
  const routeMode =
    sourceType === "business" &&
    destinationType === "business" &&
    selectedSourceBusiness &&
    selectedDestinationBusiness &&
    selectedSourceBusiness.cityId !== selectedDestinationBusiness.cityId
      ? "Intercity shipping"
      : "Local transfer";
  const isB2B = sourceType === "business" && destinationType === "business";
  const transferInvalid =
    !itemKey.trim() ||
    transferQuantity <= 0 ||
    transferQuality < 1 ||
    transferQuality > 100 ||
    (isB2B && transferUnitPrice < 1) ||
    (sourceType === "business" && !sourceBusinessId) ||
    (destinationType === "business" && !destinationBusinessId) ||
    (sourceType === "business" && destinationType === "business" && sourceBusinessId === destinationBusinessId);

  type TransferResponse = {
    transferType?: "shipping" | "same_city";
    shippingMinutes?: number;
    shippingCost?: number;
    error?: string;
  };

  async function submitTransfer() {
    if (submitting || transferInvalid) return;
    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const data = await apiPost<TransferResponse>(
        apiRoutes.inventory.transfer,
        {
          sourceType,
          sourceBusinessId: sourceType === "business" ? sourceBusinessId : undefined,
          sourceCityId: sourceType === "business" ? selectedSourceBusiness?.cityId : undefined,
          destinationType,
          destinationBusinessId: destinationType === "business" ? destinationBusinessId : undefined,
          destinationCityId: destinationType === "business" ? selectedDestinationBusiness?.cityId : undefined,
          itemKey: itemKey.trim(),
          quantity: transferQuantity,
          quality: transferQuality,
          fundingAccountId: isB2B ? undefined : fundingAccountId,
          unitPrice: isB2B ? transferUnitPrice : undefined,
        },
        { fallbackError: "Transfer failed." }
      );

      setSuccess(
        data.transferType === "shipping"
          ? `Transfer queued for shipping (${data.shippingMinutes ?? 0} min, ${formatCurrency(data.shippingCost ?? 0)}).`
          : "Transfer completed instantly."
      );
      await syncMutationViews({
        businesses: sourceType === "business" || destinationType === "business",
        banking: data.transferType === "shipping" || sourceType === "business" || destinationType === "business",
        inventory: true,
        businessDetails: mergeDetailSyncTargets(
          detailSyncTarget(sourceType === "business" ? sourceBusinessId : null),
          detailSyncTarget(destinationType === "business" ? destinationBusinessId : null)
        ),
      });

    } catch (err) {
      setError(err instanceof Error ? err.message : "Transfer failed.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="anim" style={{ display: "grid", gap: 18 }}>
      <header className="lc-page-header">
        <div>
          <h1>Inventory</h1>
          <p>Your stock and shipments.</p>
        </div>
        <div style={{ alignSelf: "center" }}>
          <Link href="/dashboard">Back to Dashboard</Link>
        </div>
      </header>

      <section
        style={{
          marginTop: 0,
          background:
            "radial-gradient(circle at top left, rgba(34, 197, 94, 0.12), transparent 30%), radial-gradient(circle at top right, rgba(59, 130, 246, 0.12), transparent 28%), linear-gradient(180deg, #08111f 0%, #050912 100%)",
          border: "1px solid rgba(148, 163, 184, 0.18)",
          borderRadius: 18,
          padding: 20,
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ maxWidth: 760 }}>
            <div style={{ fontSize: 12, letterSpacing: "0.2em", textTransform: "uppercase", color: "#cbd5e1" }}>Stock Control</div>
            <div style={{ marginTop: 8, fontSize: "1.95rem", fontWeight: 800, color: "#f8fafc" }}>
              Inventory
            </div>
            <div style={{ marginTop: 8, color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.6 }}>
              Check what you are carrying, what your businesses are holding, and what is still on the road.
            </div>
          </div>
          <div style={{ display: "grid", gap: 8, minWidth: 220 }}>
            <StatusBadge tone={submitting ? "warn" : "good"}>{submitting ? "Transfer Pending" : "Inventory Live"}</StatusBadge>
            <StatusBadge tone={submitting ? "warn" : "neutral"}>
              {submitting ? "Transfer In Flight" : routeMode}
            </StatusBadge>
            <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
              {summary.readyUnits} ready business units across {businessByBusiness.length} operating locations
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12, marginTop: 18 }}>
          <InventoryMetric label="Ready Business Stock" value={`${summary.readyUnits}`} sub={`${summary.reservedUnits} reserved units committed`} tone="positive" />
          <InventoryMetric label="Personal Carry" value={`${summary.personalUnits}`} sub={`${personalInventory.length} personal inventory rows`} tone="accent" />
          <InventoryMetric label="Business Holdings" value={`${summary.businessUnits}`} sub={`${businessInventory.length} inventory rows across owned businesses`} />
          <InventoryMetric label="In Transit" value={`${summary.shippingUnits}`} sub={`${formatCurrency(summary.shippingCost)} committed to live shipments`} tone="warn" />
        </div>
      </section>

      {error ? (
        <div
          style={{
            padding: 12,
            borderRadius: 12,
            border: "1px solid rgba(248, 113, 113, 0.28)",
            background: "rgba(127, 29, 29, 0.22)",
            color: "#fecaca",
          }}
        >
          {error}
        </div>
      ) : null}

      {success ? (
        <div
          style={{
            padding: 12,
            borderRadius: 12,
            border: "1px solid rgba(34, 197, 94, 0.24)",
            background: "rgba(20, 83, 45, 0.18)",
            color: "#bbf7d0",
          }}
        >
          {success}
        </div>
      ) : null}

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.35fr) minmax(320px, 0.9fr)", gap: 18 }}>
        <div style={{ display: "grid", gap: 18 }}>
          <Panel title="Transfer Command" eyebrow="Operations Desk">
            <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.15fr) minmax(280px, 0.85fr)", gap: 18 }}>
              <div style={{ display: "grid", gap: 14 }}>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 12 }}>
                  <label>
                    <FieldLabel><TooltipLabel label="Source Type" content="Choose whether the goods are leaving your personal inventory or one of your businesses." /></FieldLabel>
                    <select value={sourceType} onChange={(event) => setSourceType(event.target.value as "personal" | "business")}>
                      <option value="personal">Personal</option>
                      <option value="business">Business</option>
                    </select>
                  </label>
                  <label>
                    <FieldLabel><TooltipLabel label="Destination Type" content="Choose whether the goods should land in personal inventory or a business inventory." /></FieldLabel>
                    <select
                      value={destinationType}
                      onChange={(event) => setDestinationType(event.target.value as "personal" | "business")}
                    >
                      <option value="personal">Personal</option>
                      <option value="business">Business</option>
                    </select>
                  </label>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>
                  <label>
                    <FieldLabel><TooltipLabel label="Source Business" content="Required when the source type is business. This is the business shipping or releasing the stock." /></FieldLabel>
                    <select
                      value={sourceBusinessId}
                      onChange={(event) => setSourceBusinessId(event.target.value)}
                      disabled={sourceType !== "business"}
                    >
                      <option value="">{sourceType === "business" ? "Select business" : "Not required"}</option>
                      {businessOptions.map((option) => (
                        <option key={option.businessId} value={option.businessId}>
                          {option.businessName} ({option.businessType})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <FieldLabel><TooltipLabel label="Destination Business" content="Required when the destination type is business. This business receives the stock." /></FieldLabel>
                    <select
                      value={destinationBusinessId}
                      onChange={(event) => setDestinationBusinessId(event.target.value)}
                      disabled={destinationType !== "business"}
                    >
                      <option value="">{destinationType === "business" ? "Select business" : "Not required"}</option>
                      {businessOptions.map((option) => (
                        <option key={option.businessId} value={option.businessId}>
                          {option.businessName} ({option.businessType})
                        </option>
                      ))}
                    </select>
                  </label>
                </div>

                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
                  <label>
                    <FieldLabel><TooltipLabel label="Item" content="The specific item key to transfer. Quality and quantity are matched separately." /></FieldLabel>
                    <select value={itemKey} onChange={(event) => setItemKey(event.target.value)}>
                      {availableItemKeys.map((key) => (
                        <option key={key} value={key}>
                          {formatItemKey(key)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <FieldLabel><TooltipLabel label="Quality" content="Transfers only pull from inventory rows with this quality score." /></FieldLabel>
                    <input type="number" min="1" max="100" value={quality} onChange={(event) => setQuality(event.target.value)} />
                  </label>
                  <label>
                    <FieldLabel><TooltipLabel label="Quantity" content="Number of units to transfer from the selected source inventory." /></FieldLabel>
                    <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <input type="number" min="1" value={quantity} onChange={(event) => setQuantity(event.target.value)} />
                      <button
                        type="button"
                        onClick={() => setQuantity(String(maxTransferQuantity))}
                        disabled={submitting || maxTransferQuantity <= 0}
                        style={{
                          border: "1px solid rgba(148, 163, 184, 0.16)",
                          background: "rgba(15, 23, 42, 0.72)",
                          color: "#e2e8f0",
                        }}
                      >
                        Max
                      </button>
                    </div>
                  </label>
                  <label>
                    <FieldLabel><TooltipLabel label={isB2B ? "Unit Price" : "Funding Account"} content={isB2B ? "Business-to-business transfers require a declared per-unit transfer price for the receiving business." : "Personal routes use this account to pay any shipping cost that applies."} /></FieldLabel>
                    {isB2B ? (
                      <input type="number" min="1" step="0.01" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} />
                    ) : (
                      <select value={fundingAccountId} onChange={(event) => setFundingAccountId(event.target.value)}>
                        <option value="">Select account</option>
                        {accounts.map((account) => (
                          <option key={account.id} value={account.id}>
                            {account.account_type} ({formatCurrency(account.balance)})
                          </option>
                        ))}
                      </select>
                    )}
                  </label>
                </div>

                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                  <button onClick={() => void submitTransfer()} disabled={submitting || transferInvalid}>
                    {submitting ? "Submitting..." : "Submit Transfer"}
                  </button>
                  <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                    Available at selected source: {maxTransferQuantity} units
                  </div>
                </div>

                {sourceType === "business" && destinationType === "business" && sourceBusinessId === destinationBusinessId ? (
                  <div style={{ color: "#fca5a5", fontSize: 12 }}>Source and destination businesses must be different.</div>
                ) : null}
              </div>

              <div
                style={{
                  border: "1px solid rgba(148, 163, 184, 0.12)",
                  borderRadius: 16,
                  padding: 16,
                  background: "rgba(8, 13, 24, 0.72)",
                  display: "grid",
                  gap: 12,
                }}
              >
                <div>
                  <div style={{ fontSize: 12, letterSpacing: "0.18em", textTransform: "uppercase", color: "#cbd5e1", marginBottom: 6 }}>
                    Transfer Readout
                  </div>
                  <div style={{ color: "#f8fafc", fontSize: "1.1rem", fontWeight: 700 }}>
                    {formatItemKey(itemKey)} x{Math.max(0, transferQuantity || 0)}
                  </div>
                  <div style={{ color: "var(--text-secondary)", fontSize: 12, marginTop: 4 }}>
                    Quality target Q{transferQuality || 0} from {sourceLabel} to {destinationLabel}
                  </div>
                </div>

                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ color: "var(--text-secondary)" }}><TooltipLabel label="Route mode" content="Local transfers settle instantly. Intercity business routes enter the shipping queue first." /></span>
                    <strong>{routeMode}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ color: "var(--text-secondary)" }}><TooltipLabel label="Destination city" content="The city where the receiving inventory will end up after transfer or shipping." /></span>
                    <strong>{destinationCityName}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ color: "var(--text-secondary)" }}><TooltipLabel label={isB2B ? "Declared unit price" : "Funding source"} content={isB2B ? "The accounting value recorded per unit on a business-to-business inventory move." : "The personal account that will cover route costs when needed."} /></span>
                    <strong>{isB2B ? formatCurrency(transferUnitPrice || 0) : selectedFundingAccount?.account_type ?? "Select account"}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ color: "var(--text-secondary)" }}><TooltipLabel label="Source capacity" content="The maximum matching quantity currently available at the chosen source." /></span>
                    <strong>{maxTransferQuantity} units</strong>
                  </div>
                </div>

                <div style={{ color: "var(--text-muted)", fontSize: 12, lineHeight: 1.6 }}>
                  Personal routes use the selected funding account when shipping costs apply. Business-to-business transfers post as priced inventory movements between operating entities.
                </div>
              </div>
            </div>
          </Panel>
          <Panel title="Business Inventory" eyebrow="Operating Stock">
            {businessByBusiness.length === 0 ? (
              <EmptyState>No business inventory rows yet.</EmptyState>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {businessByBusiness.map((entry) => (
                  <InventoryRowCard
                    key={entry.businessId}
                    title={entry.businessName}
                    meta={`${entry.cityName} inventory position`}
                    tone="accent"
                    stats={[
                      { label: "Total Units", value: `${entry.totalUnits}` },
                      { label: "Ready", value: `${Math.max(0, entry.totalUnits - entry.reservedUnits)}` },
                      { label: "Reserved", value: `${entry.reservedUnits}` },
                      { label: "Item Types", value: `${entry.distinctItems}` },
                      { label: "Rows", value: `${entry.lineCount}` },
                    ]}
                  />
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Shipping Queue" eyebrow="Transit Board">
            {shippingFeed.length === 0 ? (
              <EmptyState>No shipping queue entries.</EmptyState>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {shippingFeed.map((row) => (
                  (() => {
                    const dispatchedMs = new Date(row.dispatched_at).getTime();
                    const arrivesMs = new Date(row.arrives_at).getTime();
                    const progress =
                      row.status === "in_transit" && Number.isFinite(dispatchedMs) && Number.isFinite(arrivesMs) && arrivesMs > dispatchedMs
                        ? clamp((nowMs - dispatchedMs) / (arrivesMs - dispatchedMs), 0, 1)
                        : row.status === "delivered"
                          ? 1
                          : 0;
                    const remainingMs = Math.max(0, arrivesMs - nowMs);
                    const progressColor =
                      row.status === "delivered" ? "#22c55e" : row.status === "cancelled" ? "#ef4444" : "#facc15";

                    return (
                      <article
                        key={row.id}
                        style={{
                          border: "1px solid rgba(148, 163, 184, 0.14)",
                          borderRadius: 16,
                          padding: 16,
                          background: "linear-gradient(180deg, rgba(11, 17, 29, 0.96), rgba(6, 10, 19, 0.95))",
                          display: "grid",
                          gap: 12,
                        }}
                      >
                        <div style={{ display: "flex", justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                          <div>
                            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                              <h3 style={{ margin: 0, fontSize: "1rem" }}>{formatItemKey(row.item_key)}</h3>
                              <StatusBadge
                                tone={row.status === "delivered" ? "good" : row.status === "cancelled" ? "bad" : "warn"}
                              >
                                {row.status.replace("_", " ")}
                              </StatusBadge>
                            </div>
                            <div style={{ marginTop: 6, color: "var(--text-secondary)", fontSize: 12 }}>
                              {cityNamesById[row.from_city_id] ?? row.from_city_id} to {cityNamesById[row.to_city_id] ?? row.to_city_id}
                            </div>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontWeight: 800, fontSize: "1.1rem" }}>{formatCurrency(row.cost)}</div>
                            <div style={{ color: "var(--text-secondary)", fontSize: 12 }}>
                              {row.status === "in_transit" ? `ETA ${formatCountdown(remainingMs)}` : `Arrives ${formatDateTime(row.arrives_at)}`}
                            </div>
                          </div>
                        </div>

                        <div style={{ display: "grid", gap: 8 }}>
                          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12 }}>
                            <span style={{ color: "var(--text-secondary)" }}>Transit progress</span>
                            <strong style={{ color: progressColor }}>
                              {row.status === "in_transit" ? `${Math.round(progress * 100)}% in motion` : row.status.replace("_", " ")}
                            </strong>
                          </div>
                          <div style={{ position: "relative", height: 12, borderRadius: 999, background: "rgba(148,163,184,0.1)", overflow: "hidden" }}>
                            <div
                              style={{
                                width: `${progress * 100}%`,
                                height: "100%",
                                background: progressColor,
                                borderRadius: 999,
                                transition: "width 900ms linear",
                              }}
                            />
                            <div
                              style={{
                                position: "absolute",
                                top: "50%",
                                left: `calc(${progress * 100}% - 7px)`,
                                width: 14,
                                height: 14,
                                borderRadius: 999,
                                transform: "translateY(-50%)",
                                background: progressColor,
                                boxShadow: `0 0 0 4px ${progressColor}22, 0 0 14px ${progressColor}66`,
                                transition: "left 900ms linear",
                              }}
                            />
                          </div>
                        </div>

                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))", gap: 10 }}>
                          <div style={{ padding: 12, borderRadius: 12, background: "rgba(15, 23, 42, 0.58)", border: "1px solid rgba(148,163,184,0.08)" }}>
                            <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>Quantity</div>
                            <div style={{ marginTop: 6, fontWeight: 700 }}>{row.quantity}</div>
                          </div>
                          <div style={{ padding: 12, borderRadius: 12, background: "rgba(15, 23, 42, 0.58)", border: "1px solid rgba(148,163,184,0.08)" }}>
                            <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>Quality</div>
                            <div style={{ marginTop: 6, fontWeight: 700 }}>Q{row.quality}</div>
                          </div>
                          <div style={{ padding: 12, borderRadius: 12, background: "rgba(15, 23, 42, 0.58)", border: "1px solid rgba(148,163,184,0.08)" }}>
                            <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>Destination</div>
                            <div style={{ marginTop: 6, fontWeight: 700, textTransform: "capitalize" }}>{row.destination_type}</div>
                          </div>
                          <div style={{ padding: 12, borderRadius: 12, background: "rgba(15, 23, 42, 0.58)", border: "1px solid rgba(148,163,184,0.08)" }}>
                            <div style={{ fontSize: 11, letterSpacing: "0.14em", textTransform: "uppercase", color: "var(--text-muted)" }}>Declared Price</div>
                            <div style={{ marginTop: 6, fontWeight: 700 }}>
                              {row.declared_unit_price ? formatCurrency(row.declared_unit_price) : "N/A"}
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })()
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div style={{ display: "grid", gap: 18 }}>
          <Panel title="Personal Inventory" eyebrow="Carry Loadout">
            {personalByItem.length === 0 ? (
              <EmptyState>No personal items.</EmptyState>
            ) : (
              <div style={{ display: "grid", gap: 12 }}>
                {personalByItem.map((row) => (
                  <InventoryRowCard
                    key={row.key}
                    title={formatItemKey(row.key)}
                    meta={`${row.lines} stack${row.lines === 1 ? "" : "s"} in personal inventory`}
                    stats={[
                      { label: "Units", value: `${row.quantity}` },
                      { label: "Avg Quality", value: `Q${row.averageQuality.toFixed(0)}` },
                      { label: "Rows", value: `${row.lines}` },
                    ]}
                  />
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Transfer Context" eyebrow="Routing Snapshot">
            <div style={{ display: "grid", gap: 12 }}>
              <div
                style={{
                  padding: 14,
                  borderRadius: 14,
                  border: "1px solid rgba(148, 163, 184, 0.12)",
                  background: "rgba(8, 13, 24, 0.7)",
                }}
              >
                <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10 }}>
                  Route Summary
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ color: "var(--text-secondary)" }}>Source</span>
                    <strong>{sourceLabel}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ color: "var(--text-secondary)" }}>Destination</span>
                    <strong>{destinationLabel}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ color: "var(--text-secondary)" }}>Destination city</span>
                    <strong>{destinationCityName}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ color: "var(--text-secondary)" }}>Selected source balance</span>
                    <strong>{selectedSourceBusiness ? formatCurrency(selectedSourceBusiness.balance) : "N/A"}</strong>
                  </div>
                </div>
              </div>

              <div
                style={{
                  padding: 14,
                  borderRadius: 14,
                  border: "1px solid rgba(148, 163, 184, 0.12)",
                  background: "rgba(8, 13, 24, 0.7)",
                }}
              >
                <div style={{ fontSize: 11, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 10 }}>
                  Funding Snapshot
                </div>
                <div style={{ display: "grid", gap: 8 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ color: "var(--text-secondary)" }}>Account</span>
                    <strong>{selectedFundingAccount?.account_type ?? "None selected"}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ color: "var(--text-secondary)" }}>Balance</span>
                    <strong>{selectedFundingAccount ? formatCurrency(selectedFundingAccount.balance) : "N/A"}</strong>
                  </div>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ color: "var(--text-secondary)" }}>B2B ticket</span>
                    <strong>{isB2B ? formatCurrency((transferQuantity || 0) * (transferUnitPrice || 0)) : "Not applicable"}</strong>
                  </div>
                </div>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
