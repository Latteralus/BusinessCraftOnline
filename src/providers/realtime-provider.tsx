"use client";

import { useEffect, useMemo } from "react";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import {
  getBusinessById,
  getBusinessFinanceDashboard,
  getBusinessUpgradeProjects,
  getBusinessUpgrades,
  getBusinessesWithBalances,
} from "@/domains/businesses";
import { getBusinessInventory } from "@/domains/inventory";
import { getManufacturingStatus, getProductionStatus } from "@/domains/production";
import { getStoreShelfItems } from "@/domains/stores";
import { getUpgradeDefinitionsForBusinessType } from "@/domains/upgrades";
import { fetchAppShell, fetchBankingPageData, fetchBusinessesPageData, fetchChatMessages, fetchContractsPageData, fetchEmployeesPageData, fetchInventoryPageData, fetchMarketPageData, fetchTravelState } from "@/lib/client/queries";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import type { BusinessWithBalance } from "@/domains/businesses";
import type { ChatMessage } from "@/domains/chat";
import type { Contract } from "@/domains/contracts";
import type { Employee } from "@/domains/employees";
import { useGameStore } from "@/stores/game-store";

async function fetchRealtimeToken() {
  const response = await fetch("/api/realtime-auth");
  const payload = (await response.json().catch(() => null)) as { token?: string } | null;
  if (!response.ok || !payload?.token) {
    throw new Error("Failed to create realtime session.");
  }
  return payload.token;
}

export function RealtimeProvider() {
  const hydrated = useGameStore((state) => state.hydrated);
  const playerId = useGameStore((state) => state.player.data.playerId);
  const bankingAccounts = useGameStore((state) => state.banking.data.accounts);
  const trackedBusinessDetailKey = useGameStore((state) =>
    Object.keys(state.businessDetails.data).sort().join("|")
  );
  const setBusinesses = useGameStore((state) => state.setBusinesses);
  const patchBusinesses = useGameStore((state) => state.patchBusinesses);
  const patchBusinessDetail = useGameStore((state) => state.patchBusinessDetail);
  const removeBusiness = useGameStore((state) => state.removeBusiness);
  const removeBusinessDetail = useGameStore((state) => state.removeBusinessDetail);
  const patchContracts = useGameStore((state) => state.patchContracts);
  const setContracts = useGameStore((state) => state.setContracts);
  const removeContract = useGameStore((state) => state.removeContract);
  const patchEmployees = useGameStore((state) => state.patchEmployees);
  const setEmployees = useGameStore((state) => state.setEmployees);
  const removeEmployee = useGameStore((state) => state.removeEmployee);
  const setBanking = useGameStore((state) => state.setBanking);
  const patchBanking = useGameStore((state) => state.patchBanking);
  const setInventory = useGameStore((state) => state.setInventory);
  const patchInventory = useGameStore((state) => state.patchInventory);
  const setMarket = useGameStore((state) => state.setMarket);
  const patchMarket = useGameStore((state) => state.patchMarket);
  const setProduction = useGameStore((state) => state.setProduction);
  const patchProduction = useGameStore((state) => state.patchProduction);
  const setTravel = useGameStore((state) => state.setTravel);
  const patchChat = useGameStore((state) => state.patchChat);
  const setChat = useGameStore((state) => state.setChat);
  const patchAppShell = useGameStore((state) => state.patchAppShell);
  const bankingAccountIds = useMemo(
    () => bankingAccounts.map((account) => account.id),
    [bankingAccounts]
  );
  const trackedBusinessDetailIds = useMemo(
    () => (trackedBusinessDetailKey ? trackedBusinessDetailKey.split("|") : []),
    [trackedBusinessDetailKey]
  );

  useEffect(() => {
    if (!hydrated || !playerId) {
      return;
    }

    let cancelled = false;
    let fallbackInterval: number | null = null;
    let fallbackDelay: number | null = null;
    const supabase = createSupabaseBrowserClient();
    const channels: RealtimeChannel[] = [];
    const businessDetailRefreshes = new Map<string, Promise<void>>();

    const stopFallbackPoll = () => {
      if (fallbackDelay !== null) {
        window.clearTimeout(fallbackDelay);
        fallbackDelay = null;
      }
      if (fallbackInterval !== null) {
        window.clearInterval(fallbackInterval);
        fallbackInterval = null;
      }
    };

    const refillStore = async () => {
      const [appShell, chat, businessesPage, banking, inventory, market, contractsPage, employees, travel] =
        await Promise.all([
          fetchAppShell(),
          fetchChatMessages(),
          fetchBusinessesPageData(),
          fetchBankingPageData(),
          fetchInventoryPageData(),
          fetchMarketPageData(),
          fetchContractsPageData(),
          fetchEmployeesPageData(),
          fetchTravelState(),
        ]);

      if (cancelled) {
        return;
      }

      patchAppShell({
        playerCount: appShell.playerCount,
        onlinePlayers: appShell.onlinePlayers,
        notificationsCount: appShell.notificationsCount,
      });
      setChat(chat.messages);
      setBusinesses(businessesPage.businesses);
      setBanking(banking);
      setInventory(inventory);
      setMarket(market);
      setContracts(contractsPage.contracts);
      setEmployees(employees);
      setTravel(travel);
    };

    const startFallbackPoll = () => {
      stopFallbackPoll();
      fallbackDelay = window.setTimeout(() => {
        void refillStore();
        fallbackInterval = window.setInterval(() => {
          void refillStore();
        }, 60_000);
      }, 5_000);
    };

    const setConnectionStatus = (status: "connecting" | "connected" | "disconnected") => {
      patchAppShell({ connectionStatus: status });
      if (status === "connected") {
        stopFallbackPoll();
      }
      if (status === "disconnected") {
        startFallbackPoll();
      }
    };

    const handleBusinessChange = (payload: RealtimePostgresChangesPayload<BusinessWithBalance>) => {
      if (payload.eventType === "DELETE") {
        const businessId = String(payload.old.id);
        removeBusiness(businessId);
        removeBusinessDetail(businessId);
        return;
      }
      const row = (payload.new ?? payload.old) as BusinessWithBalance;
      if (!row?.id) {
        return;
      }
      patchBusinesses(row);
      if (trackedBusinessDetailIds.includes(String(row.id))) {
        void refreshBusinessDetail(String(row.id));
      }
    };

    const handleContractChange = (payload: RealtimePostgresChangesPayload<Contract>) => {
      if (payload.eventType === "DELETE") {
        removeContract(String(payload.old.id));
        return;
      }
      const row = (payload.new ?? payload.old) as Contract;
      if (!row?.id) {
        return;
      }
      patchContracts(row);
    };

    const handleEmployeeChange = (payload: RealtimePostgresChangesPayload<Employee>) => {
      if (payload.eventType === "DELETE") {
        removeEmployee(String(payload.old.id));
        return;
      }
      const row = (payload.new ?? payload.old) as Employee;
      if (!row?.id) {
        return;
      }
      patchEmployees(row);
    };

    const refreshBusinessDetail = async (businessId: string) => {
      if (businessDetailRefreshes.has(businessId)) {
        return businessDetailRefreshes.get(businessId);
      }

      const job = (async () => {
        const detail = useGameStore.getState().businessDetails.data[businessId];
        if (!detail) {
          return;
        }

        const business = await getBusinessById(supabase, playerId, businessId);
        if (!business) {
          if (!cancelled) {
            removeBusinessDetail(businessId);
          }
          return;
        }

        const isExtraction = ["mine", "farm", "water_company", "logging_camp", "oil_well"].includes(business.type);
        const [production, manufacturing, inventory, shelfItems, upgrades, upgradeProjects, employeesRes, upgradeDefinitions, financeDashboard, ownedBusinesses] =
          await Promise.all([
            isExtraction ? getProductionStatus(supabase, playerId, business.id).catch(() => null) : Promise.resolve(null),
            !isExtraction ? getManufacturingStatus(supabase, playerId, business.id).catch(() => null) : Promise.resolve(null),
            getBusinessInventory(supabase, playerId, business.id).catch(() => []),
            getStoreShelfItems(supabase, playerId, { businessId: business.id }).catch(() => []),
            getBusinessUpgrades(supabase, playerId, business.id).catch(() => []),
            getBusinessUpgradeProjects(supabase, playerId, business.id).catch(() => []),
            supabase
              .from("employees")
              .select("*, employee_assignments(*, business:businesses(*))")
              .eq("player_id", playerId)
              .eq("employer_business_id", business.id)
              .order("created_at", { ascending: false }),
            getUpgradeDefinitionsForBusinessType(supabase, business.type).catch(() => []),
            getBusinessFinanceDashboard(supabase, playerId, business.id, detail.financeDashboard?.currentPeriod ?? "1h").catch(() => null),
            getBusinessesWithBalances(supabase, playerId).catch(() => []),
          ]);

        if (!cancelled) {
          patchBusinessDetail(businessId, {
            business,
            production,
            manufacturing,
            inventory,
            shelfItems,
            upgrades,
            upgradeProjects,
            employees: (employeesRes.data ?? []) as any,
            financeDashboard,
            ownedBusinesses,
            upgradeDefinitions,
          });
        }
      })()
        .catch(() => {
          // Keep existing detail state when a realtime refresh fails.
        })
        .finally(() => {
          businessDetailRefreshes.delete(businessId);
        });

      businessDetailRefreshes.set(businessId, job);
      return job;
    };

    const refreshSelectedProduction = async () => {
      const currentProduction = useGameStore.getState().production.data;
      if (!currentProduction.selectedBusinessId) {
        return;
      }

      const selectedBusiness = useGameStore
        .getState()
        .businesses.data.find((business) => business.id === currentProduction.selectedBusinessId);

      if (!selectedBusiness) {
        return;
      }

      const manufacturing = await getManufacturingStatus(
        supabase,
        playerId,
        currentProduction.selectedBusinessId
      ).catch(() => null);

      if (!cancelled) {
        patchProduction({
          businesses: useGameStore.getState().businesses.data,
          selectedBusinessId: currentProduction.selectedBusinessId,
          manufacturing,
        });
      }
    };

    const refreshBusinessBalances = async () => {
      const businesses = await getBusinessesWithBalances(supabase, playerId).catch(() => null);
      if (!businesses || cancelled) {
        return;
      }

      setBusinesses(businesses);
      patchBanking({ businesses });
      patchInventory({ businesses });
      patchMarket({ businesses });
      patchProduction({ businesses });
    };

    async function connect() {
      setConnectionStatus("connecting");
      try {
        const token = await fetchRealtimeToken();
        if (cancelled) {
          return;
        }

        supabase.realtime.setAuth(token);

        const playerChannel = supabase
          .channel(`player-shell-${playerId}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "players", filter: `id=eq.${playerId}` }, () => {
            void refillStore();
          })
          .on("postgres_changes", { event: "*", schema: "public", table: "characters", filter: `player_id=eq.${playerId}` }, () => {
            void refillStore();
          })
          .subscribe((status) => {
            if (!cancelled) {
              setConnectionStatus(status === "SUBSCRIBED" ? "connected" : "disconnected");
            }
          });
        channels.push(playerChannel);

        const businessesChannel = supabase
          .channel(`businesses-${playerId}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "businesses", filter: `player_id=eq.${playerId}` }, handleBusinessChange)
          .subscribe();
        channels.push(businessesChannel);

        const employeesChannel = supabase
          .channel(`employees-${playerId}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "employees", filter: `player_id=eq.${playerId}` }, handleEmployeeChange)
          .subscribe();
        channels.push(employeesChannel);

        const contractsChannel = supabase
          .channel(`contracts-${playerId}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "contracts", filter: `owner_player_id=eq.${playerId}` }, handleContractChange)
          .subscribe();
        channels.push(contractsChannel);

        const chatChannel = supabase
          .channel("global-chat")
          .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, (payload) => {
            patchChat(payload.new as ChatMessage);
          })
          .subscribe();
        channels.push(chatChannel);

        const appShellChannel = supabase
          .channel(`app-shell-${playerId}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "market_storefront_settings", filter: `player_id=eq.${playerId}` }, () => {
            void fetchAppShell().then((data) => {
              if (!cancelled) {
                patchAppShell(data);
              }
            });
          })
          .subscribe();
        channels.push(appShellChannel);

        const inventoryChannel = supabase
          .channel(`inventory-${playerId}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "personal_inventory", filter: `player_id=eq.${playerId}` }, () => {
            void fetchInventoryPageData().then((data) => !cancelled && setInventory(data));
          })
          .on("postgres_changes", { event: "*", schema: "public", table: "business_inventory", filter: `owner_player_id=eq.${playerId}` }, () => {
            void fetchInventoryPageData().then((data) => !cancelled && setInventory(data));
          })
          .on("postgres_changes", { event: "*", schema: "public", table: "shipping_queue", filter: `owner_player_id=eq.${playerId}` }, () => {
            void fetchInventoryPageData().then((data) => !cancelled && setInventory(data));
          })
          .subscribe();
        channels.push(inventoryChannel);

        const bankingChannel = supabase
          .channel(`banking-${playerId}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "bank_accounts", filter: `player_id=eq.${playerId}` }, () => {
            void fetchBankingPageData().then((data) => !cancelled && setBanking(data));
          })
          .on("postgres_changes", { event: "*", schema: "public", table: "loans", filter: `player_id=eq.${playerId}` }, () => {
            void fetchBankingPageData().then((data) => !cancelled && setBanking(data));
          })
          .subscribe();
        channels.push(bankingChannel);

        if (bankingAccountIds.length > 0) {
          const transactionsChannel = supabase
            .channel(`transactions-${playerId}`)
            .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, (payload) => {
              const rowAccountId = String((payload.new as { account_id?: string } | null)?.account_id ?? (payload.old as { account_id?: string } | null)?.account_id ?? "");
              if (bankingAccountIds.includes(rowAccountId)) {
                void fetchBankingPageData().then((data) => !cancelled && setBanking(data));
              }
            })
            .subscribe();
          channels.push(transactionsChannel);
        }

        const businessBalancesChannel = supabase
          .channel(`business-balances-${playerId}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "business_accounts" }, (payload) => {
            const businessId = String(
              (payload.new as { business_id?: string } | null)?.business_id ??
              (payload.old as { business_id?: string } | null)?.business_id ??
              ""
            );
            if (!businessId) {
              return;
            }

            const trackedBusinessIds = new Set(useGameStore.getState().businesses.data.map((business) => business.id));
            if (!trackedBusinessIds.has(businessId)) {
              return;
            }

            void refreshBusinessBalances();
          })
          .subscribe();
        channels.push(businessBalancesChannel);

        const marketChannel = supabase
          .channel(`market-${playerId}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "market_listings" }, () => {
            void fetchMarketPageData().then((data) => !cancelled && setMarket(data));
          })
          .subscribe();
        channels.push(marketChannel);

        const productionChannel = supabase
          .channel(`production-${playerId}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "manufacturing_jobs" }, () => {
            void refreshSelectedProduction();
          })
          .on("postgres_changes", { event: "*", schema: "public", table: "manufacturing_lines" }, () => {
            void refreshSelectedProduction();
          })
          .subscribe();
        channels.push(productionChannel);

        const travelChannel = supabase
          .channel(`travel-${playerId}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "travel_log", filter: `player_id=eq.${playerId}` }, () => {
            void fetchTravelState().then((data) => !cancelled && setTravel(data));
          })
          .subscribe();
        channels.push(travelChannel);

        for (const businessId of trackedBusinessDetailIds) {
          const businessDetailChannel = supabase
            .channel(`business-detail-${playerId}-${businessId}`)
            .on("postgres_changes", { event: "*", schema: "public", table: "businesses", filter: `id=eq.${businessId}` }, () => {
              void refreshBusinessDetail(businessId);
            })
            .on("postgres_changes", { event: "*", schema: "public", table: "business_accounts", filter: `business_id=eq.${businessId}` }, () => {
              void refreshBusinessDetail(businessId);
            })
            .on("postgres_changes", { event: "*", schema: "public", table: "business_financial_events", filter: `business_id=eq.${businessId}` }, () => {
              void refreshBusinessDetail(businessId);
            })
            .on("postgres_changes", { event: "*", schema: "public", table: "business_inventory", filter: `business_id=eq.${businessId}` }, () => {
              void refreshBusinessDetail(businessId);
            })
            .on("postgres_changes", { event: "*", schema: "public", table: "store_shelf_items", filter: `business_id=eq.${businessId}` }, () => {
              void refreshBusinessDetail(businessId);
            })
            .on("postgres_changes", { event: "*", schema: "public", table: "business_upgrades", filter: `business_id=eq.${businessId}` }, () => {
              void refreshBusinessDetail(businessId);
            })
            .on("postgres_changes", { event: "*", schema: "public", table: "business_upgrade_projects", filter: `business_id=eq.${businessId}` }, () => {
              void refreshBusinessDetail(businessId);
            })
            .on("postgres_changes", { event: "*", schema: "public", table: "extraction_slots", filter: `business_id=eq.${businessId}` }, () => {
              void refreshBusinessDetail(businessId);
            })
            .on("postgres_changes", { event: "*", schema: "public", table: "manufacturing_lines", filter: `business_id=eq.${businessId}` }, () => {
              void refreshBusinessDetail(businessId);
            })
            .on("postgres_changes", { event: "*", schema: "public", table: "manufacturing_jobs", filter: `business_id=eq.${businessId}` }, () => {
              void refreshBusinessDetail(businessId);
            })
            .on("postgres_changes", { event: "*", schema: "public", table: "employee_assignments", filter: `business_id=eq.${businessId}` }, () => {
              void refreshBusinessDetail(businessId);
            })
            .subscribe();
          channels.push(businessDetailChannel);
        }

        if (trackedBusinessDetailIds.length > 0) {
          const extractionToolChannel = supabase
            .channel(`business-detail-tools-${playerId}`)
            .on("postgres_changes", { event: "*", schema: "public", table: "tool_durability" }, () => {
              for (const businessId of trackedBusinessDetailIds) {
                const detail = useGameStore.getState().businessDetails.data[businessId];
                if (detail?.production) {
                  void refreshBusinessDetail(businessId);
                }
              }
            })
            .subscribe();
          channels.push(extractionToolChannel);
        }
      } catch {
        if (!cancelled) {
          setConnectionStatus("disconnected");
        }
      }
    }

    void connect();

    return () => {
      cancelled = true;
      stopFallbackPoll();
      for (const channel of channels) {
        void supabase.removeChannel(channel);
      }
    };
  }, [
    bankingAccountIds,
    hydrated,
    patchAppShell,
    patchBanking,
    patchBusinesses,
    patchBusinessDetail,
    patchChat,
    patchContracts,
    patchEmployees,
    patchInventory,
    patchMarket,
    playerId,
    removeBusiness,
    removeBusinessDetail,
    removeContract,
    removeEmployee,
    setBanking,
    setBusinesses,
    setChat,
    setContracts,
    setEmployees,
    setInventory,
    setMarket,
    patchProduction,
    setProduction,
    setTravel,
    trackedBusinessDetailIds,
  ]);

  return null;
}
