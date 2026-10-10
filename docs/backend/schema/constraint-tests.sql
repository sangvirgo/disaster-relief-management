-- Constraint smoke tests. Run with psql -v ON_ERROR_STOP=1 against a database loaded from the matching .sql file.
-- Each block must RAISE NOTICE 'PASS ...'; an unexpected success raises an exception.
\set ON_ERROR_STOP on
CREATE OR REPLACE FUNCTION expect_fail(label text, stmt text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  BEGIN EXECUTE stmt; RAISE EXCEPTION 'FAIL % (statement succeeded)', label;
  EXCEPTION WHEN check_violation OR unique_violation OR foreign_key_violation OR raise_exception OR not_null_violation THEN
    IF SQLERRM LIKE 'FAIL %' THEN RAISE; END IF; RAISE NOTICE 'PASS %', label;
  END;
END $$;

-- Asserts the statement fails with exactly this SQLSTATE (e.g. 42501 insufficient_privilege, 23505 unique_violation, 23514 check_violation).
CREATE OR REPLACE FUNCTION expect_sqlstate(label text, stmt text, expected text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE s text;
BEGIN
  BEGIN EXECUTE stmt; RAISE EXCEPTION 'FAIL % (statement succeeded)', label;
  EXCEPTION WHEN OTHERS THEN
    GET STACKED DIAGNOSTICS s = RETURNED_SQLSTATE;
    IF SQLERRM LIKE 'FAIL %' THEN RAISE; END IF;
    IF s <> expected THEN RAISE EXCEPTION 'FAIL % (got SQLSTATE % [%], expected %)', label, s, SQLERRM, expected; END IF;
    RAISE NOTICE 'PASS % [%]', label, s;
  END;
END $$;
