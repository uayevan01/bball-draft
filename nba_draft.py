import time
import random

teams = [
    'New York Knicks','Boston Celtics','Toronto Raptors','Brooklyn Nets','Philadelphia 76ers',
    'Cleveland Cavaliers','Indiana Pacers','Chicago Bulls','Detroit Pistons','Milwaukee Bucks',
    'Washington Wizards','Miami Heat','Orlando Magic','Charlotte Hornets','Atlanta Hawks',
    'Los Angeles Lakers','Los Angeles Clippers','Sacramento Kings','Golden State Warriors','Phoenix Suns',
    'Oklahoma City Thunder','Denver Nuggets','Portland Trail Blazers','Utah Jazz','Minnesota Timberwolves',
    'New Orleans Pelicans','Memphis Grizzlies','Dallas Mavericks','San Antonio Spurs','Houston Rockets'
]

years = ['1980-1989', '1990-1999','2000-2009','2010-2019','2020-2029']

TOTAL_TIME = 1
STEPS = 160

def ease_in_expo(t: float) -> float:
    if t <= 0.0:
        return 0.0
    if t >= 1.0:
        return 1.0
    return 2 ** (10 * (t - 1))

def spin_label(label: str, options: list[str], total_time: float = TOTAL_TIME, steps: int = STEPS) -> str:
    start = time.perf_counter()
    choice = ""
    for i in range(steps):
        t = i / (steps - 1)
        progress = ease_in_expo(t)
        target_time = start + progress * total_time

        choice = random.choice(options)
        print(f"\r\033[K{label}: {choice}", end="", flush=True)
        time.sleep(max(0.0, target_time - time.perf_counter()))
    print()
    return choice

def snake_turns(picks_each: int):
    counts = [0, 0]
    round_num = 1
    while counts[0] < picks_each or counts[1] < picks_each:
        order = [0, 1] if round_num % 2 == 1 else [1, 0]
        for p in order:
            if counts[p] < picks_each:
                counts[p] += 1
                yield p, counts[p]
        round_num += 1

def print_cmd_help():
    print("""
Commands (type one, press Enter):
  -r       reroll TEAM
  -y       reroll YEAR
  -b       reroll BOTH year & team
  -p       print current roll again
  -t       print teams selected so far
  -undo    rollback last completed pick (commissioner)
  -h       show help
  -help    show help
  -q       quit draft

Otherwise, just type the NBA player name to lock the pick.
""")

def print_teams_so_far(names: list[str], picks: dict):
    print("\n--- Teams So Far ---")
    for drafter in names:
        items = picks[drafter]
        print(f"\n{drafter}:")
        if not items:
            print("  (no picks yet)")
        else:
            for i, (pick_no, nba_player, team, year) in enumerate(items, 1):
                print(f"  {i}. {nba_player} — {team} ({year})  [overall pick {pick_no}]")
    print("--------------------\n")

def undo_last_pick(names: list[str], picks: dict) -> bool:
    """
    Removes the most recent pick across BOTH players, based on overall pick number.
    Returns True if something was undone, else False.
    """
    latest = None  # (pick_no, drafter, index_in_list)
    for drafter in names:
        if picks[drafter]:
            pick_no = picks[drafter][-1][0]
            if latest is None or pick_no > latest[0]:
                latest = (pick_no, drafter, len(picks[drafter]) - 1)

    if latest is None:
        print("Nothing to undo yet.")
        return False

    pick_no, drafter, idx = latest
    removed = picks[drafter].pop(idx)
    _, nba_player, team, year = removed
    print(f"✅ Undid overall pick {pick_no}: {drafter} took {nba_player} — {team} ({year})")
    return True

def prompt_nonempty(prompt: str) -> str:
    while True:
        s = input(prompt).strip()
        if s:
            return s
        print("Please enter a name (not blank).")

def prompt_player_or_command(year: str, team: str, names: list[str], picks: dict) -> tuple[str, str, str, bool]:
    """
    Loop until user types a non-command player name (locks pick) OR uses -undo.
    Returns (player_name, year, team, did_undo)
    - If did_undo is True, player_name/year/team are meaningless for that call.
    """
    print(f"Current roll: {team} ({year})")

    while True:
        entry = input("Type command (e.g. -r) or NBA player name: ").strip()

        if not entry:
            print("Name cannot be blank. Type -h for help.")
            continue

        if entry.startswith("-"):
            cmd = entry.lower()

            if cmd == "-r":
                team = spin_label("Team", teams)
                print(f"Current roll: {team} ({year})")

            elif cmd == "-y":
                year = spin_label("Year", years)
                print(f"Current roll: {team} ({year})")

            elif cmd == "-b":
                year = spin_label("Year", years)
                team = spin_label("Team", teams)
                print(f"Current roll: {team} ({year})")

            elif cmd == "-p":
                print(f"Current roll: {team} ({year})")

            elif cmd == "-t":
                print_teams_so_far(names, picks)
                print(f"Current roll: {team} ({year})")

            elif cmd == "-undo":
                if undo_last_pick(names, picks):
                    return "", year, team, True
                # If nothing undone, stay here
                print(f"Current roll: {team} ({year})")

            elif cmd in ("-h", "-help"):
                print_cmd_help()
                print(f"Current roll: {team} ({year})")

            elif cmd == "-q":
                raise SystemExit("Draft aborted by user.")

            else:
                print("Unknown command. Type -h for help.")
            continue

        # Otherwise: lock the pick with NBA player name
        return entry, year, team, False

def main():
    p1 = input("Player 1 name: ").strip() or "Player 1"
    p2 = input("Player 2 name: ").strip() or "Player 2"

    while True:
        try:
            picks_each = int(input("How many picks per player? (e.g. 10): ").strip())
            if picks_each <= 0:
                raise ValueError
            break
        except ValueError:
            print("Enter a positive integer (like 10).")

    names = [p1, p2]
    picks = {p1: [], p2: []}

    total_picks_target = picks_each * 2
    overall_pick_no = 0

    # We'll generate turns, but allow -undo to rewind the overall pick counter and replay turns.
    turns = list(snake_turns(picks_each))  # list of (player_idx, their_pick_num) length = total_picks_target

    print("\n--- Snake Draft ---")
    print("For each pick: press Enter -> spin year/team -> type commands or NBA player name.\n")
    print("Enter \"-h\" to see list of commands.\n")

    turn_index = 0
    while turn_index < len(turns):
        player_idx, player_pick_num = turns[turn_index]
        drafter = names[player_idx]

        # overall pick number is turn_index+1, but we keep it explicit because of undo
        overall_pick_no = turn_index + 1

        input(f"[Pick {overall_pick_no}/{total_picks_target}] {drafter} (pick #{player_pick_num}) — press Enter to spin...")

        year = spin_label("Year", years)
        team = spin_label("Team", teams)

        nba_player, year, team, did_undo = prompt_player_or_command(year, team, names, picks)

        if did_undo:
            # If we undid, step back one turn (if possible) so the undone pick can be re-drafted.
            # Also handle the case where you undo when you're at the first turn.
            turn_index = max(0, turn_index - 1)
            print("↩️  Rolled back one pick. Re-drafting that pick now.\n")
            continue

        # Lock pick (validate non-empty)
        if not nba_player.strip():
            nba_player = prompt_nonempty("Choose NBA player: ")

        picks[drafter].append((overall_pick_no, nba_player, team, year))
        print(f"→ Logged: {drafter} took {nba_player} — {team} ({year})\n")

        turn_index += 1

    print("\n=== Final Draft Boards ===")
    for drafter in names:
        print(f"\n{drafter}:")
        for i, (pick_no, nba_player, team, year) in enumerate(sorted(picks[drafter], key=lambda x: x[0]), 1):
            print(f"  {i}. {nba_player} — {team} ({year})  [overall pick {pick_no}]")

if __name__ == "__main__":
    main()
