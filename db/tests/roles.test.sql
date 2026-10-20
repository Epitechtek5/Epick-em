-- Chaque fichier de test s'exécute dans une transaction annulée à la fin.
BEGIN;

SELECT pg_temp.assert(
  (SELECT array_agg(name::text ORDER BY name) FROM roles) = ARRAY['admin', 'user', 'watcher'],
  'les rôles admin, user et watcher existent, et eux seuls'
);

SELECT pg_temp.assert_raises(
  $$INSERT INTO roles (name) VALUES ('superadmin')$$, '22P02',
  'un rôle hors de l''enum est refusé'
);

SELECT pg_temp.assert_raises(
  $$INSERT INTO roles (name) VALUES ('admin')$$, '23505',
  'un rôle ne peut pas exister deux fois'
);

INSERT INTO users (username, password_hash, role_id)
SELECT 'alice', '$argon2id$hash', id FROM roles WHERE name = 'user';

SELECT pg_temp.assert_raises(
  $$DELETE FROM roles WHERE name = 'user'$$, '23503',
  'un rôle attribué à un utilisateur ne peut pas être supprimé'
);

ROLLBACK;
