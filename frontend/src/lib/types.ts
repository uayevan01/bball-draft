export type DraftType = {
  id: number;
  name: string;
  description?: string | null;
  rules: Record<string, unknown>;
  created_by_id?: string | null;
  is_public: boolean;
  created_at: string;
};

export type Draft = {
  id: number;
  draft_type_id: number;
  host_id: string;
  guest_id?: string | null;
  picks_per_player: number;
  show_suggestions: boolean;
  status: string;
  created_at: string;
  completed_at?: string | null;
  host?: User;
  guest?: User | null;
  picks?: DraftPick[];
};

export type User = {
  id: string;
  clerk_id: string;
  full_name?: string | null;
  username?: string | null;
  email?: string | null;
  created_at: string;
};

export type DraftPick = {
  id: number;
  draft_id: number;
  user_id: string;
  player_id: number;
  pick_number: number;
  constraint_team?: string | null;
  constraint_year?: string | null;
  picked_at: string;
};


