//! Transaction-local snapshots and correction application.

use super::*;

pub(super) async fn snapshot(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    tid: Uuid,
) -> Result<CompetitionSnapshot, StoreError> {
    let tournament = tournament(
        sqlx::query_as::<_, TournamentRow>(&format!(
            "SELECT {} FROM tournaments WHERE id = $1",
            tournament_columns()
        ))
        .bind(tid)
        .fetch_one(&mut **tx)
        .await?,
    )?;
    let steps = sqlx::query_as::<_, StepRow>(&format!(
        "SELECT {} FROM step WHERE tournament_id = $1 ORDER BY id",
        step_columns()
    ))
    .bind(tid)
    .fetch_all(&mut **tx)
    .await?
    .into_iter()
    .map(step)
    .collect::<Result<Vec<_>, _>>()?;
    let groups = sqlx::query_as::<_, (Uuid, Uuid, i32)>("SELECT id, step_id, index FROM step_group WHERE step_id IN (SELECT id FROM step WHERE tournament_id = $1) ORDER BY id").bind(tid).fetch_all(&mut **tx).await?.into_iter().map(|(id, step_id, index)| StepGroup { id, step_id, index }).collect();
    let step_members = sqlx::query_as::<_, StepParticipantRow>("SELECT step_id, participant_id, group_id, points::float8, final_rank, status, seed FROM step_participant WHERE step_id IN (SELECT id FROM step WHERE tournament_id = $1) ORDER BY step_id, participant_id").bind(tid).fetch_all(&mut **tx).await?.into_iter().map(step_participant).collect::<Result<Vec<_>, _>>()?;
    let participants = sqlx::query_as::<_, ParticipantRow>(&format!(
        "SELECT {} FROM tournament_participant WHERE tournament_id = $1 ORDER BY id",
        participant_columns()
    ))
    .bind(tid)
    .fetch_all(&mut **tx)
    .await?
    .into_iter()
    .map(participant)
    .collect::<Result<Vec<_>, _>>()?;
    let matches = sqlx::query_as::<_, MatchRow>(&format!("SELECT {} FROM match WHERE step_id IN (SELECT id FROM step WHERE tournament_id = $1) AND NOT archived ORDER BY id", match_columns())).bind(tid).fetch_all(&mut **tx).await?.into_iter().map(match_from).collect::<Result<Vec<_>, _>>()?;
    let members = sqlx::query_as::<_, MatchParticipantRow>(&format!("SELECT {MATCH_PARTICIPANT_COLUMNS} FROM match_participant WHERE match_id IN (SELECT id FROM match WHERE step_id IN (SELECT id FROM step WHERE tournament_id = $1) AND NOT archived) ORDER BY match_id, participant_id")).bind(tid).fetch_all(&mut **tx).await?.into_iter().map(match_participant).collect::<Result<Vec<_>, _>>()?;
    let games = load_games_in(tx, "g.match_id IN (SELECT id FROM match WHERE step_id IN (SELECT id FROM step WHERE tournament_id = $1) AND NOT archived)", tid).await?;
    let configuration = sqlx::query_scalar::<_, serde_json::Value>("SELECT jsonb_build_object('stats', COALESCE((SELECT jsonb_agg(to_jsonb(s) ORDER BY s.id) FROM stats s JOIN stat_game sg ON sg.stat_id = s.id WHERE sg.game_id = $1), '[]'::jsonb), 'options', COALESCE((SELECT jsonb_agg(to_jsonb(o) ORDER BY o.stat_id, o.position, o.key) FROM stat_option o WHERE o.game_id = $1), '[]'::jsonb), 'rules', COALESCE((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.id) FROM scoring_rule r WHERE r.tournament_id = $2), '[]'::jsonb))").bind(tournament.game_id).bind(tid).fetch_one(&mut **tx).await?;
    let mut snapshot = CompetitionSnapshot {
        configuration,
        tournament,
        steps,
        groups,
        step_members,
        participants,
        matches,
        members,
        games,
    };
    snapshot.canonicalize();
    Ok(snapshot)
}

pub(super) async fn apply(
    tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
    before: &CompetitionSnapshot,
    next: &CompetitionSnapshot,
) -> Result<(), StoreError> {
    let active: Vec<Uuid> = next.matches.iter().map(|m| m.id).collect();
    let archived: Vec<Uuid> = before
        .matches
        .iter()
        .filter(|m| !active.contains(&m.id))
        .map(|m| m.id)
        .collect();
    let step_ids: Vec<Uuid> = next.steps.iter().map(|s| s.id).collect();
    let group_ids: Vec<Uuid> = next.groups.iter().map(|g| g.id).collect();
    sqlx::query("UPDATE match SET archived = true, status = 'cancelled', group_id = NULL, updated_at = now() WHERE id = ANY($1)").bind(&archived).execute(&mut **tx).await?;
    sqlx::query("DELETE FROM match_game WHERE match_id = ANY($1)")
        .bind(&active)
        .execute(&mut **tx)
        .await?;
    sqlx::query("DELETE FROM match_participant WHERE match_id = ANY($1)")
        .bind(&active)
        .execute(&mut **tx)
        .await?;
    sqlx::query("DELETE FROM step_participant WHERE step_id = ANY($1)")
        .bind(&step_ids)
        .execute(&mut **tx)
        .await?;
    sqlx::query("DELETE FROM step_group WHERE step_id = ANY($1) AND id <> ALL($2)")
        .bind(&step_ids)
        .bind(&group_ids)
        .execute(&mut **tx)
        .await?;
    for step in &next.steps {
        sqlx::query(
            "UPDATE step SET status = $2, updated_at = $3::text::timestamptz WHERE id = $1",
        )
        .bind(step.id)
        .bind(step.status.as_str())
        .bind(&step.updated_at)
        .execute(&mut **tx)
        .await?;
    }
    for group in &next.groups {
        sqlx::query("INSERT INTO step_group (id, step_id, index) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING").bind(group.id).bind(group.step_id).bind(group.index).execute(&mut **tx).await?;
    }
    for member in &next.step_members {
        sqlx::query("INSERT INTO step_participant (step_id, participant_id, group_id, points, final_rank, status, seed, tournament_id) VALUES ($1, $2, $3, $4::float8::numeric, $5, $6, $7, $8)").bind(member.step_id).bind(member.participant_id).bind(member.group_id).bind(member.points).bind(member.final_rank).bind(member.status.as_str()).bind(member.seed).bind(next.tournament.id).execute(&mut **tx).await?;
    }
    for m in &next.matches {
        sqlx::query("INSERT INTO match (id, game_id, step_id, group_id, round, bracket, number, best_of, scheduled_at, started_at, ended_at, status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::text::timestamptz, $10::text::timestamptz, $11::text::timestamptz, $12, $13::text::timestamptz, $14::text::timestamptz) ON CONFLICT (id) DO UPDATE SET group_id = EXCLUDED.group_id, status = EXCLUDED.status, started_at = EXCLUDED.started_at, ended_at = EXCLUDED.ended_at, updated_at = EXCLUDED.updated_at, archived = false")
            .bind(m.id).bind(m.game_id).bind(m.step_id).bind(m.group_id).bind(m.round).bind(m.bracket.map(|b| b.as_str())).bind(m.number).bind(m.best_of).bind(&m.scheduled_at).bind(&m.started_at).bind(&m.ended_at).bind(m.status.as_str()).bind(&m.created_at).bind(&m.updated_at).execute(&mut **tx).await?;
    }
    for m in &next.matches {
        sqlx::query("UPDATE match SET next_match_id = $2, next_slot = $3::int4::smallint, loser_next_match_id = $4, loser_next_slot = $5::int4::smallint WHERE id = $1").bind(m.id).bind(m.next_match_id).bind(m.next_slot).bind(m.loser_next_match_id).bind(m.loser_next_slot).execute(&mut **tx).await?;
    }
    for p in &next.members {
        insert_match_participant(tx, p.match_id, p.participant_id, p.slot).await?;
        save_match_scores_in(
            tx,
            p.match_id,
            vec![MatchScore {
                participant_id: p.participant_id,
                stats: p.stats.clone(),
                points: p.points,
                rank: p.rank,
                result: p.result,
                slot: p.slot,
                games_won: p.games_won,
            }],
        )
        .await?;
    }
    for game in &next.games {
        sqlx::query("INSERT INTO match_game (id, match_id, number, status, attributes, started_at, ended_at, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6::text::timestamptz, $7::text::timestamptz, $8::text::timestamptz, $9::text::timestamptz)").bind(game.id).bind(game.match_id).bind(game.number).bind(game.status.as_str()).bind(&game.attributes).bind(&game.started_at).bind(&game.ended_at).bind(&game.created_at).bind(&game.updated_at).execute(&mut **tx).await?;
        for p in &game.participants {
            insert_game_participant(tx, game.id, p.participant_id).await?;
            save_game_scores_in(
                tx,
                game.id,
                vec![MatchScore {
                    participant_id: p.participant_id,
                    stats: p.stats.clone(),
                    points: p.points,
                    rank: p.rank,
                    result: p.result,
                    slot: None,
                    games_won: None,
                }],
            )
            .await?;
        }
    }
    sqlx::query("UPDATE tournaments SET status = $2, updated_at = now() WHERE id = $1")
        .bind(next.tournament.id)
        .bind(next.tournament.status.as_str())
        .execute(&mut **tx)
        .await?;
    Ok(())
}
