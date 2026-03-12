export type Gender = "male" | "female" | "other";

export type Player = {
  id: string;
  username: string;
  email: string | null;
  role: "player" | "admin";
  created_at: string;
};

export type Character = {
  id: string;
  player_id: string;
  first_name: string;
  last_name: string;
  gender: Gender;
  current_city_id: string | null;
  business_level: number;
  created_at: string;
};

export type OnlinePlayerPreview = {
  player_id: string;
  character_name: string;
  business_level: number;
  wealth: number;
  last_seen_at: string;
};

export type PlayerProfilePreview = {
  player_id: string;
  username: string;
  character_name: string;
  first_name: string;
  last_name: string;
  business_level: number;
  current_city_id: string | null;
  current_city_name: string | null;
  joined_at: string;
  last_seen_at: string | null;
  is_online: boolean;
  net_worth: number;
  total_businesses: number;
};

export type PublicPlayerBusiness = {
  business_id: string;
  player_id: string;
  name: string;
  type: string;
  city_id: string;
  city_name: string | null;
  entity_type: string;
  created_at: string;
};

export type CharacterRecipientPreview = {
  player_id: string;
  character_name: string;
};

export type RegisterInput = {
  password: string;
  username: string;
};

export type LoginInput = {
  username: string;
  password: string;
};

export type CreateCharacterInput = {
  firstName: string;
  lastName: string;
  gender: Gender;
  currentCityId?: string | null;
};
