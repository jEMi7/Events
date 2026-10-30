import { useEffect, useState } from "react";
import {
  CalendarClock,
  Mail,
  Phone,
  Briefcase,
  Link2,
  Check,
  X,
  MoreHorizontal,
  ChevronDown,
  Clock,
  MessageSquarePlus,
  Plus,
  FileText,
  RotateCcw,
  UserCheck,
  UserX,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { AttendanceBadge, IntentBadge, OriginBadge, SoftBadge } from "@/components/status-badge";
import { CallbackDialog, NoteDialog, refFor } from "@/components/attendee-actions";
import { EmptyState, ErrorState, LoadingRows } from "@/components/data-states";
import {
  formatDateTime,
  formatShort,
  initials,
  INTENT_LABELS,
  ATTENDANCE_LABELS,
} from "@/lib/domain";
import { useActivity, useBookingCallbacks, useNotes } from "@/lib/queries";
import { useSetIntent, useSetAttendance, useUndoIntent } from "@/lib/mutations";
import type { BookingRecord, ActivityRecord } from "@/lib/queries";
import type { AttendanceIntent } from "@/lib/domain";
import "@/styles/attendee-drawer.css";

const ACTION_LABELS: Record<string, string> = {
  intent_updated: "Attendance intent updated",
  status_reverted: "Status reverted",
  attendance_updated: "Actual attendance updated",
  note_added: "Note added",
  callback_scheduled: "Call back scheduled",
  callback_completed: "Call back completed",
  callback_rescheduled: "Call back rescheduled",
};

function Field({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value?: string | null;
}) {
  return (
    <div className="attendee-info-card">
      <span className="attendee-field-icon">{icon}</span>
      <div>
        <p className="attendee-field-label">{label}</p>
        <p className="attendee-field-value">{value?.trim() ? value : "—"}</p>
      </div>
    </div>
  );
}

function activityPresentation(item: ActivityRecord) {
  const intent = typeof item.detail?.["intent"] === "string" ? item.detail["intent"] : null;
  const attendance =
    typeof item.detail?.["attendance"] === "string" ? item.detail["attendance"] : null;
  if (item.action === "intent_updated")
    return {
      icon: <Check />,
      tone:
        intent === "declined" || intent === "cancelled"
          ? "danger"
          : intent === "confirmed"
            ? "success"
            : "lavender",
      status: intent
        ? (INTENT_LABELS[intent as keyof typeof INTENT_LABELS] ?? intent.replace(/_/g, " "))
        : "Recorded",
    } as const;
  if (item.action === "attendance_updated")
    return {
      icon: <UserCheck />,
      tone: attendance === "absent" ? "danger" : "success",
      status: attendance
        ? (ATTENDANCE_LABELS[attendance as keyof typeof ATTENDANCE_LABELS] ?? attendance)
        : "Recorded",
    } as const;
  if (item.action.startsWith("callback_"))
    return {
      icon: <CalendarClock />,
      tone: item.action === "callback_completed" ? "success" : "lavender",
      status:
        item.action === "callback_completed"
          ? "Completed"
          : item.action === "callback_rescheduled"
            ? "Rescheduled"
            : "Scheduled",
    } as const;
  if (item.action === "status_reverted")
    return { icon: <RotateCcw />, tone: "neutral", status: "Reverted" } as const;
  if (item.action === "note_added")
    return { icon: <FileText />, tone: "lavender", status: "Saved" } as const;
  return { icon: <Clock />, tone: "neutral", status: "Recorded" } as const;
}

export function AttendeeDrawer({
  booking,
  open,
  onOpenChange,
}: {
  booking: BookingRecord | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const notes = useNotes(booking?.id);
  const activity = useActivity({ bookingId: booking?.id, limit: 40 });
  const callbacks = useBookingCallbacks(booking?.id);
  const setIntent = useSetIntent();
  const setAttendance = useSetAttendance();
  const undoIntent = useUndoIntent();
  const [tab, setTab] = useState("history");
  const [noteOpen, setNoteOpen] = useState(false);
  const [callbackOpen, setCallbackOpen] = useState(false);
  useEffect(() => {
    setTab("history");
    setNoteOpen(false);
    setCallbackOpen(false);
  }, [booking?.id]);
  const name = booking?.person.full_name ?? booking?.person.email ?? "Attendee";
  const raw = Object.entries(booking?.raw_payload ?? {});
  const busy = setIntent.isPending || setAttendance.isPending || undoIntent.isPending;
  const canUndo =
    booking &&
    (booking.status.attendance_intent !== "not_contacted" ||
      booking.status.actual_attendance !== "unknown" ||
      Boolean(booking.status.callback_at) ||
      Boolean(booking.status.last_contacted_at));
  const changeIntent = (intent: AttendanceIntent) => {
    if (booking) setIntent.mutate({ ref: refFor(booking), intent });
  };

  const noteSection = () => (
    <section className="attendee-section attendee-notes" aria-label="Saved notes">
      <div className="attendee-section-heading">
        <h3>
          <FileText /> Notes
        </h3>
        <Button variant="ghost" onClick={() => setNoteOpen(true)}>
          <Plus /> Add note
        </Button>
      </div>
      {notes.isLoading ? (
        <LoadingRows rows={2} />
      ) : notes.error ? (
        <ErrorState message={(notes.error as Error).message} onRetry={() => notes.refetch()} />
      ) : (notes.data ?? []).length ? (
        <ul className="attendee-note-list">
          {notes.data!.map((note) => (
            <li key={note.id}>
              <p>{note.body}</p>
              <small>
                {note.author?.full_name ?? "Staff"} · {formatDateTime(note.created_at)}
              </small>
            </li>
          ))}
        </ul>
      ) : (
        <button className="attendee-note-prompt" onClick={() => setNoteOpen(true)}>
          <MessageSquarePlus /> Add a note about this attendee...
        </button>
      )}
    </section>
  );

  const callbackSection = () => (
    <section className="attendee-section attendee-callbacks" aria-label="Saved call backs">
      <div className="attendee-section-heading">
        <h3>
          <Phone /> Call backs
        </h3>
        <Button variant="ghost" onClick={() => setCallbackOpen(true)}>
          <Plus /> Add call back
        </Button>
      </div>
      {callbacks.isLoading ? (
        <LoadingRows rows={2} />
      ) : callbacks.error ? (
        <ErrorState
          message={(callbacks.error as Error).message}
          onRetry={() => callbacks.refetch()}
        />
      ) : (callbacks.data ?? []).length ? (
        <ul className="attendee-callback-list">
          {callbacks.data!.map((task: any) => (
            <li key={task.id}>
              <span className="attendee-callback-icon">
                <CalendarClock />
              </span>
              <div>
                <p>{formatDateTime(task.due_at)}</p>
                <small>
                  {task.owner?.full_name ?? "Unassigned"}
                  {task.note ? ` · ${task.note}` : ""}
                </small>
              </div>
              <SoftBadge tone={task.status === "completed" ? "success" : "info"}>
                {task.status === "completed" ? "Completed" : "Open"}
              </SoftBadge>
            </li>
          ))}
        </ul>
      ) : (
        <div className="attendee-callback-empty">
          <CalendarClock />
          <p>
            No call backs scheduled<small>Add a call back reminder for this attendee.</small>
          </p>
        </div>
      )}
    </section>
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="attendee-details-drawer scrollbar-slim">
        {booking ? (
          <>
            <SheetHeader className="attendee-drawer-header">
              <span className="attendee-drawer-avatar">{initials(name)}</span>
              <div className="attendee-drawer-identity">
                <SheetTitle>{name}</SheetTitle>
                <SheetDescription>{booking.person.email ?? "No email on record"}</SheetDescription>
                <div className="attendee-header-badges">
                  {booking.source_account && (
                    <SoftBadge tone="lavender">{booking.source_account}</SoftBadge>
                  )}
                  <IntentBadge value={booking.status.attendance_intent} showDot />
                  <SoftBadge tone="lavender">{booking.booking_status ?? "unknown"}</SoftBadge>
                </div>
              </div>
            </SheetHeader>
            <div className="attendee-drawer-body">
              <div className="attendee-drawer-actions">
                <Button
                  className="attendee-confirm"
                  disabled={busy}
                  onClick={() => changeIntent("confirmed")}
                  aria-pressed={booking.status.attendance_intent === "confirmed"}
                >
                  <Check />
                  {setIntent.isPending ? "Saving..." : "Mark as Confirmed"}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => changeIntent("declined")}
                  aria-pressed={booking.status.attendance_intent === "declined"}
                >
                  <X /> Decline
                </Button>
                <div className="attendee-split-action">
                  <Button variant="outline" onClick={() => setCallbackOpen(true)} disabled={busy}>
                    <Phone /> Call back
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" aria-label="Call back options">
                        <ChevronDown />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onSelect={() => setCallbackOpen(true)}>
                        Schedule a call back
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setTab("callbacks")}>
                        View saved call backs
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {booking.person.email ? (
                  <Button asChild variant="outline">
                    <a
                      href={`mailto:${booking.person.email}`}
                      title="Open your email app; sending is handled there"
                    >
                      <Mail /> Send email
                    </a>
                  </Button>
                ) : (
                  <Button variant="outline" disabled title="No email on record">
                    <Mail /> Send email
                  </Button>
                )}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" aria-label="More attendee actions">
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    {(["not_contacted", "maybe", "no_answer", "cancelled"] as const).map(
                      (intent) => (
                        <DropdownMenuItem
                          key={intent}
                          disabled={busy}
                          onSelect={() => changeIntent(intent)}
                        >
                          {INTENT_LABELS[intent]}
                        </DropdownMenuItem>
                      ),
                    )}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      disabled={busy}
                      onSelect={() =>
                        setAttendance.mutate({ ref: refFor(booking), attendance: "attended" })
                      }
                    >
                      <UserCheck /> Attended
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={busy}
                      onSelect={() =>
                        setAttendance.mutate({ ref: refFor(booking), attendance: "absent" })
                      }
                    >
                      <UserX /> Absent
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setNoteOpen(true)}>
                      <MessageSquarePlus /> Add note
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={busy || !canUndo}
                      onSelect={() => undoIntent.mutate({ ref: refFor(booking) })}
                    >
                      <RotateCcw /> Undo last status change
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
              <div className="attendee-info-grid">
                <Field icon={<Mail />} label="Email" value={booking.person.email} />
                <Field
                  icon={<Phone />}
                  label="Phone"
                  value={booking.person.phone || "No phone number"}
                />
                <Field icon={<Briefcase />} label="Job title" value={booking.person.job_title} />
                <Field
                  icon={<Clock />}
                  label="Last contacted"
                  value={
                    booking.status.last_contacted_at
                      ? formatDateTime(booking.status.last_contacted_at)
                      : "Not contacted yet"
                  }
                />
              </div>
              <Tabs value={tab} onValueChange={setTab} className="attendee-drawer-tabs">
                <TabsList aria-label="Attendee information">
                  <TabsTrigger value="history">History</TabsTrigger>
                  <TabsTrigger value="notes">Notes</TabsTrigger>
                  <TabsTrigger value="callbacks">Call backs</TabsTrigger>
                  <TabsTrigger value="raw">Source data</TabsTrigger>
                </TabsList>
                <TabsContent value="history">
                  <section
                    className="attendee-section attendee-history"
                    aria-label="Saved activity history"
                  >
                    {activity.isLoading ? (
                      <LoadingRows rows={4} />
                    ) : activity.error ? (
                      <ErrorState
                        message={(activity.error as Error).message}
                        onRetry={() => activity.refetch()}
                      />
                    ) : (activity.data ?? []).length === 0 ? (
                      <EmptyState
                        title="No activity yet"
                        description="Actions you take appear here."
                        icon={<Clock />}
                      />
                    ) : (
                      <ol className="attendee-timeline">
                        {activity.data!.map((item) => {
                          const presentation = activityPresentation(item);
                          return (
                            <li key={item.id} data-tone={presentation.tone}>
                              <span className="attendee-timeline-icon">{presentation.icon}</span>
                              <div className="attendee-timeline-copy">
                                <p>
                                  {ACTION_LABELS[item.action] ?? item.action}
                                  {item.detail && typeof item.detail["intent"] === "string"
                                    ? ` — ${String(item.detail["intent"]).replace(/_/g, " ")}`
                                    : ""}
                                  {item.detail && typeof item.detail["attendance"] === "string"
                                    ? ` — ${String(item.detail["attendance"])}`
                                    : ""}
                                </p>
                                {item.note && <p className="attendee-activity-note">{item.note}</p>}
                                <small>
                                  {formatDateTime(item.created_at)} ·{" "}
                                  {item.actor?.full_name ?? "Staff"}
                                </small>
                              </div>
                              <SoftBadge tone={presentation.tone}>{presentation.status}</SoftBadge>
                            </li>
                          );
                        })}
                      </ol>
                    )}
                  </section>
                  {noteSection()}
                  {callbackSection()}
                </TabsContent>
                <TabsContent value="notes">{noteSection()}</TabsContent>
                <TabsContent value="callbacks">{callbackSection()}</TabsContent>
                <TabsContent value="raw">
                  <section className="attendee-section attendee-source-data">
                    <h3>Source data</h3>
                    <div className="attendee-extra-meta">
                      <AttendanceBadge value={booking.status.actual_attendance} />
                      <OriginBadge origin={booking.data_origin} />
                      {booking.meeting_url && (
                        <Button asChild size="sm" variant="ghost">
                          <a href={booking.meeting_url} target="_blank" rel="noreferrer">
                            <Link2 /> Meeting link
                          </a>
                        </Button>
                      )}
                    </div>

                    <p>Read-only registration data from the source spreadsheet.</p>
                    <dl>
                      {raw.length === 0 ? (
                        <div>No source payload stored.</div>
                      ) : (
                        raw.map(([key, value]) => (
                          <div key={key}>
                            <dt>{key}</dt>
                            <dd>{String(value ?? "") || "—"}</dd>
                          </div>
                        ))
                      )}
                    </dl>
                    <p>
                      Last contacted {formatShort(booking.status.last_contacted_at)} · Booking key{" "}
                      <span>{booking.booking_key}</span>
                    </p>
                  </section>
                </TabsContent>
              </Tabs>
            </div>
            <NoteDialog
              key={`note-${booking.id}`}
              open={noteOpen}
              onOpenChange={setNoteOpen}
              ref={refFor(booking)}
              attendeeName={name}
            />
            <CallbackDialog
              key={`callback-${booking.id}`}
              open={callbackOpen}
              onOpenChange={setCallbackOpen}
              ref={refFor(booking)}
              attendeeName={name}
            />
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}
