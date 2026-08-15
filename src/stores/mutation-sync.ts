import type { FinancePeriod } from "@/config/finance";
import type { BusinessDetailsEntry } from "@/stores/game-store";
import { useGameStore } from "@/stores/game-store";
import { runGuardedSliceFetch, SLICE_KEYS } from "@/stores/slice-fetch-guard";
import {
  fetchBankingPageData,
  fetchBusinessesPageData,
  fetchBusinessDetailsState,
  fetchContractsPageData,
  fetchEmployeesPageData,
  fetchInventoryPageData,
  fetchMarketPageData,
  fetchProductionPageData,
} from "@/lib/client/queries";

type BusinessDetailSyncTarget = {
  businessId: string;
  period?: FinancePeriod;
};

type MutationSyncOptions = {
  businesses?: boolean;
  banking?: boolean;
  inventory?: boolean;
  market?: boolean;
  employees?: boolean;
  contracts?: boolean;
  production?: boolean;
  businessDetails?: BusinessDetailSyncTarget[];
};

function dedupeBusinessDetails(targets: BusinessDetailSyncTarget[] = []) {
  const unique = new Map<string, BusinessDetailSyncTarget>();
  for (const target of targets) {
    if (!target.businessId) continue;
    unique.set(`${target.businessId}:${target.period ?? "1h"}`, target);
  }
  return [...unique.values()];
}

export async function syncMutationViews(options: MutationSyncOptions) {
  const tasks: Promise<void>[] = [];

  if (options.businesses) {
    tasks.push(
      runGuardedSliceFetch(SLICE_KEYS.businesses, fetchBusinessesPageData, (data) => {
        const store = useGameStore.getState();
        store.setBusinesses(data.businesses);
        store.setTravel(data.travelState);
      })
    );
  }

  if (options.banking) {
    tasks.push(
      runGuardedSliceFetch(SLICE_KEYS.banking, fetchBankingPageData, (data) => {
        useGameStore.getState().setBanking({
          accounts: data.accounts,
          loanData: data.loanData,
          transactions: data.transactions,
          businesses: data.businesses,
        });
      })
    );
  }

  if (options.inventory) {
    tasks.push(
      runGuardedSliceFetch(SLICE_KEYS.inventory, fetchInventoryPageData, (data) => {
        useGameStore.getState().setInventory({
          personalInventory: data.personalInventory,
          businessInventory: data.businessInventory,
          shippingQueue: data.shippingQueue,
          accounts: data.accounts,
          businesses: data.businesses,
          businessNamesById: data.businessNamesById,
          cityNamesById: data.cityNamesById,
        });
      })
    );
  }

  if (options.market) {
    tasks.push(
      runGuardedSliceFetch(SLICE_KEYS.market, fetchMarketPageData, (data) => {
        useGameStore.getState().setMarket({
          businesses: data.businesses,
          listings: data.listings,
          transactions: data.transactions,
          currentCityId: data.currentCityId ?? null,
        });
      })
    );
  }

  if (options.employees) {
    tasks.push(
      runGuardedSliceFetch(SLICE_KEYS.employees, fetchEmployeesPageData, (data) => {
        useGameStore.getState().setEmployees({
          employees: data.employees,
          summary: data.summary,
          businesses: data.businesses,
        });
      })
    );
  }

  if (options.contracts) {
    tasks.push(
      runGuardedSliceFetch(SLICE_KEYS.contracts, fetchContractsPageData, (data) => {
        const store = useGameStore.getState();
        store.setContracts(data.contracts);
        store.setBusinesses(data.businesses);
      })
    );
  }

  if (options.production) {
    tasks.push(
      runGuardedSliceFetch(SLICE_KEYS.production, fetchProductionPageData, (data) => {
        useGameStore.getState().setProduction({
          businesses: data.businesses,
          selectedBusinessId: data.selectedBusinessId,
          manufacturing: data.manufacturing,
        });
      })
    );
  }

  for (const target of dedupeBusinessDetails(options.businessDetails)) {
    tasks.push(
      runGuardedSliceFetch(
        SLICE_KEYS.businessDetail(target.businessId),
        () => fetchBusinessDetailsState(target.businessId, target.period),
        (detail) => {
          useGameStore.getState().upsertBusinessDetail(target.businessId, detail);
        }
      )
    );
  }

  await Promise.all(tasks);
}

export function detailSyncTarget(
  businessId: string | null | undefined,
  period?: FinancePeriod
): BusinessDetailSyncTarget[] {
  return businessId ? [{ businessId, period }] : [];
}

export function mergeDetailSyncTargets(
  ...groups: Array<BusinessDetailSyncTarget[] | undefined>
): BusinessDetailSyncTarget[] {
  return groups.flatMap((group) => group ?? []);
}
