-- Roles
CREATE TYPE public.app_role AS ENUM ('admin','staff');
CREATE TYPE public.attendance_intent AS ENUM ('not_contacted','confirmed','declined','maybe','no_answer','call_back','cancelled');
CREATE TYPE public.actual_attendance AS ENUM ('unknown','attended','absent');
CREATE TYPE public.callback_status AS ENUM ('open','completed','cancelled');

CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  full_name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "profiles readable by authenticated" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles self insert" ON public.profiles FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "profiles self update" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());
CREATE TRIGGER profiles_updated BEFORE UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);
GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user_id AND role = _role);
$$;

CREATE POLICY "roles readable by authenticated" ON public.user_roles FOR SELECT TO authenticated USING (true);

-- Ensures a profile exists and grants admin to the first ever user
CREATE OR REPLACE FUNCTION public.ensure_profile(_full_name TEXT DEFAULT NULL)
RETURNS public.app_role LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid UUID := auth.uid();
        _email TEXT;
        _role public.app_role;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT email INTO _email FROM auth.users WHERE id = _uid;
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (_uid, _email, COALESCE(NULLIF(_full_name,''), split_part(COALESCE(_email,''),'@',1)))
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email,
    full_name = COALESCE(NULLIF(public.profiles.full_name,''), EXCLUDED.full_name);
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid) THEN
    IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'admin') THEN
      INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'admin');
    ELSE
      INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'staff');
    END IF;
  END IF;
  SELECT role INTO _role FROM public.user_roles WHERE user_id = _uid ORDER BY role LIMIT 1;
  RETURN _role;
END; $$;

-- Events
CREATE TABLE public.events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  master_event_key TEXT NOT NULL UNIQUE,
  source_event_id TEXT,
  event_name TEXT NOT NULL,
  description TEXT,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  timezone TEXT,
  status TEXT,
  meeting_url TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  data_origin TEXT NOT NULL DEFAULT 'google_sheets',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX events_start_at_idx ON public.events (start_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.events TO authenticated;
GRANT ALL ON public.events TO service_role;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "events read" ON public.events FOR SELECT TO authenticated USING (true);
CREATE POLICY "events admin write" ON public.events FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER events_updated BEFORE UPDATE ON public.events FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- People
CREATE TABLE public.people (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_key TEXT NOT NULL UNIQUE,
  email TEXT,
  email_normalised TEXT,
  full_name TEXT,
  phone TEXT,
  job_title TEXT,
  data_origin TEXT NOT NULL DEFAULT 'google_sheets',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX people_email_idx ON public.people (email_normalised);
CREATE INDEX people_name_idx ON public.people (lower(full_name));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.people TO authenticated;
GRANT ALL ON public.people TO service_role;
ALTER TABLE public.people ENABLE ROW LEVEL SECURITY;
CREATE POLICY "people read" ON public.people FOR SELECT TO authenticated USING (true);
CREATE POLICY "people admin write" ON public.people FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER people_updated BEFORE UPDATE ON public.people FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Bookings
CREATE TABLE public.event_bookings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_key TEXT NOT NULL UNIQUE,
  event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  person_id UUID NOT NULL REFERENCES public.people(id) ON DELETE CASCADE,
  source_attendee_id TEXT,
  booking_status TEXT,
  source_account TEXT,
  meeting_url TEXT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  data_origin TEXT NOT NULL DEFAULT 'google_sheets',
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bookings_event_idx ON public.event_bookings (event_id);
CREATE INDEX bookings_person_idx ON public.event_bookings (person_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.event_bookings TO authenticated;
GRANT ALL ON public.event_bookings TO service_role;
ALTER TABLE public.event_bookings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "bookings read" ON public.event_bookings FOR SELECT TO authenticated USING (true);
CREATE POLICY "bookings admin write" ON public.event_bookings FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER bookings_updated BEFORE UPDATE ON public.event_bookings FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Operational status (never touched by sync)
CREATE TABLE public.attendee_operational_statuses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL UNIQUE REFERENCES public.event_bookings(id) ON DELETE CASCADE,
  attendance_intent public.attendance_intent NOT NULL DEFAULT 'not_contacted',
  actual_attendance public.actual_attendance NOT NULL DEFAULT 'unknown',
  last_contacted_at TIMESTAMPTZ,
  last_contacted_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  callback_at TIMESTAMPTZ,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ops_intent_idx ON public.attendee_operational_statuses (attendance_intent);
CREATE INDEX ops_callback_idx ON public.attendee_operational_statuses (callback_at);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.attendee_operational_statuses TO authenticated;
GRANT ALL ON public.attendee_operational_statuses TO service_role;
ALTER TABLE public.attendee_operational_statuses ENABLE ROW LEVEL SECURITY;
CREATE POLICY "ops read" ON public.attendee_operational_statuses FOR SELECT TO authenticated USING (true);
CREATE POLICY "ops insert" ON public.attendee_operational_statuses FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "ops update" ON public.attendee_operational_statuses FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "ops admin delete" ON public.attendee_operational_statuses FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER ops_updated BEFORE UPDATE ON public.attendee_operational_statuses FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Notes
CREATE TABLE public.contact_notes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES public.event_bookings(id) ON DELETE CASCADE,
  person_id UUID REFERENCES public.people(id) ON DELETE CASCADE,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX notes_booking_idx ON public.contact_notes (booking_id);
CREATE INDEX notes_person_idx ON public.contact_notes (person_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.contact_notes TO authenticated;
GRANT ALL ON public.contact_notes TO service_role;
ALTER TABLE public.contact_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notes read" ON public.contact_notes FOR SELECT TO authenticated USING (true);
CREATE POLICY "notes insert own" ON public.contact_notes FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY "notes update own" ON public.contact_notes FOR UPDATE TO authenticated USING (created_by = auth.uid()) WITH CHECK (created_by = auth.uid());
CREATE POLICY "notes delete own or admin" ON public.contact_notes FOR DELETE TO authenticated USING (created_by = auth.uid() OR public.has_role(auth.uid(),'admin'));

-- Callbacks
CREATE TABLE public.callback_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID NOT NULL REFERENCES public.event_bookings(id) ON DELETE CASCADE,
  due_at TIMESTAMPTZ NOT NULL,
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status public.callback_status NOT NULL DEFAULT 'open',
  note TEXT,
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX callbacks_due_idx ON public.callback_tasks (due_at);
CREATE INDEX callbacks_status_idx ON public.callback_tasks (status);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.callback_tasks TO authenticated;
GRANT ALL ON public.callback_tasks TO service_role;
ALTER TABLE public.callback_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "callbacks read" ON public.callback_tasks FOR SELECT TO authenticated USING (true);
CREATE POLICY "callbacks insert" ON public.callback_tasks FOR INSERT TO authenticated WITH CHECK (created_by = auth.uid());
CREATE POLICY "callbacks update" ON public.callback_tasks FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "callbacks admin delete" ON public.callback_tasks FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'admin'));
CREATE TRIGGER callbacks_updated BEFORE UPDATE ON public.callback_tasks FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Activity log
CREATE TABLE public.activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id UUID REFERENCES public.event_bookings(id) ON DELETE CASCADE,
  person_id UUID REFERENCES public.people(id) ON DELETE SET NULL,
  event_id UUID REFERENCES public.events(id) ON DELETE SET NULL,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX activity_created_idx ON public.activity_log (created_at DESC);
CREATE INDEX activity_booking_idx ON public.activity_log (booking_id);
GRANT SELECT, INSERT ON public.activity_log TO authenticated;
GRANT ALL ON public.activity_log TO service_role;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "activity read" ON public.activity_log FOR SELECT TO authenticated USING (true);
CREATE POLICY "activity insert own" ON public.activity_log FOR INSERT TO authenticated WITH CHECK (actor_id = auth.uid());

-- Sync runs
CREATE TABLE public.sync_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'running',
  source TEXT NOT NULL DEFAULT 'google_sheets',
  events_read INTEGER NOT NULL DEFAULT 0,
  events_upserted INTEGER NOT NULL DEFAULT 0,
  attendees_read INTEGER NOT NULL DEFAULT 0,
  bookings_upserted INTEGER NOT NULL DEFAULT 0,
  people_upserted INTEGER NOT NULL DEFAULT 0,
  skipped_rows INTEGER NOT NULL DEFAULT 0,
  error_message TEXT,
  detail JSONB NOT NULL DEFAULT '{}'::jsonb,
  triggered_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
CREATE INDEX sync_runs_started_idx ON public.sync_runs (started_at DESC);
GRANT SELECT, INSERT, UPDATE ON public.sync_runs TO authenticated;
GRANT ALL ON public.sync_runs TO service_role;
ALTER TABLE public.sync_runs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sync read" ON public.sync_runs FOR SELECT TO authenticated USING (true);
CREATE POLICY "sync admin write" ON public.sync_runs FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

-- Settings and header mappings
CREATE TABLE public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "settings read" ON public.app_settings FOR SELECT TO authenticated USING (true);
CREATE POLICY "settings admin write" ON public.app_settings FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TABLE public.header_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tab_name TEXT NOT NULL,
  source_header TEXT NOT NULL,
  target_field TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tab_name, source_header)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.header_mappings TO authenticated;
GRANT ALL ON public.header_mappings TO service_role;
ALTER TABLE public.header_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "mappings read" ON public.header_mappings FOR SELECT TO authenticated USING (true);
CREATE POLICY "mappings admin write" ON public.header_mappings FOR ALL TO authenticated USING (public.has_role(auth.uid(),'admin')) WITH CHECK (public.has_role(auth.uid(),'admin'));

INSERT INTO public.app_settings (key, value) VALUES
  ('source_spreadsheet', '{"spreadsheet_id":"1aZF8ueiXSnq1Ji_pmcHOxUWLgUCuXJW0ThBqUpSypjE","events_tab":"Upcoming_Events_Raw","attendees_tab":"Upcoming_Attendees_Raw"}'::jsonb),
  ('demo_mode', '{"enabled":false}'::jsonb);

INSERT INTO public.header_mappings (tab_name, source_header, target_field) VALUES
  ('Upcoming_Events_Raw','Event ID','source_event_id'),
  ('Upcoming_Events_Raw','Master Event Key','master_event_key'),
  ('Upcoming_Events_Raw','Event Name','event_name'),
  ('Upcoming_Events_Raw','Description','description'),
  ('Upcoming_Events_Raw','Start Date','start_at'),
  ('Upcoming_Events_Raw','End Time','end_at'),
  ('Upcoming_Events_Raw','Timezone','timezone'),
  ('Upcoming_Events_Raw','Status','status'),
  ('Upcoming_Events_Raw','Zoom Link','meeting_url'),
  ('Upcoming_Attendees_Raw','Event ID','source_event_id'),
  ('Upcoming_Attendees_Raw','Master Event Key','master_event_key'),
  ('Upcoming_Attendees_Raw','Attendee ID','source_attendee_id'),
  ('Upcoming_Attendees_Raw','Attendee Name','full_name'),
  ('Upcoming_Attendees_Raw','Attendee Email','email'),
  ('Upcoming_Attendees_Raw','Phone','phone'),
  ('Upcoming_Attendees_Raw','Job Title','job_title'),
  ('Upcoming_Attendees_Raw','Status','booking_status'),
  ('Upcoming_Attendees_Raw','Zoom Link','meeting_url'),
  ('Upcoming_Attendees_Raw','Source Account','source_account'),
  ('Upcoming_Attendees_Raw','Attendee Unique Key','booking_key');