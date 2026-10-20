-- Chaque fichier de test s'exécute dans une transaction annulée à la fin.
BEGIN;

INSERT INTO users (username, password_hash, role_id)
SELECT 'alice', '$argon2id$hash', id FROM roles WHERE name = 'admin';

SELECT pg_temp.assert(
  (SELECT id IS NOT NULL FROM users WHERE username = 'alice'),
  'l''identifiant est généré automatiquement'
);

SELECT pg_temp.assert_raises(
  $$INSERT INTO users (username, password_hash, role_id)
    SELECT 'alice', 'autre-hash', id FROM roles WHERE name = 'user'$$, '23505',
  'le nom d''utilisateur est unique'
);

SELECT pg_temp.assert_raises(
  $$INSERT INTO users (username, password_hash, role_id) VALUES ('bob', 'hash', 32000)$$, '23503',
  'role_id doit référencer un rôle existant'
);

SELECT pg_temp.assert_raises(
  $$INSERT INTO users (username, password_hash, role_id) VALUES (repeat('a', 33), 'hash', 1)$$, '22001',
  'le nom d''utilisateur fait au plus 32 caractères'
);

SELECT pg_temp.assert_raises(
  $$INSERT INTO users (password_hash, role_id) VALUES ('hash', 1)$$, '23502',
  'username est obligatoire'
);

SELECT pg_temp.assert_raises(
  $$INSERT INTO users (username, role_id) VALUES ('bob', 1)$$, '23502',
  'password_hash est obligatoire'
);

SELECT pg_temp.assert_raises(
  $$INSERT INTO users (username, password_hash) VALUES ('bob', 'hash')$$, '23502',
  'role_id est obligatoire'
);

ROLLBACK;
