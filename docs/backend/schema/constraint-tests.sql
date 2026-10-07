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
