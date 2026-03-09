export type StoreShelfItem = {
  id: string;
  owner_player_id: string;
  business_id: string;
  item_key: string;
  quality: number;
  quantity: number;
  unit_price: number;
  created_at: string;
  updated_at: string;
};

export type StoreShelfItemFilter = {
  businessId?: string;
};

export type UpsertStoreShelfItemInput = {
  businessId: string;
  itemKey: string;
  quality: number;
  quantity: number;
  unitPrice: number;
};

export type RemoveStoreShelfItemInput = {
  shelfItemId: string;
};
