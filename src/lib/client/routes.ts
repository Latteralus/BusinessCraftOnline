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
    personalBusinessTransfer: "/api/banking/business-transfer",
    businessToBusinessTransfer: "/api/banking/businesses-transfer",
    transactions: (limit: number) => withSearch("/api/banking/transactions", { limit }),
  },
  businesses: {
    root: "/api/businesses",
    detail: (businessId: string) => `/api/businesses/${businessId}`,
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
    listings: (options: { includeTransactions?: boolean; transactionsLimit?: number } = {}) =>
      withSearch("/api/market", options),
    cancel: (listingId: string) => `/api/market/${listingId}/cancel`,
    buy: (listingId: string) => `/api/market/${listingId}/buy`,
    storefront: "/api/market/storefront",
  },
  production: {
    assignSlot: "/api/production/slots/assign",
    unassignSlot: "/api/production/slots/unassign",
    slotStatus: "/api/production/slots/status",
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
