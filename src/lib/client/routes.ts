const withSearch = (path: string, params: Record<string, string | number | boolean | undefined>) => {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    search.set(key, String(value));
  }

  const query = search.toString();
  return query ? `${path}?${query}` : path;
};

export const apiRoutes = {
  banking: {
    accounts: "/api/banking/accounts",
    loan: "/api/banking/loan",
    loanPayment: "/api/banking/loan/payment",
    transfer: "/api/banking/transfer",
    personalBusinessTransfer: "/api/banking/personal-business-transfer",
    businessToBusinessTransfer: "/api/banking/business-to-business-transfer",
    transactions: (limit: number) => withSearch("/api/banking/transactions", { limit }),
  },
  businesses: {
    root: "/api/businesses",
    detail: (businessId: string) => `/api/businesses/${businessId}`,
    state: (businessId: string, period?: "1h" | "24h" | "7d" | "30d", section?: "overview" | "finance" | "operations" | "employees" | "inventory" | "upgrades" | "options") =>
      withSearch(`/api/businesses/${businessId}/state`, { period, section }),
    upgrade: (businessId: string) => `/api/businesses/${businessId}/upgrade`,
  },
  cities: "/api/cities",
  contracts: {
    root: "/api/contracts",
    detail: (contractId: string) => `/api/contracts/${contractId}`,
    accept: (contractId: string) => `/api/contracts/${contractId}/accept`,
    cancel: (contractId: string) => `/api/contracts/${contractId}/cancel`,
    fulfill: (contractId: string) => `/api/contracts/${contractId}/fulfill`,
  },
  employees: {
    root: "/api/employees",
    assign: "/api/employees/assign",
    reactivate: "/api/employees/reactivate",
    settle: "/api/employees/settle",
    unassign: "/api/employees/unassign",
    detail: (employeeId: string) => `/api/employees/${employeeId}`,
  },
  inventory: {
    root: "/api/inventory",
    transfer: "/api/inventory/transfer",
  },
  market: {
    root: "/api/market",
    listings: (options: {
      includeTransactions?: boolean;
      transactionsLimit?: number;
      buyerType?: "player" | "npc";
      requireListing?: boolean;
      status?: "active" | "filled" | "cancelled" | "expired";
      ownOnly?: boolean;
      cityId?: string;
      itemKey?: string;
      limit?: number;
      offset?: number;
    } = {}) =>
      withSearch("/api/market", options),
    cancel: (listingId: string) => `/api/market/${listingId}/cancel`,
    buy: (listingId: string) => `/api/market/${listingId}/buy`,
    storefront: "/api/market/storefront",
    storefrontPerformance: (businessId: string, windowHours?: number) =>
      withSearch("/api/market/storefront/performance", { businessId, windowHours }),
    buyOrders: {
      root: "/api/market/buy-orders",
      listings: (options: {
        status?: "active" | "filled" | "cancelled" | "expired";
        ownOnly?: boolean;
        cityId?: string;
        itemKey?: string;
        limit?: number;
        offset?: number;
      } = {}) => withSearch("/api/market/buy-orders", options),
      cancel: (buyOrderId: string) => `/api/market/buy-orders/${buyOrderId}/cancel`,
      fulfill: (buyOrderId: string) => `/api/market/buy-orders/${buyOrderId}/fulfill`,
    },
  },
  mail: {
    root: "/api/mail",
    detail: (threadId?: string) => withSearch("/api/mail", { threadId }),
    reply: (threadId: string) => `/api/mail/${threadId}/reply`,
    read: (threadId: string) => `/api/mail/${threadId}/read`,
    delete: (threadId: string) => `/api/mail/${threadId}`,
    recipients: (q: string) => withSearch("/api/mail/recipients", { q }),
  },
  production: {
    assignSlot: "/api/production/slots/assign",
    retoolSlot: "/api/production/slots/retool",
    unassignSlot: "/api/production/slots/unassign",
    slotStatus: "/api/production/slots/status",
    assignManufacturingLine: "/api/production/manufacturing/lines/assign",
    unassignManufacturingLine: "/api/production/manufacturing/lines/unassign",
    manufacturingLineStatus: "/api/production/manufacturing/lines/status",
    retoolManufacturingLine: "/api/production/manufacturing/lines/retool",
    manufacturing: "/api/production/manufacturing",
  },
  stores: {
    shelves: "/api/stores/shelves",
  },
  travel: "/api/travel",
  upgrades: {
    root: "/api/upgrades",
    preview: "/api/upgrades/preview",
  },
} as const;
