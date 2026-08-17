"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import type { RealtimeChannel, RealtimePostgresChangesPayload, SupabaseClient } from "@supabase/supabase-js";
import { getBusinessesWithBalances } from "@/domains/businesses";
import { getManufacturingStatus } from "@/domains/production";
import { fetchAppShell, fetchBankingPageData, fetchBusinessDetailsState, fetchBusinessesPageData, fetchChatMessages, fetchContractsPageData, fetchEmployeesPageData, fetchInventoryPageData, fetchMailbox, fetchMarketPageData, fetchProductionPageData, fetchTravelState } from "@/lib/client/queries";
import { createSupabaseBrowserClient } from "@/lib/supabase";
import type { BusinessWithBalance } from "@/domains/businesses";
import type { ChatMessage } from "@/domains/chat";
import type { Contract } from "@/domains/contracts";
import type { Employee } from "@/domains/employees";
import { useGameStore } from "@/stores/game-store";
import { runGuardedSliceFetch, SLICE_KEYS } from "@/stores/slice-fetch-guard";

async function fetchRealtimeToken() {
  const response = await fetch("/api/realtime-auth");
  const payload = (await response.json().catch(() => null)) as { token?: string } | null;
  if (!response.ok || !payload?.token) {
    throw new Error("Failed to create realtime session.");
  }
  return payload.token;
}

// Coalesces concurrent calls for the same key into one in-flight promise, and
// re-runs once more if another call comes in while the first is still running.
function createRefreshCoalescer(isCancelled: () => boolean) {
  const inFlight = new Map<string, Promise<void>>();
  const queued = new Set<string>();

  return function runRefresh(key: string, task: () => Promise<void>): Promise<void> {
    const existing = inFlight.get(key);
    if (existing) {
      queued.add(key);
      return existing;
    }

    const job = task()
      .catch(() => undefined)
      .finally(() => {
        inFlight.delete(key);
        if (queued.has(key) && !isCancelled()) {
          queued.delete(key);
          void runRefresh(key, task);
        }
      });
    inFlight.set(key, job);
    return job;
  };
}

export function RealtimeProvider() {
  const pathname = usePathname();
  const hydrated = useGameStore((state) => state.hydrated);
  const playerId = useGameStore((state) => state.player.data.playerId);
  const bankingAccountIdsKey = useGameStore((state) =>
    state.banking.data.accounts
      .map((account) => account.id)
      .sort()
      .join("|")
  );
  const ownedBusinessIdsKey = useGameStore((state) =>
    state.businesses.data
      .map((business) => business.id)
      .sort()
      .join("|")
  );
  const selectedProductionBusinessId = useGameStore((state) => state.production.data.selectedBusinessId);
  const trackedBusinessDetailKey = useGameStore((state) =>
    Object.keys(state.businessDetails.data).sort().join("|")
  );
  const trackedExtractionSlotIdsKey = useGameStore((state) => {
    const slotIds = new Set<string>();
    for (const detail of Object.values(state.businessDetails.data)) {
      for (const slot of detail.production?.slots ?? []) {
        if (slot.id) {
          slotIds.add(String(slot.id));
        }
      }
    }
    return Array.from(slotIds).sort().join("|");
  });
  const mailThreadIdsKey = useGameStore((state) =>
    state.mail.data.threads
      .map((thread) => thread.id)
      .sort()
      .join("|")
  );
  const activeMailThreadId = useGameStore((state) => state.mail.data.activeThread?.id ?? null);
  const mailLoadedAt = useGameStore((state) => state.mail.lastUpdated);
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
  const setMail = useGameStore((state) => state.setMail);
  const patchAppShell = useGameStore((state) => state.patchAppShell);

  const bankingAccountIds = useMemo(
    () => (bankingAccountIdsKey ? bankingAccountIdsKey.split("|") : []),
    [bankingAccountIdsKey]
  );
  const ownedBusinessIds = useMemo(
    () => (ownedBusinessIdsKey ? ownedBusinessIdsKey.split("|") : []),
    [ownedBusinessIdsKey]
  );
  const trackedBusinessDetailIds = useMemo(
    () => (trackedBusinessDetailKey ? trackedBusinessDetailKey.split("|") : []),
    [trackedBusinessDetailKey]
  );
  const trackedExtractionSlotIds = useMemo(
    () => (trackedExtractionSlotIdsKey ? trackedExtractionSlotIdsKey.split("|") : []),
    [trackedExtractionSlotIdsKey]
  );
  const mailThreadIds = useMemo(
    () => (mailThreadIdsKey ? mailThreadIdsKey.split("|") : []),
    [mailThreadIdsKey]
  );
  const activeRealtimeModules = useMemo(() => {
    const path = pathname ?? "";
    // BusinessesClient renders a selected business's detail panel in place on
    // /businesses without changing the URL (see NavBarFix), so gating purely
    // on pathname missed that case entirely. trackedBusinessDetailIds reflects
    // whichever business detail entries are actually loaded in the store right
    // now, so it doubles as "is a detail panel currently being viewed."
    return {
      dashboard: path === "/dashboard" || path === "/",
      businesses: path === "/businesses",
      businessDetail: path.startsWith("/businesses/") || (path === "/businesses" && trackedBusinessDetailIds.length > 0),
      banking: path === "/banking",
      inventory: path === "/inventory",
      market: path === "/market",
      contracts: path === "/contracts",
      employees: path === "/employees",
      production: path === "/production",
      travel: path === "/travel",
    };
  }, [pathname, trackedBusinessDetailIds]);

  // One realtime client for the whole authenticated session -- created once,
  // not recreated on every navigation. The socket connection and its auth
  // token are owned by the identity effect below; route-scoped channels just
  // add/remove subscriptions on this same client.
  const [supabase] = useState<SupabaseClient>(() => createSupabaseBrowserClient());
  const [identityReady, setIdentityReady] = useState(false);

  // Route- and mail-scoped refreshes need to run from the identity effect's
  // fallback poll (when the socket is down) without the poll itself
  // depending on route/mail state -- these refs let the identity effect
  // always call the *current* refresh logic without being torn down by it.
  const routeRefreshRef = useRef<() => Promise<void>>(async () => {});
  const mailRefreshRef = useRef<() => Promise<void>>(async () => {});

  // ---------------------------------------------------------------------
  // Identity effect: owns the socket connection, its auth token, and the
  // channels that depend only on who's logged in -- never on which page
  // they're viewing. This used to be folded into one large effect keyed
  // partly on pathname, which meant every in-app navigation tore down and
  // reconnected every channel (including a fresh /api/realtime-auth fetch).
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!hydrated || !playerId) {
      setIdentityReady(false);
      return;
    }

    let cancelled = false;
    let fallbackInterval: number | null = null;
    let fallbackDelay: number | null = null;
    const channels: RealtimeChannel[] = [];
    const runRefresh = createRefreshCoalescer(() => cancelled);

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

    const refreshShellEssentials = () => runRefresh("shell", async () => {
      const [appShell, chat] = await Promise.all([fetchAppShell(), fetchChatMessages()]);
      if (cancelled) return;
      patchAppShell(appShell);
      setChat(chat.messages);
    });

    const refillStore = async () => {
      await Promise.all([refreshShellEssentials(), mailRefreshRef.current(), routeRefreshRef.current()]);
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

    async function connect() {
      setConnectionStatus("connecting");
      setIdentityReady(false);
      try {
        const token = await fetchRealtimeToken();
        if (cancelled) return;

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
              if (!cancelled) patchAppShell(data);
            });
          })
          .subscribe();
        channels.push(appShellChannel);

        if (!cancelled) setIdentityReady(true);
      } catch (err) {
        console.error("[realtime] identity connection failed:", err);
        if (!cancelled) setConnectionStatus("disconnected");
      }
    }

    void connect();

    return () => {
      cancelled = true;
      stopFallbackPoll();
      setIdentityReady(false);
      for (const channel of channels) {
        void supabase.removeChannel(channel);
      }
    };
    // Deliberately NOT keyed on pathname/activeRealtimeModules -- this effect
    // must survive in-app navigation untouched. See changelog 2026-08-17 (C3).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, playerId, supabase, patchAppShell, patchChat, setChat]);

  // ---------------------------------------------------------------------
  // Mail effect: mail_threads/mail_messages are broadcast without a
  // player_id column to filter on, so every player's mail activity used to
  // reach every connected client. Scope both channels to the current
  // player's own thread ids -- mail_thread_participants (already filtered
  // to this player) covers "a brand new thread was created for me," since
  // that insert triggers a full mailbox refetch that already includes the
  // new thread's latest message.
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!hydrated || !playerId || !identityReady) {
      mailRefreshRef.current = async () => {};
      return;
    }

    let cancelled = false;
    const channels: RealtimeChannel[] = [];
    const runRefresh = createRefreshCoalescer(() => cancelled);

    const refreshMail = async () => {
      const currentActiveThreadId = useGameStore.getState().mail.data.activeThread?.id ?? undefined;
      const currentRecipientSearchResults = useGameStore.getState().mail.data.recipientSearchResults;
      const [appShell, mailbox] = await Promise.all([
        fetchAppShell().catch(() => null),
        useGameStore.getState().mail.lastUpdated !== null
          ? fetchMailbox(currentActiveThreadId).catch(() => null)
          : Promise.resolve(null),
      ]);

      if (cancelled) return;

      if (appShell) {
        patchAppShell({ unreadMailCount: appShell.unreadMailCount });
      }

      if (mailbox) {
        setMail({
          threads: mailbox.threads,
          activeThread: mailbox.activeThread,
          recipientSearchResults: currentRecipientSearchResults,
        });
      }
    };

    mailRefreshRef.current = () => runRefresh("mail", refreshMail);

    const mailParticipantsChannel = supabase
      .channel(`mail-participants-${playerId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "mail_thread_participants", filter: `player_id=eq.${playerId}` }, () => {
        void mailRefreshRef.current();
      })
      .subscribe();
    channels.push(mailParticipantsChannel);

    if (mailThreadIds.length > 0) {
      const threadIdFilter = mailThreadIds.join(",");

      const mailThreadsChannel = supabase
        .channel(`mail-threads-${playerId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "mail_threads", filter: `id=in.(${threadIdFilter})` }, () => {
          void mailRefreshRef.current();
        })
        .subscribe();
      channels.push(mailThreadsChannel);

      const mailMessagesChannel = supabase
        .channel(`mail-messages-${playerId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "mail_messages", filter: `thread_id=in.(${threadIdFilter})` }, () => {
          void mailRefreshRef.current();
        })
        .subscribe();
      channels.push(mailMessagesChannel);
    }

    return () => {
      cancelled = true;
      mailRefreshRef.current = async () => {};
      for (const channel of channels) {
        void supabase.removeChannel(channel);
      }
    };
  }, [hydrated, playerId, identityReady, supabase, mailThreadIdsKey, mailThreadIds, activeMailThreadId, mailLoadedAt, patchAppShell, setMail]);

  // ---------------------------------------------------------------------
  // Route effect: every channel whose relevance depends on which page is
  // active, or on which businesses/accounts the player owns. This is the
  // only effect that re-subscribes on navigation -- and it consolidates
  // what used to be one realtime channel per owned business/account into a
  // single filter-scoped channel per table via `in.(...)`.
  // ---------------------------------------------------------------------
  useEffect(() => {
    if (!hydrated || !playerId || !identityReady) {
      routeRefreshRef.current = async () => {};
      return;
    }

    let cancelled = false;
    const channels: RealtimeChannel[] = [];
    const runRefresh = createRefreshCoalescer(() => cancelled);
    const businessDetailRefreshes = new Map<string, Promise<void>>();
    const pendingBusinessDetailRefreshes = new Set<string>();

    const handleBusinessChange = (payload: RealtimePostgresChangesPayload<BusinessWithBalance>) => {
      if (payload.eventType === "DELETE") {
        const businessId = String(payload.old.id);
        removeBusiness(businessId);
        removeBusinessDetail(businessId);
        return;
      }
      const row = (payload.new ?? payload.old) as BusinessWithBalance;
      if (!row?.id) return;
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
      if (!row?.id) return;
      patchContracts(row);
    };

    const refreshTrackedBusinessDetailsForEmployee = (employee: Partial<Employee> & { id?: string | number | null }) => {
      const employeeId = employee.id ? String(employee.id) : null;
      const employerBusinessId = employee.employer_business_id ? String(employee.employer_business_id) : null;
      if (!employeeId && !employerBusinessId) return;

      for (const businessId of trackedBusinessDetailIds) {
        const detail = useGameStore.getState().businessDetails.data[businessId];
        if (!detail) continue;

        const tracksEmployee =
          (employeeId ? detail.employees.some((entry) => entry.id === employeeId) : false) ||
          (employerBusinessId ? detail.business.id === employerBusinessId : false);

        if (tracksEmployee) {
          void refreshBusinessDetail(businessId);
        }
      }
    };

    const handleEmployeeChange = (payload: RealtimePostgresChangesPayload<Employee>) => {
      if (payload.eventType === "DELETE") {
        refreshTrackedBusinessDetailsForEmployee(payload.old as Partial<Employee>);
        removeEmployee(String(payload.old.id));
        return;
      }
      const row = (payload.new ?? payload.old) as Employee;
      if (!row?.id) return;
      patchEmployees(row);
      refreshTrackedBusinessDetailsForEmployee(row);
    };

    const refreshBusinessDetail = async (businessId: string) => {
      if (businessDetailRefreshes.has(businessId)) {
        pendingBusinessDetailRefreshes.add(businessId);
        return businessDetailRefreshes.get(businessId);
      }

      const job = (async () => {
        const detail = useGameStore.getState().businessDetails.data[businessId];
        if (!detail) return;

        await runGuardedSliceFetch(
          SLICE_KEYS.businessDetail(businessId),
          () =>
            fetchBusinessDetailsState(businessId, detail.financeDashboard?.currentPeriod ?? "1h").catch(() => null),
          (refreshedDetail) => {
            if (refreshedDetail && !cancelled) {
              patchBusinessDetail(businessId, refreshedDetail);
            }
          }
        );
      })()
        .catch(() => {
          // Keep existing detail state when a realtime refresh fails.
        })
        .finally(() => {
          businessDetailRefreshes.delete(businessId);
          if (pendingBusinessDetailRefreshes.has(businessId) && !cancelled) {
            pendingBusinessDetailRefreshes.delete(businessId);
            void refreshBusinessDetail(businessId);
          }
        });

      businessDetailRefreshes.set(businessId, job);
      return job;
    };

    const refreshSelectedProduction = async () => {
      const currentProduction = useGameStore.getState().production.data;
      if (!currentProduction.selectedBusinessId) return;

      const selectedBusiness = useGameStore
        .getState()
        .businesses.data.find((business) => business.id === currentProduction.selectedBusinessId);

      if (!selectedBusiness) return;

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
      await runGuardedSliceFetch(
        SLICE_KEYS.businesses,
        () => getBusinessesWithBalances(supabase, playerId).catch(() => null),
        (businesses) => {
          if (!businesses || cancelled) return;
          setBusinesses(businesses);
          patchBanking({ businesses });
          patchInventory({ businesses });
          patchMarket({ businesses });
          patchProduction({ businesses });
        }
      );
    };

    const refreshActiveRouteData = () => runRefresh("active-route", async () => {
      const tasks: Promise<void>[] = [];

      if (activeRealtimeModules.dashboard || activeRealtimeModules.businesses) {
        tasks.push(runGuardedSliceFetch(SLICE_KEYS.businesses, fetchBusinessesPageData, (data) => {
          if (!cancelled) {
            setBusinesses(data.businesses);
            setTravel(data.travelState);
          }
        }));
      }
      if (activeRealtimeModules.banking) {
        tasks.push(runGuardedSliceFetch(SLICE_KEYS.banking, fetchBankingPageData, (data) => {
          if (!cancelled) setBanking(data);
        }));
      }
      if (activeRealtimeModules.inventory) {
        tasks.push(runGuardedSliceFetch(SLICE_KEYS.inventory, fetchInventoryPageData, (data) => {
          if (!cancelled) setInventory(data);
        }));
      }
      if (activeRealtimeModules.market) {
        tasks.push(runGuardedSliceFetch(SLICE_KEYS.market, fetchMarketPageData, (data) => {
          if (!cancelled) setMarket(data);
        }));
      }
      if (activeRealtimeModules.production) {
        tasks.push(runGuardedSliceFetch(SLICE_KEYS.production, fetchProductionPageData, (data) => {
          if (!cancelled) setProduction(data);
        }));
      }
      if (activeRealtimeModules.contracts) {
        tasks.push(runGuardedSliceFetch(SLICE_KEYS.contracts, fetchContractsPageData, (data) => {
          if (!cancelled) {
            setContracts(data.contracts);
            setBusinesses(data.businesses);
          }
        }));
      }
      if (activeRealtimeModules.employees) {
        tasks.push(runGuardedSliceFetch(SLICE_KEYS.employees, fetchEmployeesPageData, (data) => {
          if (!cancelled) setEmployees(data);
        }));
      }
      if (activeRealtimeModules.travel) {
        tasks.push(fetchTravelState().then((data) => {
          if (!cancelled) setTravel(data);
        }));
      }
      if (activeRealtimeModules.businessDetail) {
        for (const businessId of trackedBusinessDetailIds) {
          tasks.push(refreshBusinessDetail(businessId).then(() => undefined));
        }
      }

      await Promise.all(tasks);
    });

    routeRefreshRef.current = refreshActiveRouteData;

    if (activeRealtimeModules.dashboard || activeRealtimeModules.businesses || activeRealtimeModules.businessDetail) {
      const businessesChannel = supabase
        .channel(`businesses-${playerId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "businesses", filter: `player_id=eq.${playerId}` }, handleBusinessChange)
        .subscribe();
      channels.push(businessesChannel);
    }

    if (activeRealtimeModules.employees || activeRealtimeModules.businessDetail) {
      const employeesChannel = supabase
        .channel(`employees-${playerId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "employees", filter: `player_id=eq.${playerId}` }, handleEmployeeChange)
        .subscribe();
      channels.push(employeesChannel);
    }

    if (activeRealtimeModules.contracts) {
      const contractsChannel = supabase
        .channel(`contracts-${playerId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "contracts", filter: `owner_player_id=eq.${playerId}` }, handleContractChange)
        .subscribe();
      channels.push(contractsChannel);
    }

    if (activeRealtimeModules.inventory) {
      const inventoryChannel = supabase
        .channel(`inventory-${playerId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "personal_inventory", filter: `player_id=eq.${playerId}` }, () => {
          void runRefresh("inventory", () =>
            runGuardedSliceFetch(SLICE_KEYS.inventory, fetchInventoryPageData, (data) => {
              if (!cancelled) setInventory(data);
            })
          );
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "business_inventory", filter: `owner_player_id=eq.${playerId}` }, () => {
          void runRefresh("inventory", () =>
            runGuardedSliceFetch(SLICE_KEYS.inventory, fetchInventoryPageData, (data) => {
              if (!cancelled) setInventory(data);
            })
          );
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "shipping_queue", filter: `owner_player_id=eq.${playerId}` }, () => {
          void runRefresh("inventory", () =>
            runGuardedSliceFetch(SLICE_KEYS.inventory, fetchInventoryPageData, (data) => {
              if (!cancelled) setInventory(data);
            })
          );
        })
        .subscribe();
      channels.push(inventoryChannel);
    }

    if (activeRealtimeModules.banking) {
      const bankingChannel = supabase
        .channel(`banking-${playerId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "bank_accounts", filter: `player_id=eq.${playerId}` }, () => {
          void runRefresh("banking", () =>
            runGuardedSliceFetch(SLICE_KEYS.banking, fetchBankingPageData, (data) => {
              if (!cancelled) setBanking(data);
            })
          );
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "loans", filter: `player_id=eq.${playerId}` }, () => {
          void runRefresh("banking", () =>
            runGuardedSliceFetch(SLICE_KEYS.banking, fetchBankingPageData, (data) => {
              if (!cancelled) setBanking(data);
            })
          );
        })
        .subscribe();
      channels.push(bankingChannel);

      // One channel covering every owned personal account instead of one
      // channel per account -- Postgres changes filters support `in.(...)`.
      if (bankingAccountIds.length > 0) {
        const transactionsChannel = supabase
          .channel(`transactions-${playerId}`)
          .on("postgres_changes", { event: "*", schema: "public", table: "transactions", filter: `account_id=in.(${bankingAccountIds.join(",")})` }, () => {
            void runRefresh("banking", () =>
              runGuardedSliceFetch(SLICE_KEYS.banking, fetchBankingPageData, (data) => {
                if (!cancelled) setBanking(data);
              })
            );
          })
          .subscribe();
        channels.push(transactionsChannel);
      }
    }

    // One channel covering every owned business instead of one channel per
    // business -- Postgres changes filters support `in.(...)`.
    if (
      (activeRealtimeModules.dashboard || activeRealtimeModules.businesses || activeRealtimeModules.banking || activeRealtimeModules.businessDetail) &&
      ownedBusinessIds.length > 0
    ) {
      const businessBalancesChannel = supabase
        .channel(`business-balances-${playerId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "business_accounts", filter: `business_id=in.(${ownedBusinessIds.join(",")})` }, () => {
          void refreshBusinessBalances();
        })
        .subscribe();
      channels.push(businessBalancesChannel);
    }

    if (activeRealtimeModules.market) {
      const refreshMarket = () =>
        runRefresh("market", () =>
          runGuardedSliceFetch(SLICE_KEYS.market, fetchMarketPageData, (data) => {
            if (!cancelled) setMarket(data);
          })
        );
      const marketActiveChannel = supabase
        .channel(`market-active-${playerId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "market_listings", filter: "status=eq.active" }, () => {
          void refreshMarket();
        })
        .subscribe();
      channels.push(marketActiveChannel);

      const marketOwnedChannel = supabase
        .channel(`market-owned-${playerId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "market_listings", filter: `owner_player_id=eq.${playerId}` }, () => {
          void refreshMarket();
        })
        .subscribe();
      channels.push(marketOwnedChannel);

      const buyOrdersActiveChannel = supabase
        .channel(`market-buy-orders-active-${playerId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "market_buy_orders", filter: "status=eq.active" }, () => {
          void refreshMarket();
        })
        .subscribe();
      channels.push(buyOrdersActiveChannel);

      const buyOrdersOwnedChannel = supabase
        .channel(`market-buy-orders-owned-${playerId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "market_buy_orders", filter: `owner_player_id=eq.${playerId}` }, () => {
          void refreshMarket();
        })
        .subscribe();
      channels.push(buyOrdersOwnedChannel);
    }

    if (activeRealtimeModules.production && selectedProductionBusinessId) {
      const productionChannel = supabase
        .channel(`production-${playerId}-${selectedProductionBusinessId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "manufacturing_jobs", filter: `business_id=eq.${selectedProductionBusinessId}` }, () => {
          void refreshSelectedProduction();
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "manufacturing_lines", filter: `business_id=eq.${selectedProductionBusinessId}` }, () => {
          void refreshSelectedProduction();
        })
        .subscribe();
      channels.push(productionChannel);
    }

    if (activeRealtimeModules.travel || activeRealtimeModules.businesses || activeRealtimeModules.dashboard) {
      const travelChannel = supabase
        .channel(`travel-${playerId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "travel_log", filter: `player_id=eq.${playerId}` }, () => {
          void runRefresh("travel", async () => {
            const data = await fetchTravelState();
            if (!cancelled) setTravel(data);
          });
        })
        .subscribe();
      channels.push(travelChannel);
    }

    if (activeRealtimeModules.businessDetail) for (const businessId of trackedBusinessDetailIds) {
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
        .on("postgres_changes", { event: "*", schema: "public", table: "market_storefront_performance_snapshots", filter: `business_id=eq.${businessId}` }, () => {
          void refreshBusinessDetail(businessId);
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "market_transactions", filter: `seller_business_id=eq.${businessId}` }, () => {
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

    if (activeRealtimeModules.businessDetail) for (const slotId of trackedExtractionSlotIds) {
      const extractionToolChannel = supabase
        .channel(`business-detail-tools-${playerId}-${slotId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "tool_durability", filter: `extraction_slot_id=eq.${slotId}` }, () => {
          for (const businessId of trackedBusinessDetailIds) {
            const detail = useGameStore.getState().businessDetails.data[businessId];
            const hasTrackedSlot = detail?.production?.slots?.some((slot) => slot.id === slotId);
            if (hasTrackedSlot) {
              void refreshBusinessDetail(businessId);
            }
          }
        })
        .subscribe();
      channels.push(extractionToolChannel);
    }

    return () => {
      cancelled = true;
      routeRefreshRef.current = async () => {};
      for (const channel of channels) {
        void supabase.removeChannel(channel);
      }
    };
  }, [
    hydrated,
    playerId,
    identityReady,
    supabase,
    activeRealtimeModules,
    ownedBusinessIdsKey,
    ownedBusinessIds,
    bankingAccountIds,
    trackedBusinessDetailKey,
    trackedBusinessDetailIds,
    trackedExtractionSlotIdsKey,
    trackedExtractionSlotIds,
    selectedProductionBusinessId,
    patchBanking,
    patchBusinesses,
    patchBusinessDetail,
    patchContracts,
    patchEmployees,
    patchInventory,
    patchMarket,
    patchProduction,
    removeBusiness,
    removeBusinessDetail,
    removeContract,
    removeEmployee,
    setBanking,
    setBusinesses,
    setContracts,
    setEmployees,
    setInventory,
    setMarket,
    setProduction,
    setTravel,
  ]);

  return null;
}
