-- Keep server-owned application tables inaccessible through Supabase's public Data API.
-- This is portable to plain PostgreSQL, where Supabase's client roles may not exist.
DO $security$
DECLARE
  relation_record record;
BEGIN
  FOR relation_record IN
    SELECT schemaname, tablename
    FROM pg_tables
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format(
      'ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY',
      relation_record.schemaname,
      relation_record.tablename
    );

    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE %I.%I FROM anon',
        relation_record.schemaname,
        relation_record.tablename
      );
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format(
        'REVOKE ALL ON TABLE %I.%I FROM authenticated',
        relation_record.schemaname,
        relation_record.tablename
      );
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated';
    EXECUTE 'ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated';
  END IF;
END
$security$;
