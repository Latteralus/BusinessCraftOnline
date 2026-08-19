import { describe, expect, it } from "vitest";
import {
  ACCOUNT_CODES,
  BUSINESS_LEDGER_CATEGORY_CLASSIFICATION,
  CHART_OF_ACCOUNTS,
  getAccountNormalBalance,
  isAccountCode,
} from "@/config/finance";

describe("canonical Chart of Accounts (AccountingFixPlan Phase A)", () => {
  it("defines the plan's minimum required accounts", () => {
    const required = [
      "cash",
      "inventory",
      "fixed_assets",
      "wages_payable",
      "loan_payable",
      "owner_capital",
      "owner_draw",
      "retained_earnings",
      "revenue",
      "cogs",
      "payroll_expense",
      "shipping_expense",
      "market_fees",
      "advertising_expense",
      "depreciation_expense",
    ];
    for (const code of required) {
      expect(isAccountCode(code), `missing required account: ${code}`).toBe(true);
    }
  });

  it("every account's own code matches its map key", () => {
    for (const [key, definition] of Object.entries(CHART_OF_ACCOUNTS)) {
      expect(definition.code).toBe(key);
    }
  });

  it("assigns a normal balance side consistent with account type", () => {
    for (const code of ACCOUNT_CODES) {
      const side = getAccountNormalBalance(code);
      expect(["debit", "credit"]).toContain(side);
    }
    // Asset/expense accounts are debit-normal.
    expect(getAccountNormalBalance("cash")).toBe("debit");
    expect(getAccountNormalBalance("inventory")).toBe("debit");
    expect(getAccountNormalBalance("cogs")).toBe("debit");
    expect(getAccountNormalBalance("payroll_expense")).toBe("debit");
    // Liability/equity/revenue accounts are credit-normal.
    expect(getAccountNormalBalance("wages_payable")).toBe("credit");
    expect(getAccountNormalBalance("loan_payable")).toBe("credit");
    expect(getAccountNormalBalance("owner_capital")).toBe("credit");
    expect(getAccountNormalBalance("revenue")).toBe("credit");
    // owner_draw is contra-equity: reduces equity, so it's debit-normal
    // despite being classified under "equity".
    expect(getAccountNormalBalance("owner_draw")).toBe("debit");
    // accumulated_depreciation is contra-asset: reduces an asset, so it's
    // credit-normal despite representing a balance-sheet asset-side line.
    expect(getAccountNormalBalance("accumulated_depreciation")).toBe("credit");
  });

  it("classifies every real business_accounts.category value used in the codebase", () => {
    // This list was hand-audited against every literal category string
    // written to business_accounts across src/, shared/, and
    // supabase/migrations/*.sql as of Phase A (see the migration/RPC survey
    // referenced in the AccountingFixPlan work). If a new category is
    // introduced anywhere without adding it to LedgerCategory in
    // src/config/finance.ts, this file fails to typecheck before this test
    // even runs -- that's the actual enforcement mechanism. This test just
    // pins the known-good set so a silent narrowing is caught too.
    const knownCategories = [
      "opening_capital",
      "startup_purchase",
      "npc_sale",
      "market_sale",
      "contract_payout",
      "contract_acceptance",
      "market_fee",
      "wage_payment",
      "employee_hire",
      "employee_wage_settlement",
      "storefront_ads",
      "upgrade_purchase",
      "market_purchase",
      "buy_order_escrow",
      "buy_order_release",
      "owner_transfer_in",
      "owner_transfer_out",
      "business_transfer_in",
      "business_transfer_out",
      "shipping_fee",
    ];
    for (const category of knownCategories) {
      expect(
        Object.prototype.hasOwnProperty.call(BUSINESS_LEDGER_CATEGORY_CLASSIFICATION, category),
        `unclassified ledger category: ${category}`
      ).toBe(true);
    }
    expect(Object.keys(BUSINESS_LEDGER_CATEGORY_CLASSIFICATION).sort()).toEqual(knownCategories.sort());
  });
});
