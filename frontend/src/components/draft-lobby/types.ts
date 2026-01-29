export type DraftPickWs = {
  pick_number: number;
  role: "host" | "guest";
  player_id: number;
  player_name: string;
  player_image_url?: string | null;
  constraint_team?: string | null;
  constraint_year?: string | null;
};

export type TeamLite = {
  id: number;
  name: string;
  abbreviation?: string | null;
  logo_url?: string | null;
};

export type RollConstraint = {
  decadeLabel: string;
  decadeStart: number;
  decadeEnd: number;
  team: TeamLite;
};

export type SpinPreviewTeam = {
  name: string;
  abbreviation?: string | null;
  logo_url?: string | null;
};

export type PlayerSearchResult = { id: number; name: string; image_url?: string | null };

export type PlayerDetail = {
  id: number;
  name: string;
  image_url?: string | null;
  position?: string | null;
  team_stints?: Array<{
    id: number;
    team_id: number;
    start_year: number;
    end_year?: number | null;
    team?: { id: number; name: string; abbreviation?: string | null; logo_url?: string | null } | null;
  }>;
};


