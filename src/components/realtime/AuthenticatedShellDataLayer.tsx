"use client";

import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@supabase/supabase-js";
import { usePathname, useRouter } from "next/navigation";
import { useEffect } from "react";
import { fetchAppShell, fetchBankingPageData, fetchBusinessesPageData, fetchContractsPageData, fetchEmployeesPageData, fetchInventoryPageData, fetchMarketPageData, fetchProductionPageData, prefetchableRoutes, queryKeys } from "@/lib/client/queries";

const PREFETCHERS: Array<{ key: readonly unknown[]; fn: () => Promise<unknown> }> = [
  { key: queryKeys.businessesPage, fn: fetchBusinessesPageData },
  { key: queryKeys.marketPage, fn: fetchMarketPageData },
  { key: queryKeys.bankingPage, fn: fetchBankingPageData },
  { key: queryKeys.inventoryPage, fn: fetchInventoryPageData },
  { key: queryKeys.employeesPage, fn: fetchEmployeesPageData },
  { key: queryKeys.contractsPage, fn: fetchContractsPageData },
  { key: queryKeys.productionPage, fn: fetchProductionPageData },
] as const;

export function AuthenticatedShellDataLayer() {
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();

  useEffect(() => {
    for (const route of prefetchableRoutes) {
      if (route !== pathname) {
        router.prefetch(route);
      }
    }

    const timer = window.setTimeout(() => {
      for (const entry of PREFETCHERS) {
        void queryClient.prefetchQuery({
          queryKey: entry.key,
          queryFn: entry.fn,
          staleTime: 15_000,
        });
      }
      void queryClient.prefetchQuery({
        queryKey: queryKeys.appShell,
        queryFn: fetchAppShell,
        staleTime: 30_000,
      });
    }, 1_500);

    return () => window.clearTimeout(timer);
  }, [pathname, queryClient, router]);

  useEffect(() => {
    let cancelled = false;
    let cleanup: (() => void) | null = null;

    async function connectRealtime() {
      const response = await fetch("/api/realtime-auth");
      const payload = (await response.json().catch(() => null)) as { token?: string } | null;

      if (!response.ok || !payload?.token || cancelled) {
        return;
      }

      const supabase = createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
        {
          auth: {
            persistSession: false,
            autoRefreshToken: false,
          },
          global: {
            headers: {
              Authorization: `Bearer ${payload.token}`,
            },
          },
        }
      );

      supabase.realtime.setAuth(payload.token);

      const invalidate = (...keys: ReadonlyArray<readonly unknown[]>) => {
        for (const queryKey of keys) {
          void queryClient.invalidateQueries({ queryKey });
        }
      };

      const channel = supabase
        .channel(`app-shell-sync-${Date.now()}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "businesses" }, () => {
          invalidate(queryKeys.businessesPage, queryKeys.bankingPage, queryKeys.inventoryPage, queryKeys.marketPage, queryKeys.employeesPage, queryKeys.contractsPage, queryKeys.productionPage);
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "bank_accounts" }, () => {
          invalidate(queryKeys.bankingPage, queryKeys.inventoryPage, queryKeys.businessesPage);
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "transactions" }, () => {
          invalidate(queryKeys.bankingPage);
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "business_inventory" }, () => {
          invalidate(queryKeys.inventoryPage, queryKeys.marketPage);
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "personal_inventory" }, () => {
          invalidate(queryKeys.inventoryPage);
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "shipping_queue" }, () => {
          invalidate(queryKeys.inventoryPage);
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "market_listings" }, () => {
          invalidate(queryKeys.marketPage, queryKeys.businessesPage);
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "market_transactions" }, () => {
          invalidate(queryKeys.marketPage, queryKeys.businessesPage, queryKeys.bankingPage);
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "market_storefront_settings" }, () => {
          invalidate(queryKeys.marketPage, queryKeys.appShell);
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "employees" }, () => {
          invalidate(queryKeys.employeesPage, queryKeys.businessesPage, queryKeys.productionPage);
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "employee_assignments" }, () => {
          invalidate(queryKeys.employeesPage, queryKeys.productionPage);
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "contracts" }, () => {
          invalidate(queryKeys.contractsPage);
        })
        .on("postgres_changes", { event: "*", schema: "public", table: "manufacturing_jobs" }, () => {
          invalidate(queryKeys.productionPage);
        })
        .subscribe();

      cleanup = () => {
        void supabase.removeChannel(channel);
      };
    }

    void connectRealtime();

    return () => {
      cancelled = true;
      cleanup?.();
    };
  }, [queryClient]);

  return null;
}
