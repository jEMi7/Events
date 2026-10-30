-- 1. Roles in a dedicated table
DO $$ BEGIN
  CREATE TYPE public.app_role AS ENUM ('admin','staff');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role)
$$;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role) TO authenticated, service_role;

DROP POLICY IF EXISTS user_roles_self_read ON public.user_roles;
CREATE POLICY user_roles_self_read ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
DROP POLICY IF EXISTS user_roles_admin_manage ON public.user_roles;
CREATE POLICY user_roles_admin_manage ON public.user_roles FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin')) WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Existing policies use is_admin()/is_staff(); point them at user_roles.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin')
$$;
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid())
$$;
REVOKE ALL ON FUNCTION public.is_admin() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_staff() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.is_admin() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_staff() TO authenticated, service_role;

-- 2. Profiles
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email text;

CREATE OR REPLACE FUNCTION public.ensure_profile(_full_name text DEFAULT '')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  uid uuid := auth.uid();
  uemail text;
  first_user boolean;
BEGIN
  IF uid IS NULL THEN RETURN; END IF;
  SELECT email INTO uemail FROM auth.users WHERE id = uid;

  INSERT INTO public.profiles (id, full_name, email)
  VALUES (uid, NULLIF(_full_name, ''), uemail)
  ON CONFLICT (id) DO UPDATE
    SET email = COALESCE(public.profiles.email, EXCLUDED.email),
        full_name = COALESCE(public.profiles.full_name, EXCLUDED.full_name);

  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = uid) THEN
    SELECT NOT EXISTS (SELECT 1 FROM public.user_roles) INTO first_user;
    INSERT INTO public.user_roles (user_id, role)
    VALUES (uid, CASE WHEN first_user THEN 'admin'::public.app_role ELSE 'staff'::public.app_role END)
    ON CONFLICT DO NOTHING;
  END IF;
END $$;
REVOKE ALL ON FUNCTION public.ensure_profile(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_profile(text) TO authenticated, service_role;

-- Seed roles for anyone who already has a profile
INSERT INTO public.user_roles (user_id, role)
SELECT p.id, 'admin'::public.app_role
FROM public.profiles p
WHERE NOT EXISTS (SELECT 1 FROM public.user_roles)
ORDER BY p.created_at
LIMIT 1
ON CONFLICT DO NOTHING;

UPDATE public.profiles p SET email = u.email
FROM auth.users u WHERE u.id = p.id AND p.email IS NULL;

-- 3. Events
ALTER TABLE public.events RENAME COLUMN starts_at TO start_at;
ALTER TABLE public.events RENAME COLUMN ends_at TO end_at;
ALTER TABLE public.events RENAME COLUMN event_status TO status;
ALTER TABLE public.events RENAME COLUMN last_source_sync_at TO last_synced_at;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS data_origin text NOT NULL DEFAULT 'google_sheets';

-- 4. People
ALTER TABLE public.people RENAME COLUMN normalized_email TO email_normalised;
ALTER TABLE public.people RENAME COLUMN last_source_sync_at TO last_synced_at;
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS identity_key text;
ALTER TABLE public.people ADD COLUMN IF NOT EXISTS data_origin text NOT NULL DEFAULT 'google_sheets';
UPDATE public.people SET identity_key = COALESCE(identity_key, email_normalised, source_attendee_id, id::text);
ALTER TABLE public.people ALTER COLUMN identity_key SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS people_identity_key_uidx ON public.people (identity_key);

-- 5. Bookings
ALTER TABLE public.event_bookings RENAME COLUMN source_booking_key TO booking_key;
ALTER TABLE public.event_bookings RENAME COLUMN last_source_sync_at TO last_synced_at;
ALTER TABLE public.event_bookings ADD COLUMN IF NOT EXISTS meeting_url text;
ALTER TABLE public.event_bookings ADD COLUMN IF NOT EXISTS data_origin text NOT NULL DEFAULT 'google_sheets';
CREATE UNIQUE INDEX IF NOT EXISTS event_bookings_booking_key_uidx ON public.event_bookings (booking_key);
CREATE INDEX IF NOT EXISTS event_bookings_event_idx ON public.event_bookings (event_id);
CREATE INDEX IF NOT EXISTS event_bookings_person_idx ON public.event_bookings (person_id);

-- 6. Operational statuses
ALTER TABLE public.booking_operations RENAME TO attendee_operational_statuses;
ALTER TABLE public.attendee_operational_statuses
  ALTER COLUMN attendance_intent SET DEFAULT 'not_contacted',
  ALTER COLUMN actual_attendance SET DEFAULT 'unknown';
UPDATE public.attendee_operational_statuses SET attendance_intent = COALESCE(attendance_intent,'not_contacted'), actual_attendance = COALESCE(actual_attendance,'unknown');

-- 7. Notes and call backs
ALTER TABLE public.contact_notes ADD COLUMN IF NOT EXISTS person_id uuid REFERENCES public.people(id) ON DELETE CASCADE;
ALTER TABLE public.contact_notes ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS contact_notes_person_idx ON public.contact_notes (person_id);
ALTER TABLE public.callback_tasks ADD COLUMN IF NOT EXISTS created_by uuid;
CREATE INDEX IF NOT EXISTS callback_tasks_due_idx ON public.callback_tasks (status, due_at);

-- 8. Activity history
ALTER TABLE public.activity_log RENAME COLUMN action_type TO action;
ALTER TABLE public.activity_log ADD COLUMN IF NOT EXISTS detail jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.activity_log ADD COLUMN IF NOT EXISTS event_id uuid REFERENCES public.events(id) ON DELETE CASCADE;
ALTER TABLE public.activity_log ADD COLUMN IF NOT EXISTS person_id uuid REFERENCES public.people(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS activity_log_created_idx ON public.activity_log (created_at DESC);

-- 9. Sync history
ALTER TABLE public.sync_runs RENAME COLUMN source_name TO source;
ALTER TABLE public.sync_runs RENAME COLUMN events_rows_seen TO events_read;
ALTER TABLE public.sync_runs RENAME COLUMN attendee_rows_seen TO attendees_read;
ALTER TABLE public.sync_runs ADD COLUMN IF NOT EXISTS people_upserted integer NOT NULL DEFAULT 0;
ALTER TABLE public.sync_runs ADD COLUMN IF NOT EXISTS skipped_rows integer NOT NULL DEFAULT 0;
ALTER TABLE public.sync_runs ADD COLUMN IF NOT EXISTS detail jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.sync_runs ADD COLUMN IF NOT EXISTS triggered_by uuid;
ALTER TABLE public.sync_runs ALTER COLUMN source SET DEFAULT 'google_sheets';

-- 10. Header mappings
ALTER TABLE public.header_mappings RENAME COLUMN source_tab TO tab_name;
ALTER TABLE public.header_mappings RENAME COLUMN destination_field TO target_field;
CREATE UNIQUE INDEX IF NOT EXISTS header_mappings_uidx ON public.header_mappings (tab_name, source_header);

INSERT INTO public.header_mappings (tab_name, source_header, target_field) VALUES
  ('Upcoming_Events_Raw','Event ID','source_event_id'),
  ('Upcoming_Events_Raw','Master Event Key','master_event_key'),
  ('Upcoming_Events_Raw','Event Name','event_name'),
  ('Upcoming_Events_Raw','Description','description'),
  ('Upcoming_Events_Raw','Start Date','start_at'),
  ('Upcoming_Events_Raw','End Time','end_at'),
  ('Upcoming_Events_Raw','Timezone','timezone'),
  ('Upcoming_Events_Raw','Status','status'),
  ('Upcoming_Attendees_Raw','Event ID','source_event_id'),
  ('Upcoming_Attendees_Raw','Master Event Key','master_event_key'),
  ('Upcoming_Attendees_Raw','Event Name','event_name'),
  ('Upcoming_Attendees_Raw','Event Date','event_date'),
  ('Upcoming_Attendees_Raw','Event Time','event_time'),
  ('Upcoming_Attendees_Raw','Attendee ID','source_attendee_id'),
  ('Upcoming_Attendees_Raw','Attendee Name','full_name'),
  ('Upcoming_Attendees_Raw','Attendee Email','email'),
  ('Upcoming_Attendees_Raw','Phone','phone'),
  ('Upcoming_Attendees_Raw','Job Title','job_title'),
  ('Upcoming_Attendees_Raw','Status','booking_status'),
  ('Upcoming_Attendees_Raw','Zoom Link','meeting_url'),
  ('Upcoming_Attendees_Raw','Source Account','source_account'),
  ('Upcoming_Attendees_Raw','Attendee Unique Key','source_booking_key')
ON CONFLICT (tab_name, source_header) DO UPDATE SET target_field = EXCLUDED.target_field;

-- 11. Grants for renamed/updated tables
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendee_operational_statuses TO authenticated;
GRANT ALL ON public.attendee_operational_statuses TO service_role;
GRANT SELECT ON public.header_mappings TO authenticated;
GRANT ALL ON public.header_mappings TO service_role;