-- Assertions chargées avant chaque fichier de test (fonctions temporaires, propres à la session).

-- Échoue si la condition n'est pas vraie (NULL compris).
CREATE FUNCTION pg_temp.assert(condition boolean, description text) RETURNS void
LANGUAGE plpgsql AS $$
BEGIN
  IF condition IS NOT TRUE THEN
    RAISE EXCEPTION 'ÉCHEC : %', description;
  END IF;
END $$;

-- Échoue si l'instruction ne lève pas l'erreur attendue (code SQLSTATE, ex. 23505).
-- L'instruction s'exécute dans une sous-transaction : ses effets sont annulés.
CREATE FUNCTION pg_temp.assert_raises(statement text, expected_state text, description text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  state text;
  message text;
BEGIN
  BEGIN
    EXECUTE statement;
  EXCEPTION WHEN OTHERS THEN
    state := SQLSTATE;
    message := SQLERRM;
  END;
  IF state IS NULL THEN
    RAISE EXCEPTION 'ÉCHEC : % (aucune erreur, attendu %)', description, expected_state;
  ELSIF state <> expected_state THEN
    RAISE EXCEPTION 'ÉCHEC : % (attendu %, obtenu % : %)', description, expected_state, state, message;
  END IF;
END $$;
