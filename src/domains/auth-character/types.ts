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
