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

function ordinalSuffixOf(i: number): string {
  const j = i % 10;
  const k = i % 100;
  if (j === 1 && k !== 11) return `${i}st`;
  if (j === 2 && k !== 12) return `${i}nd`;
  if (j === 3 && k !== 13) return `${i}rd`;
  return `${i}th`;
}

/** Draft class year and overall pick; Undrafted when no draft record is on file. */
export function formatDraftYear(
  draftYear: number | null | undefined,
  draftRound?: number | null,
  draftPick?: number | null,
): string {
  if (draftPick != null && draftYear != null) {
    let out = `${draftYear} · ${ordinalSuffixOf(draftPick)} Overall Pick`;
    if (draftRound != null) out = `${draftYear} · R${draftRound} · Pick ${draftPick}`;
    return out;
  }
  if (draftPick != null) return `Pick ${draftPick}`;
  if (draftYear != null) return String(draftYear);
  return "Undrafted";
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
