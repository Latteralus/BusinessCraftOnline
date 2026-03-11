import type { FinancePeriod } from "@/config/finance";
import type { BusinessDetailsEntry } from "@/stores/game-store";
import { useGameStore } from "@/stores/game-store";
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
      fetchBusinessesPageData().then((data) => {
        const store = useGameStore.getState();
        store.setBusinesses(data.businesses);
        store.setTravel(data.travelState);
      })
    );
  }

  if (options.banking) {
    tasks.push(
      fetchBankingPageData().then((data) => {
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
      fetchInventoryPageData().then((data) => {
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
      fetchMarketPageData().then((data) => {
        useGameStore.getState().setMarket({
          businesses: data.businesses,
          listings: data.listings,
          transactions: data.transactions,
        });
      })
    );
  }

  if (options.employees) {
    tasks.push(
      fetchEmployeesPageData().then((data) => {
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
      fetchContractsPageData().then((data) => {
        const store = useGameStore.getState();
        store.setContracts(data.contracts);
        store.setBusinesses(data.businesses);
      })
    );
  }

  if (options.production) {
    tasks.push(
      fetchProductionPageData().then((data) => {
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
      fetchBusinessDetailsState(target.businessId, target.period).then((detail) => {
        useGameStore.getState().upsertBusinessDetail(target.businessId, detail);
      })
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
