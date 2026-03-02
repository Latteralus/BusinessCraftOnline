export type Gender = "male" | "female" | "other";

export type Player = {
  id: string;
  username: string;
  email: string;
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
  email: string;
  password: string;
  username: string;
};

export type LoginInput = {
  email: string;
  password: string;
};

export type CreateCharacterInput = {
  firstName: string;
  lastName: string;
  gender: Gender;
  currentCityId?: string | null;
};
