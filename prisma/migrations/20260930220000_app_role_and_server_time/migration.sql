-- Create the application role without a login or credential.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'distribo_app') THEN
    CREATE ROLE distribo_app NOLOGIN;
  END IF;
END
$$;

ALTER ROLE distribo_app
  NOLOGIN
  NOSUPERUSER
  NOCREATEDB
  NOCREATEROLE
  NOREPLICATION
  NOBYPASSRLS;

-- Let the application role resolve objects in the public schema.
GRANT USAGE ON SCHEMA public TO distribo_app;

-- The migration owner grants ordinary DML on tables created afterward.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO distribo_app;

CREATE OR REPLACE FUNCTION public.set_server_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.server_updated_at := CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;
