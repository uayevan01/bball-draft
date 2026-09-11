/**
 * Season year display conventions
 * --------------------------------
 * DB season identity is always **start year** (2003 = 2003-04).
 *
 * Use **start year** for:
 * - Career years, draft class year, season table identity
 * - Constraint / eligibility windows
 *
 * Use **start → end** span for stints:
 * - start_year = first season start; end_year = last season end (calendar end year)
 * - e.g. 2003–2010 ⇒ played 2003-04 through 2009-10
 *
 * Use **end year** for:
 * - Awards / championships / finals (year the trophy is associated with)
 */

export function seasonLabelFromStart(startYear: number): string {
  return `${startYear}-${String(startYear + 1).slice(-2)}`;
}

/** Career span using start years of first/last season. */
export function formatCareerYears(
  careerStartYear: number | null | undefined,
  retirementYear: number | null | undefined,
): string {
  if (careerStartYear == null && retirementYear == null) return "—";
  if (careerStartYear != null && retirementYear == null) {
    return `${careerStartYear}–present`;
  }
  if (careerStartYear != null && retirementYear != null) {
    return `${careerStartYear}–${retirementYear}`;
  }
  return String(retirementYear);
}

/** Draft class year (NBA draft calendar year). */
export function formatDraftYear(
  draftYear: number | null | undefined,
  draftRound?: number | null,
  draftPick?: number | null,
): string {
  if (draftYear == null) return "—";
  let out = String(draftYear);
  if (draftRound != null) out += ` · R${draftRound}`;
  if (draftPick != null) out += ` · Pick ${draftPick}`;
  return out;
}

/** Stint span: first season start year → last season end year (as stored). */
export function formatStintYears(startYear: number, endYear: number | null | undefined): string {
  if (endYear == null) return `${startYear}–present`;
  return `${startYear}–${endYear}`;
}

/** Award / championship year: season end year (year the honor is usually cited as). */
export function awardYearFromSeason(startYear: number, endYear?: number | null): number {
  return endYear ?? startYear + 1;
}
