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
  previous_team_id?: number | null;
  founded_year?: number | null;
  dissolved_year?: number | null;
};

export type RollConstraint = {
  decadeLabel: string;
  decadeStart: number;
  decadeEnd: number;
  teams: ConstraintTeamSegment[];
};

export type ConstraintTeamSegment = {
  team: TeamLite;
  // Optional display range for coalesced franchises (e.g. Sonics 00-08, Thunder 08-09).
  startYear?: number | null;
  endYear?: number | null;
};

// Used for both "rolled" constraints (year+team) and static constraints (e.g. fixed teams, any year).
export type EligibilityConstraint = {
  teams: ConstraintTeamSegment[];
  yearLabel?: string | null;
  yearStart?: number | null;
  yearEnd?: number | null;
  nameLetter?: string | null;
  namePart?: "first" | "last" | "either" | null;
  player?: { id: number; name: string; image_url?: string | null } | null;
  allowActive?: boolean | null;
  allowRetired?: boolean | null;
  minTeamStints?: number | null;
  maxTeamStints?: number | null;
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
  retirement_year?: number | null;
  coalesced_team_stint_count?: number | null;
  team_stints?: Array<{
    id: number;
    team_id: number;
    start_year: number;
    end_year?: number | null;
    team?: { id: number; name: string; abbreviation?: string | null; logo_url?: string | null } | null;
  }>;
};


