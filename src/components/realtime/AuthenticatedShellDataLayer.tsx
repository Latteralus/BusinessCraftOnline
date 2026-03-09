"use client";

import { useQueryClient } from "@tanstack/react-query";
import { createClient } from "@supabase/supabase-js";
import { useEffect } from "react";
import { queryKeys } from "@/lib/client/queries";

export function AuthenticatedShellDataLayer() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const browserWindow = window as Window &
      typeof globalThis & {
        requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
        cancelIdleCallback?: (handle: number) => void;
      };
    let cancelled = false;
    let cleanup: (() => void) | null = null;
    let timeoutId: number | null = null;
    let idleId: number | null = null;

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

    const startRealtime = () => {
      if (!cancelled) {
        void connectRealtime();
      }
    };

    if (browserWindow.requestIdleCallback) {
      idleId = browserWindow.requestIdleCallback(() => {
        timeoutId = browserWindow.setTimeout(startRealtime, 1_500);
      }, { timeout: 5_000 });
    } else {
      timeoutId = browserWindow.setTimeout(startRealtime, 3_000);
    }

    return () => {
      cancelled = true;
      if (idleId !== null && browserWindow.cancelIdleCallback) {
        browserWindow.cancelIdleCallback(idleId);
      }
      if (timeoutId !== null) {
        browserWindow.clearTimeout(timeoutId);
      }
      cleanup?.();
    };
  }, [queryClient]);

  return null;
}
