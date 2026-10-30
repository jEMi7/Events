/**
 * Flexible header-mapping layer for the read-only source tabs.
 * Source headers are matched case/space/punctuation-insensitively so that
 * small changes in the n8n export do not break the sync.
 */

export type FieldMap = Record<string, string>;

export const EVENT_FIELD_ALIASES: Record<string, string[]> = {
  source_event_id: ["event id", "eventbrite event id", "source event id"],
  master_event_key: ["master event key", "master key", "event key"],
  event_name: ["event name", "name", "title"],
  description: ["description", "summary"],
  start_at: ["start date", "start", "start date time", "starts at"],
  end_at: ["end time", "end date", "ends at"],
  timezone: ["timezone", "time zone", "tz"],
  status: ["status", "event status"],
  meeting_url: ["zoom link", "meeting url", "zoom url", "join link", "meeting link"],
};

export const ATTENDEE_FIELD_ALIASES: Record<string, string[]> = {
  source_event_id: ["event id", "eventbrite event id"],
  master_event_key: ["master event key", "master key", "event key"],
  event_name: ["event name"],
  event_date: ["event date"],
  event_time: ["event time"],
  source_attendee_id: ["attendee id", "registration id", "order id"],
  full_name: ["attendee name", "name", "full name"],
  email: ["attendee email", "email", "email address"],
  phone: ["phone", "phone number", "mobile", "telephone"],
  job_title: ["job title", "role", "position"],
  booking_status: ["status", "booking status", "attendee status"],
  meeting_url: ["zoom link", "meeting url", "join link"],
  source_account: ["source account", "account", "owner"],
  booking_key: ["attendee unique key", "unique key"],
};

export function normaliseHeader(header: string) {
  return header
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Build header index -> canonical field name. */
export function buildFieldMap(
  headers: string[],
  aliases: Record<string, string[]>,
  overrides: FieldMap = {},
) {
  const map = new Map<number, string>();
  const unmapped: string[] = [];

  headers.forEach((header, index) => {
    const raw = header.trim();
    if (!raw) return;
    const override = overrides[raw] ?? overrides[normaliseHeader(raw)];
    if (override) {
      map.set(index, override);
      return;
    }
    const norm = normaliseHeader(raw);
    const field = Object.entries(aliases).find(([, list]) => list.includes(norm))?.[0];
    if (field) map.set(index, field);
    else unmapped.push(raw);
  });

  return { map, unmapped };
}

export type SheetRow = {
  fields: Record<string, string>;
  raw: Record<string, string>;
};

export function mapRows(headers: string[], rows: string[][], fieldMap: Map<number, string>) {
  return rows
    .map<SheetRow>((row) => {
      const fields: Record<string, string> = {};
      const raw: Record<string, string> = {};
      headers.forEach((header, index) => {
        const value = (row[index] ?? "").toString().trim();
        if (header.trim()) raw[header.trim()] = value;
        const field = fieldMap.get(index);
        if (field && value) fields[field] = value;
      });
      return { fields, raw };
    })
    .filter((row) => Object.values(row.raw).some((value) => value !== ""));
}

const ISO_INSTANT = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?Z/;

/**
 * Business rule: events sharing the same start instant are one logical event,
 * regardless of source id or name. The source master key sometimes carries a
 * "name|instant" composite, so we canonicalise on the instant.
 */
export function canonicalMasterKey(rawKey?: string, fallbackStart?: string | null) {
  const candidate = rawKey?.match(ISO_INSTANT)?.[0];
  if (candidate) return new Date(candidate).toISOString();
  const fallback = fallbackStart ? parseNaiveAsUtc(fallbackStart) : null;
  if (fallback) return fallback.toISOString();
  return rawKey?.trim().toLowerCase() || "";
}

/** Parses "2026-09-14 13:00:00" (or ISO) as an instant, assuming UTC when no zone. */
export function parseNaiveAsUtc(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (ISO_INSTANT.test(trimmed)) return new Date(trimmed.match(ISO_INSTANT)![0]);
  const match = trimmed.match(
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?$/,
  );
  if (match) {
    const [, y, m, d, hh, mm, ss] = match;
    return new Date(
      Date.UTC(Number(y), Number(m) - 1, Number(d), Number(hh), Number(mm), Number(ss ?? 0)),
    );
  }
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

/**
 * Resolve start/end instants. The master key holds the true UTC instant, so the
 * offset between it and the naive local start is applied to the naive end time.
 */
export function resolveEventTimes(fields: Record<string, string>, masterKey: string) {
  const naiveStart = fields["start_at"] ? parseNaiveAsUtc(fields["start_at"]) : null;
  const naiveEnd = fields["end_at"] ? parseNaiveAsUtc(fields["end_at"]) : null;
  const keyInstant = masterKey.match(ISO_INSTANT) ? new Date(masterKey) : null;

  const start = keyInstant ?? naiveStart;
  let end: Date | null = naiveEnd;

  if (naiveEnd && naiveStart && keyInstant) {
    const offset = naiveStart.getTime() - keyInstant.getTime();
    end = new Date(naiveEnd.getTime() - offset);
  }

  return {
    start_at: start ? start.toISOString() : null,
    end_at: end ? end.toISOString() : null,
  };
}

export function normaliseEmail(email?: string) {
  const value = email?.trim().toLowerCase();
  return value && value.includes("@") ? value : null;
}

/** One person can register for many events, so identity must be stable. */
export function personIdentityKey(fields: Record<string, string>) {
  const email = normaliseEmail(fields["email"]);
  if (email) return `email:${email}`;
  if (fields["source_attendee_id"]) return `attendee:${fields["source_attendee_id"]}`;
  const name = fields["full_name"]?.trim().toLowerCase();
  const phone = fields["phone"]?.replace(/\D/g, "");
  if (name || phone) return `composite:${name ?? ""}|${phone ?? ""}`;
  return "";
}

export function bookingKeyFor(
  fields: Record<string, string>,
  masterKey: string,
  identityKey: string,
) {
  const provided = fields["booking_key"]?.trim();
  if (provided) return provided.toLowerCase();
  return `${masterKey}|${identityKey}`;
}
