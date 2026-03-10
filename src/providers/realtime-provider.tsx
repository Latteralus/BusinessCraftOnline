"use client";

import { useEffect } from "react";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { fetchAppShell, fetchBankingPageData, fetchBusinessesPageData, fetchChatMessages, fetchContractsPageData, fetchEmployeesPageData, fetchInventoryPageData, fetchMarketPageData, fetchProductionPageData, fetchTravelState } from "@/lib/client/queries";
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
  const bankingAccountIds = useGameStore((state) => state.banking.data.accounts.map((account) => account.id));
  const setBusinesses = useGameStore((state) => state.setBusinesses);
  const patchBusinesses = useGameStore((state) => state.patchBusinesses);
  const removeBusiness = useGameStore((state) => state.removeBusiness);
  const patchContracts = useGameStore((state) => state.patchContracts);
  const setContracts = useGameStore((state) => state.setContracts);
  const removeContract = useGameStore((state) => state.removeContract);
  const patchEmployees = useGameStore((state) => state.patchEmployees);
  const setEmployees = useGameStore((state) => state.setEmployees);
  const removeEmployee = useGameStore((state) => state.removeEmployee);
  const setBanking = useGameStore((state) => state.setBanking);
  const setInventory = useGameStore((state) => state.setInventory);
  const setMarket = useGameStore((state) => state.setMarket);
  const setProduction = useGameStore((state) => state.setProduction);
  const setTravel = useGameStore((state) => state.setTravel);
  const patchChat = useGameStore((state) => state.patchChat);
  const setChat = useGameStore((state) => state.setChat);
  const patchAppShell = useGameStore((state) => state.patchAppShell);

  useEffect(() => {
    if (!hydrated || !playerId) {
      return;
    }

    let cancelled = false;
    let fallbackInterval: number | null = null;
    let fallbackDelay: number | null = null;
    const supabase = createSupabaseBrowserClient();
    const channels: RealtimeChannel[] = [];

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
      const [appShell, chat, businessesPage, banking, inventory, market, contractsPage, employees, production, travel] =
        await Promise.all([
          fetchAppShell(),
          fetchChatMessages(),
          fetchBusinessesPageData(),
          fetchBankingPageData(),
          fetchInventoryPageData(),
          fetchMarketPageData(),
          fetchContractsPageData(),
          fetchEmployeesPageData(),
          fetchProductionPageData(),
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
      setProduction(production);
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
        removeBusiness(String(payload.old.id));
        return;
      }
      const row = (payload.new ?? payload.old) as BusinessWithBalance;
      if (!row?.id) {
        return;
      }
      patchBusinesses(row);
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
            void fetchProductionPageData().then((data) => !cancelled && setProduction(data));
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
    patchBusinesses,
    patchChat,
    patchContracts,
    patchEmployees,
    playerId,
    removeBusiness,
    removeContract,
    removeEmployee,
    setBanking,
    setBusinesses,
    setChat,
    setContracts,
    setEmployees,
    setInventory,
    setMarket,
    setProduction,
    setTravel,
  ]);

  return null;
}
