export type Team = {
  id: number;
  name: string;
  city?: string | null;
  abbreviation?: string | null;
  logo_url?: string | null;
  previous_team_id?: number | null;
  founded_year?: number | null;
  dissolved_year?: number | null;
};

export type PlayerListItem = {
  id: number;
  name: string;
  bref_id?: string | null;
  draft_year?: number | null;
  draft_round?: number | null;
  draft_pick?: number | null;
  team_id?: number | null;
  career_start_year?: number | null;
  retirement_year?: number | null;
  hall_of_fame: boolean;
  position?: string | null;
  image_url?: string | null;
};

export type PlayerDetail = PlayerListItem & {
  coalesced_team_stint_count?: number;
  team_stints?: Array<{
    id: number;
    team_id: number;
    start_year: number;
    end_year?: number | null;
    team?: Team | null;
  }>;
};

export type Season = {
  id: number;
  start_year: number;
  end_year: number;
  label?: string | null;
};

export type PlayerSeasonStat = {
  id: number;
  player_id: number;
  season_id: number;
  team_id: number;
  season?: Season | null;
  games?: number | null;
  games_started?: number | null;
  minutes?: number | null;
  fg?: number | null;
  fga?: number | null;
  fg3?: number | null;
  fg3a?: number | null;
  fg2?: number | null;
  fg2a?: number | null;
  ft?: number | null;
  fta?: number | null;
  orb?: number | null;
  drb?: number | null;
  trb?: number | null;
  ast?: number | null;
  stl?: number | null;
  blk?: number | null;
  tov?: number | null;
  pf?: number | null;
  pts?: number | null;
  fg_pct?: number | null;
  fg3_pct?: number | null;
  ft_pct?: number | null;
  efg_pct?: number | null;
  ts_pct?: number | null;
  per?: number | null;
  usg_pct?: number | null;
  ows?: number | null;
  dws?: number | null;
  ws?: number | null;
  ws_per_48?: number | null;
  obpm?: number | null;
  dbpm?: number | null;
  bpm?: number | null;
  vorp?: number | null;
};

export type PlayerSeasonStatsAggregate = {
  player_id: number;
  seasons: number;
  rows: number;
  games?: number | null;
  games_started?: number | null;
  minutes?: number | null;
  fg?: number | null;
  fga?: number | null;
  fg3?: number | null;
  fg3a?: number | null;
  ft?: number | null;
  fta?: number | null;
  trb?: number | null;
  ast?: number | null;
  stl?: number | null;
  blk?: number | null;
  tov?: number | null;
  pf?: number | null;
  pts?: number | null;
  fg_pct?: number | null;
  fg3_pct?: number | null;
  ft_pct?: number | null;
  ts_pct?: number | null;
  per?: number | null;
  ws?: number | null;
  vorp?: number | null;
  bpm?: number | null;
};

export type PlayerSeasonStatsResponse = {
  player_id: number;
  aggregate: boolean;
  rows: PlayerSeasonStat[];
  totals?: PlayerSeasonStatsAggregate | null;
};

export type Award = {
  id: number;
  slug: string;
  name: string;
  category?: string | null;
};

export type PlayerAward = {
  id: number;
  player_id: number;
  award_id: number;
  season_id: number;
  team_id?: number | null;
  award?: Award | null;
  season?: Season | null;
};
