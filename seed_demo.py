#!/usr/bin/env python3
"""Populate a disposable Epick-em development database through the public API.

Uses real API authorization, Argon2 password hashing, registration, scoring and
match lifecycle logic. Requires a backend containing Tournament, Step and Match.

Run only against a fresh, disposable local development database.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from typing import Any

PASSWORD = "Password1234!"
USERS = [
    "alice_test", "bob_test", "charlie_test", "david_test",
    "emma_test", "felix_test", "grace_test", "henry_test",
    "ivan_test", "jane_test", "karl_test", "luna_test",
    "mike_test", "nina_test", "oliver_test", "paul_test",
]

TEAMS = [
    ("Alpha", "ALP", "alice_test", "bob_test", "ivan_test"),
    ("Bravo", "BRV", "charlie_test", "david_test", "jane_test"),
    ("Charlie", "CHR", "emma_test", "felix_test", "karl_test"),
    ("Delta", "DLT", "grace_test", "henry_test", "luna_test"),
]


class ApiFailure(RuntimeError):
    pass


class Api:
    def __init__(self, base_url: str) -> None:
        self.base_url = base_url.rstrip("/")

    def request(
        self,
        method: str,
        path: str,
        payload: dict[str, Any] | None = None,
        token: str | None = None,
        expected: tuple[int, ...] = (200, 201, 204),
    ) -> Any:
        headers: dict[str, str] = {"Accept": "application/json"}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        data = None
        if payload is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            f"{self.base_url}{path}", data=data, method=method, headers=headers
        )
        try:
            with urllib.request.urlopen(req, timeout=20) as response:
                body = response.read().decode("utf-8")
                status = response.status
        except urllib.error.HTTPError as exc:
            status = exc.code
            body = exc.read().decode("utf-8", errors="replace")
        except urllib.error.URLError as exc:
            raise ApiFailure(f"{method} {path}: connection failed: {exc.reason}") from exc
        if status not in expected:
            # No tokens or passwords in diagnostic output.
            raise ApiFailure(f"{method} {path}: HTTP {status}: {body[:1200]}")
        if not body:
            return None
        if path == "/health" and body.strip() == "ok":
            return "ok"
        try:
            return json.loads(body)
        except json.JSONDecodeError as exc:
            raise ApiFailure(f"{method} {path}: expected JSON, got {body[:100]!r}") from exc

    def post(self, path: str, body: dict[str, Any], token: str) -> Any:
        return self.request("POST", path, body, token)

    def get(self, path: str, token: str) -> Any:
        return self.request("GET", path, token=token)

    def login(self, username: str) -> str:
        return self.request("POST", "/login", {
            "username": username, "password": PASSWORD
        })["access_token"]


@dataclass
class TournamentData:
    id: str
    step_ids: list[str]
    registrations: list[str]
    game_id: str


def bootstrap_admin(container: str, username: str) -> None:
    """Explicit, local-only opt-in; changes role, never inserts password hashes."""
    if not username.replace("_", "").isalnum():
        raise RuntimeError("Invalid bootstrap administrator username")
    sql = "UPDATE users SET role = 'admin' WHERE username = '" + username + "';"
    cmd = [
        "docker", "exec", container, "sh", "-lc",
        'PGPASSWORD="$POSTGRES_PASSWORD" psql '
        '-v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c '
        + json.dumps(sql),
    ]
    completed = subprocess.run(cmd, text=True, capture_output=True, check=False)
    if completed.returncode != 0 or "UPDATE 1" not in completed.stdout:
        raise RuntimeError(
            "Admin promotion failed. Check container credentials and DB mapping. "
            + completed.stderr[-400:]
        )


def iso(hours: int = 0) -> str:
    value = dt.datetime.now(dt.timezone.utc) + dt.timedelta(hours=hours)
    return value.replace(microsecond=0).isoformat().replace("+00:00", "Z")


def create_users(api: Api, admin_name: str, bootstrap: bool, container: str) -> dict[str, dict[str, str]]:
    created: dict[str, dict[str, str]] = {}
    for username in [admin_name, *USERS]:
        data = api.request("POST", "/register", {
            "username": username, "password": PASSWORD
        }, expected=(201,))
        created[username] = {"id": data["id"]}
        print(f"  user: {username}")

    if bootstrap:
        bootstrap_admin(container, admin_name)
        print("  Admin promoted in the local PostgreSQL container")

    for username in created:
        created[username]["token"] = api.login(username)
    return created


def create_game(api: Api, admin: str, name: str, description: str) -> dict[str, Any]:
    game = api.post("/games", {"name": name, "description": description}, admin)
    print(f"  game: {name}")
    return game


def create_stat(api: Api, admin: str, game_id: str, name: str, key: str, kind: str) -> dict[str, Any]:
    stat = api.post("/stats", {"name": name, "key": key, "type": kind}, admin)
    api.request("PUT", f"/games/{game_id}/stats/{stat['id']}", token=admin, expected=(204,))
    return stat


def create_global_teams(api: Api, users: dict[str, dict[str, str]], game_id: str) -> dict[str, dict[str, str]]:
    result: dict[str, dict[str, str]] = {}
    for name, tag, owner, second, substitute in TEAMS:
        token = users[owner]["token"]
        image = "https://api.dicebear.com/9.x/shapes/png?" + urllib.parse.urlencode({"seed": name})
        team = api.post("/teams", {
            "game_id": game_id, "name": name, "tag": tag, "picture_url": image,
        }, token)
        api.post(f"/teams/{team['id']}/members", {
            "user_id": users[second]["id"], "role": "member"
        }, token)
        api.post(f"/teams/{team['id']}/members", {
            "user_id": users[substitute]["id"], "role": "substitute"
        }, token)
        result[name] = {"id": team["id"], "owner": owner}
        print(f"  team: {name} (2 starters, 1 substitute)")
    return result


def create_tournament(
    api: Api, admin: str, name: str, game_id: str,
    count: int, kind: str = "solo", size: int | None = None,
    scoring: str = "none", top_n: int | None = None,
) -> str:
    payload = {
        "game_id": game_id,
        "name": name,
        "description": f"Reproducible demo tournament: {name}",
        "start_date": iso(48),
        "end_date": iso(96),
        "registration_open_at": iso(-24),
        "registration_close_at": iso(24),
        "participant_type": kind,
        "team_size": size,
        "max_participants": count,
        "team_scoring_mode": scoring,
        "team_scoring_n": top_n,
    }
    tournament = api.post("/tournaments", payload, admin)
    print(f"  tournament: {name}")
    return tournament["id"]


def set_tournament_status(api: Api, admin: str, tournament_id: str, status: str) -> None:
    api.post(f"/tournaments/{tournament_id}/status", {"status": status}, admin)


def create_step(
    api: Api, admin: str, tournament_id: str,
    position: int, fmt: str, match_type: str,
    groups: int, group_size: int, advance: int,
    matches_per_group: int = 1,
) -> str:
    data = api.post(f"/tournaments/{tournament_id}/steps", {
        "position": position,
        "format": fmt,
        "match_type": match_type,
        "group_count": groups,
        "group_size": group_size,
        "matches_per_group": matches_per_group,
        "advance_per_group": advance,
        "tiebreak": [],
    }, admin)
    return data["id"]


def register_solo(api: Api, users: dict[str, dict[str, str]], tournament_id: str, names: list[str]) -> list[str]:
    registrations: list[str] = []
    for username in names:
        participant = api.post(f"/tournaments/{tournament_id}/participants", {}, users[username]["token"])
        registrations.append(participant["id"])
        api.post(
            f"/tournaments/{tournament_id}/participants/{participant['id']}/check-in",
            {}, users[username]["token"],
        )
    return registrations


def register_teams(
    api: Api, users: dict[str, dict[str, str]], tournament_id: str,
    global_teams: dict[str, dict[str, str]],
) -> list[str]:
    registrations = []
    for name in [t[0] for t in TEAMS]:
        global_team = global_teams[name]
        token = users[global_team["owner"]]["token"]
        tournament_team = api.post(f"/tournaments/{tournament_id}/teams", {
            "team_id": global_team["id"],
        }, token)
        participant = api.post(f"/tournaments/{tournament_id}/participants", {
            "tournament_team_id": tournament_team["id"],
        }, token)
        api.post(
            f"/tournaments/{tournament_id}/participants/{participant['id']}/check-in",
            {}, token,
        )
        registrations.append(participant["id"])
    return registrations


def groups_for_step(api: Api, admin: str, tournament_id: str, step_id: str) -> list[dict[str, Any]]:
    response = api.get(f"/tournaments/{tournament_id}/steps/{step_id}/ranking", admin)
    # Backend response is a list of groups; always use the returned group IDs.
    if not isinstance(response, list):
        raise ApiFailure(f"Unexpected step ranking representation: {type(response).__name__}")
    return response


def start_step(api: Api, admin: str, tournament_id: str, step_id: str) -> list[dict[str, Any]]:
    api.post(f"/tournaments/{tournament_id}/steps/{step_id}/start", {}, admin)
    return groups_for_step(api, admin, tournament_id, step_id)


def create_match(
    api: Api, admin: str, tournament_id: str, step_id: str,
    group_id: str, participants: list[str], round_number: int,
    bracket: str | None = None, next_match_id: str | None = None,
) -> dict[str, Any]:
    return api.post(f"/tournaments/{tournament_id}/steps/{step_id}/matches", {
        "group_id": group_id,
        "round": round_number,
        "bracket": bracket,
        "next_match_id": next_match_id,
        "scheduled_at": iso(48 + round_number),
        "participant_ids": participants,
    }, admin)


def update_result(api: Api, admin: str, tournament_id: str, step_id: str,
                  match: dict[str, Any], winners: list[str], stat_key: str = "kills") -> None:
    """Save one-winner match results with ranks within the participant count."""
    participant_ids = [participant["participant_id"] for participant in match["participants"]]
    if len(participant_ids) < 2 or len(set(participant_ids)) != len(participant_ids):
        raise ApiFailure("Match result seed requires at least two distinct participants")
    if len(winners) != 1 or winners[0] not in participant_ids:
        raise ApiFailure("Match result seed requires exactly one matching winner")

    winner_id = winners[0]
    ranked_ids = [winner_id, *(pid for pid in participant_ids if pid != winner_id)]
    rank_by_id = {participant_id: rank for rank, participant_id in enumerate(ranked_ids, 1)}
    scores = [
        {
            "participant_id": participant_id,
            "stats": {stat_key: 12 if participant_id == winner_id else 4},
            "rank": rank_by_id[participant_id],
            "result": "win" if participant_id == winner_id else "loss",
        }
        for participant_id in participant_ids
    ]
    prefix = f"/tournaments/{tournament_id}/steps/{step_id}/matches/{match['id']}"
    api.request("PUT", prefix + "/results", {"results": scores}, admin)
    api.post(prefix + "/status", {"status": "finished"}, admin)


def seed_solo_pools(api: Api, admin: str, users: dict[str, dict[str, str]],
                    game_id: str, stat_id: str, *, finish_some: bool) -> TournamentData:
    name = "DEMO - TFT FFA (live)" if finish_some else "DEMO - TFT FFA (registration)"
    tid = create_tournament(api, admin, name, game_id, 8)
    steps = [
        create_step(api, admin, tid, 1, "pool", "ffa", 2, 4, 2),
        create_step(api, admin, tid, 2, "pool", "ffa", 1, 4, 1),
    ]
    api.post(f"/tournaments/{tid}/scoring-rules", {
        "stat_id": stat_id,
        "mode": "table",
        "points_table": {"1": 8, "2": 6, "3": 4, "4": 2},
    }, admin)
    set_tournament_status(api, admin, tid, "registration")
    names = USERS[:8]
    registrations = register_solo(api, users, tid, names)
    if finish_some:
        set_tournament_status(api, admin, tid, "ongoing")
        groups = start_step(api, admin, tid, steps[0])
        for index, group in enumerate(groups):
            participant_ids = [p["participant_id"] for p in group["participants"]]
            match = create_match(api, admin, tid, steps[0], group["group_id"], participant_ids, 1)
            if index == 0:
                # Deliberately keep the other group scheduled so the step stays ongoing.
                results = [
                    {"participant_id": pid, "stats": {"placement": i + 1}, "rank": i + 1,
                     "result": "win" if i == 0 else "loss"}
                    for i, pid in enumerate(participant_ids)
                ]
                path = f"/tournaments/{tid}/steps/{steps[0]}/matches/{match['id']}"
                api.request("PUT", path + "/results", {"results": results}, admin)
                api.post(path + "/status", {"status": "finished"}, admin)
    return TournamentData(tid, steps, registrations, game_id)


def seed_team_pool(api: Api, admin: str, users: dict[str, dict[str, str]],
                   global_teams: dict[str, dict[str, str]], game_id: str,
                   kills_stat_id: str) -> TournamentData:
    tid = create_tournament(api, admin, "DEMO - CS2 Teams (active)", game_id, 4, "team", 2)
    steps = [
        create_step(api, admin, tid, 1, "pool", "duel", 2, 2, 1),
        create_step(api, admin, tid, 2, "single_elim", "duel", 1, 2, 1),
    ]
    api.post(f"/tournaments/{tid}/scoring-rules", {
        "stat_id": kills_stat_id, "mode": "linear", "coefficient": 1.0,
    }, admin)
    set_tournament_status(api, admin, tid, "registration")
    regs = register_teams(api, users, tid, global_teams)
    set_tournament_status(api, admin, tid, "ongoing")
    groups = start_step(api, admin, tid, steps[0])
    for index, group in enumerate(groups):
        ids = [p["participant_id"] for p in group["participants"]]
        match = create_match(api, admin, tid, steps[0], group["group_id"], ids, 1)
        if index == 0:
            # Only the first match is completed, leaving the step active for testing.
            scores = [{"participant_id": pid, "stats": {"total": {"kills": 11 if n == 0 else 5},
                       "players": {}}, "rank": n + 1,
                       "result": "win" if n == 0 else "loss"} for n, pid in enumerate(ids)]
            path = f"/tournaments/{tid}/steps/{steps[0]}/matches/{match['id']}"
            api.request("PUT", path + "/results", {"results": scores}, admin)
            api.post(path + "/status", {"status": "finished"}, admin)
    return TournamentData(tid, steps, regs, game_id)


def seed_elimination(api: Api, admin: str, users: dict[str, dict[str, str]],
                     game_id: str, stat_id: str, fmt: str, *, complete_first: bool) -> TournamentData:
    title = "DEMO - Single elimination" if fmt == "single_elim" else "DEMO - Double elimination"
    tid = create_tournament(api, admin, title, game_id, 4)
    steps = [create_step(api, admin, tid, 1, fmt, "duel", 1, 4, 1)]
    api.post(f"/tournaments/{tid}/scoring-rules", {
        "stat_id": stat_id, "mode": "linear", "coefficient": 1.0,
    }, admin)
    set_tournament_status(api, admin, tid, "registration")
    regs = register_solo(api, users, tid, USERS[4:8])
    set_tournament_status(api, admin, tid, "ongoing")
    groups = start_step(api, admin, tid, steps[0])
    group = groups[0]
    gid = group["group_id"]
    ids = [p["participant_id"] for p in group["participants"]]
    bracket = "winners" if fmt == "double_elim" else None
    # Create the destination match first so next_match_id references a real match.
    final = create_match(
        api, admin, tid, steps[0], gid, [], 2,
        "grand_final" if fmt == "double_elim" else None,
    )
    semifinal_a = create_match(api, admin, tid, steps[0], gid, ids[:2], 1, bracket, final["id"])
    create_match(api, admin, tid, steps[0], gid, ids[2:], 1, bracket, final["id"])
    if complete_first:
        update_result(api, admin, tid, steps[0], semifinal_a, [ids[0]], "wins")
    if fmt == "double_elim":
        # A separate losers match is present as an illustrative bracket region.
        # It is not connected by invented loss propagation: backend only propagates winners.
        create_match(api, admin, tid, steps[0], gid, [], 2, "losers")
    return TournamentData(tid, steps, regs, game_id)


def seed_swiss(api: Api, admin: str, users: dict[str, dict[str, str]], game_id: str) -> TournamentData:
    tid = create_tournament(api, admin, "DEMO - Swiss tournament", game_id, 8)
    steps = [create_step(api, admin, tid, 1, "swiss", "duel", 1, 8, 1, 3)]
    set_tournament_status(api, admin, tid, "registration")
    regs = register_solo(api, users, tid, USERS[8:16])
    set_tournament_status(api, admin, tid, "ongoing")
    group = start_step(api, admin, tid, steps[0])[0]
    ids = [p["participant_id"] for p in group["participants"]]
    for n in range(0, len(ids), 2):
        match = create_match(api, admin, tid, steps[0], group["group_id"], ids[n:n+2], 1)
        if n == 0:
            api.post(
                f"/tournaments/{tid}/steps/{steps[0]}/matches/{match['id']}/status",
                {"status": "ongoing"}, admin,
            )
        elif n == 2:
            api.post(
                f"/tournaments/{tid}/steps/{steps[0]}/matches/{match['id']}/status",
                {"status": "cancelled"}, admin,
            )
    return TournamentData(tid, steps, regs, game_id)



def seed_completed_duel(api: Api, admin: str, users: dict[str, dict[str, str]],
                        game_id: str, stat_id: str) -> TournamentData:
    tid = create_tournament(api, admin, "DEMO - Completed duel", game_id, 2)
    step = create_step(api, admin, tid, 1, "pool", "duel", 1, 2, 1)
    api.post(f"/tournaments/{tid}/scoring-rules", {
        "stat_id": stat_id, "mode": "linear", "coefficient": 3.0,
    }, admin)
    set_tournament_status(api, admin, tid, "registration")
    registrations = register_solo(api, users, tid, USERS[-2:])
    set_tournament_status(api, admin, tid, "ongoing")
    group = start_step(api, admin, tid, step)[0]
    ids = [p["participant_id"] for p in group["participants"]]
    match = create_match(api, admin, tid, step, group["group_id"], ids, 1)
    update_result(api, admin, tid, step, match, [ids[0]], "wins")
    # The server closes the only step when the only match is finished.
    api.post(f"/tournaments/{tid}/status", {"status": "finished"}, admin)
    return TournamentData(tid, [step], registrations, game_id)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--url", default=os.environ.get("API_URL", "http://127.0.0.1:8080"))
    parser.add_argument("--admin", default="seed_admin")
    parser.add_argument("--bootstrap-admin", action="store_true",
                        help="Promote the newly registered admin in LOCAL PostgreSQL via docker exec")
    parser.add_argument("--postgres-container", default="epickem-postgres-1")
    parser.add_argument("--output", default="epickem-seed-manifest.json")
    args = parser.parse_args()

    if urllib.parse.urlsplit(args.url).hostname not in ("localhost", "127.0.0.1", "::1"):
        parser.error("This seed script is restricted to localhost development APIs")
    api = Api(args.url)
    api.request("GET", "/health")
    spec = api.request("GET", "/openapi.json")
    for path in ("/tournaments/{id}/steps/{step_id}/matches", "/tournaments/{id}/steps"):
        if path not in spec.get("paths", {}):
            raise RuntimeError(f"Running backend is missing required route {path}")

    # Refuse partial/duplicate runs. The script is intended for a fresh DB only.
    # Games can be present from Liquibase's seed migration, so check tournament names.
    existing = api.request("GET", "/tournaments", expected=(200, 401))
    if isinstance(existing, list) and any(t.get("name", "").startswith("DEMO - ") for t in existing):
        raise RuntimeError("DEMO tournaments already exist: reset the local DB before reseeding")

    print("Creating accounts via /register (backend hashes passwords)...")
    users = create_users(api, args.admin, args.bootstrap_admin, args.postgres_container)
    admin = users[args.admin]["token"]

    print("Creating games and statistics...")
    # Migrations may preseed Counter-Strike 2, so reuse games by name when found.
    available_games = api.get("/games?limit=100&offset=0", admin)
    def ensure_game(name: str, description: str) -> dict[str, Any]:
        found = next((g for g in available_games if g["name"].casefold() == name.casefold()), None)
        return found or create_game(api, admin, name, description)

    cs2 = ensure_game("Counter-Strike 2", "Competitive team duels")
    tft = ensure_game("Teamfight Tactics", "Free-for-all placement")
    chess = ensure_game("Chess", "Swiss and elimination tournaments")
    known_stats = api.get("/stats?limit=100&offset=0", admin)
    def ensure_stat(game_id: str, name: str, key: str, kind: str) -> dict[str, Any]:
        found = next((s for s in known_stats if s["key"] == key), None)
        stat = found or create_stat(api, admin, game_id, name, key, kind)
        if found:
            linked_stats = api.get(f"/games/{game_id}/stats", admin)
            if not any(item["id"] == stat["id"] for item in linked_stats):
                api.request("PUT", f"/games/{game_id}/stats/{stat['id']}", token=admin, expected=(204,))
        return stat

    kills = ensure_stat(cs2["id"], "Kills", "kills", "flat")
    ensure_stat(cs2["id"], "Deaths", "deaths", "flat")
    ensure_stat(cs2["id"], "Win rate", "win_rate", "percent")
    placement = ensure_stat(tft["id"], "Placement", "placement", "flat")
    ensure_stat(tft["id"], "Damage", "damage", "flat")
    wins = ensure_stat(chess["id"], "Wins", "wins", "flat")

    print("Creating global teams...")
    global_teams = create_global_teams(api, users, cs2["id"])

    print("Creating tournaments, steps and real matches...")
    created: dict[str, TournamentData] = {}
    created["cs2"] = seed_team_pool(api, admin, users, global_teams, cs2["id"], kills["id"])
    created["tft_live"] = seed_solo_pools(api, admin, users, tft["id"], placement["id"], finish_some=True)
    created["tft_registration"] = seed_solo_pools(api, admin, users, tft["id"], placement["id"], finish_some=False)
    created["single_elimination"] = seed_elimination(api, admin, users, chess["id"], wins["id"], "single_elim", complete_first=True)
    created["double_elimination"] = seed_elimination(api, admin, users, chess["id"], wins["id"], "double_elim", complete_first=False)
    created["swiss"] = seed_swiss(api, admin, users, chess["id"])
    created["completed"] = seed_completed_duel(api, admin, users, chess["id"], wins["id"])

    cancelled = create_tournament(api, admin, "DEMO - Cancelled tournament", chess["id"], 4)
    set_tournament_status(api, admin, cancelled, "cancelled")
    created["cancelled"] = TournamentData(cancelled, [], [], chess["id"])
    draft = create_tournament(api, admin, "DEMO - Draft tournament", tft["id"], 8)
    created["draft"] = TournamentData(draft, [], [], tft["id"])

    manifest = {
        "api": args.url,
        "users": {username: info["id"] for username, info in users.items()},
        "global_teams": {name: team["id"] for name, team in global_teams.items()},
        "tournaments": {
            key: {"id": value.id, "steps": value.step_ids, "registrations": value.registrations}
            for key, value in created.items()
        },
    }
    with open(args.output, "w", encoding="utf-8") as output:
        json.dump(manifest, output, indent=2, ensure_ascii=False)
        output.write("\n")
    print(f"Seed complete. Manifest (no passwords or tokens): {args.output}")
    print(f"All {len(users)} accounts use the requested development password.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (ApiFailure, RuntimeError) as exc:
        print(f"Seed failed: {exc}", file=sys.stderr)
        sys.exit(1)
