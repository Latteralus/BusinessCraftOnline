import type { MarketTransaction } from "./types";
import { formatItemKey } from "@/lib/items";

type FormatMarketTransactionLineInput = {
  transaction: MarketTransaction;
  businessNameById?: Map<string, string>;
  formatTimestamp: (value: string) => string;
};

export function formatMarketTransactionLine(input: FormatMarketTransactionLineInput): string {
  const { transaction: tx, businessNameById, formatTimestamp } = input;

  const sellerName =
    tx.seller_business_name ??
    (tx.seller_business_id ? businessNameById?.get(tx.seller_business_id) : null) ??
    (tx.seller_business_id ? `Business ${tx.seller_business_id.slice(0, 8)}` : "Unknown Seller");

  const buyerName =
    tx.buyer_type === "npc"
      ? tx.shopper_name ?? "NPC shopper"
      : tx.buyer_business_name ??
        (tx.buyer_business_id ? businessNameById?.get(tx.buyer_business_id) : null) ??
        (tx.buyer_business_id ? `Business ${tx.buyer_business_id.slice(0, 8)}` : "A player");

  const itemName = formatItemKey(tx.item_key);
  const isBusinessToBusiness = tx.buyer_type === "player" && Boolean(tx.buyer_business_id);
  const tradeValue = Number.isFinite(tx.gross_total) ? tx.gross_total : tx.quantity * tx.unit_price;
  const tradeSuffix = isBusinessToBusiness ? ` at $${tradeValue.toFixed(2)}` : "";
  return `[${formatTimestamp(tx.created_at)}] ${buyerName} bought ${tx.quantity} ${itemName} from ${sellerName}${tradeSuffix}`;
}
