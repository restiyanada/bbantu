-- Not journaled (no schema.ts change generates this — it's a trigger, which
-- drizzle-kit doesn't manage). Apply by hand, same as every migration here.
--
-- Every staff-gated policy in this schema, plus requireAdmin() in every Edge
-- Function, compares admin_users.email to the signed-in JWT's email with a
-- plain `=`. Postgres text equality is case-sensitive. Supabase Auth always
-- lowercases auth.users.email (and the JWT's email claim mirrors it), but
-- admin_users.email is hand-inserted via the SQL editor — nothing has ever
-- normalized it. An admin row created as "Resti@Example.com" silently fails
-- every permission check for a user signed in as "resti@example.com": the
-- EXISTS subquery just returns zero rows. No error — a policy returning false
-- is a denial, not an error — so "the DB says true" (the row LOOKS right) is
-- exactly what you'd see while every write still 403s.
--
-- This is unrelated to 0011 (which fixed admin_users having no read policy at
-- all): that bug denied EVERY admin equally; this one denies admins whose row
-- happens to have mismatched case, which is why some things noticeably worked
-- and this one didn't.
--
-- Fix: normalize at the one place that's actually uncontrolled — a trigger
-- lowercases and trims admin_users.email on every insert/update, and
-- db/schema.ts now lowercases the JWT side of every comparison to match.
--
-- Verify:
--   SELECT email FROM admin_users WHERE email <> lower(trim(email));
--   -- empty result = every row already normalized
--
--   INSERT INTO admin_users (name, email) VALUES ('Trigger check', ' MixedCase@Example.com ');
--   SELECT email FROM admin_users WHERE name = 'Trigger check';
--   -- must print exactly: mixedcase@example.com
--   DELETE FROM admin_users WHERE name = 'Trigger check';

UPDATE admin_users SET email = lower(trim(email)) WHERE email <> lower(trim(email));

CREATE OR REPLACE FUNCTION admin_users_normalize_email() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  NEW.email := lower(trim(NEW.email));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS admin_users_normalize_email_trigger ON admin_users;
CREATE TRIGGER admin_users_normalize_email_trigger
  BEFORE INSERT OR UPDATE OF email ON admin_users
  FOR EACH ROW
  EXECUTE FUNCTION admin_users_normalize_email();
