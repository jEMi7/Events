import { useState, type ReactNode } from "react";
import {
  Check,
  MessageSquarePlus,
  PhoneMissed,
  PhoneOutgoing,
  RotateCcw,
  ThumbsDown,
  UserCheck,
  UserX,
} from "lucide-react";


import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  useAddNote,
  useScheduleCallback,
  useSetAttendance,
  useSetIntent,
  useUndoIntent,
} from "@/lib/mutations";

import { useStaffDirectory } from "@/lib/queries";
import type { BookingRecord } from "@/lib/queries";
import { cn } from "@/lib/utils";

export type BookingRef = { bookingId: string; eventId: string; personId: string };

export function refFor(booking: BookingRecord): BookingRef {
  return { bookingId: booking.id, eventId: booking.event_id, personId: booking.person_id };
}

function defaultDueAt() {
  const date = new Date(Date.now() + 24 * 60 * 60 * 1000);
  date.setMinutes(0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:00`;
}

export function CallbackDialog({
  open,
  onOpenChange,
  ref: bookingRef,
  attendeeName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ref: BookingRef;
  attendeeName: string;
}) {
  const [dueAt, setDueAt] = useState(defaultDueAt);
  const [owner, setOwner] = useState<string>("me");
  const [note, setNote] = useState("");
  const staff = useStaffDirectory();
  const schedule = useScheduleCallback();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Schedule a call back</DialogTitle>
          <DialogDescription>
            {attendeeName} will appear in the call backs queue at the time you choose.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="callback-due">Due date and time</Label>
            <Input
              id="callback-due"
              type="datetime-local"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="callback-owner">Owner</Label>
            <Select value={owner} onValueChange={setOwner}>
              <SelectTrigger id="callback-owner">
                <SelectValue placeholder="Assign to" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="me">Me</SelectItem>
                {(staff.data ?? []).map((member) => (
                  <SelectItem key={member.id} value={member.id}>
                    {member.full_name ?? member.email}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="callback-note">Note (optional)</Label>
            <Textarea
              id="callback-note"
              rows={3}
              value={note}
              placeholder="Context for whoever makes the call"
              onChange={(event) => setNote(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={schedule.isPending}
            onClick={() =>
              schedule.mutate(
                {
                  ref: bookingRef,
                  dueAt,
                  ownerId: owner === "me" ? null : owner,
                  note,
                },
                { onSuccess: () => onOpenChange(false) },
              )
            }
          >
            {schedule.isPending ? "Saving…" : "Schedule call back"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function NoteDialog({
  open,
  onOpenChange,
  ref: bookingRef,
  attendeeName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  ref: BookingRef;
  attendeeName: string;
}) {
  const [body, setBody] = useState("");
  const addNote = useAddNote();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a note</DialogTitle>
          <DialogDescription>Recorded against {attendeeName} with your name and the time.</DialogDescription>
        </DialogHeader>
        <Textarea
          rows={5}
          autoFocus
          value={body}
          placeholder="What did you discuss?"
          onChange={(event) => setBody(event.target.value)}
        />
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={addNote.isPending}
            onClick={() =>
              addNote.mutate(
                { ref: bookingRef, body },
                {
                  onSuccess: () => {
                    setBody("");
                    onOpenChange(false);
                  },
                },
              )
            }
          >
            {addNote.isPending ? "Saving…" : "Save note"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const actionButtonClass =
  "size-8 min-w-8 flex-none basis-8 rounded-lg border border-border bg-background p-0 shadow-sm";

export function QuickActions({
  booking,
  variant = "icons",
  className,
}: {
  booking: BookingRecord;
  variant?: "icons" | "buttons";
  className?: string;
}) {
  const bookingRef = refFor(booking);
  const setIntent = useSetIntent();
  const setAttendance = useSetAttendance();
  const undoIntent = useUndoIntent();
  const [callbackOpen, setCallbackOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const attendeeName = booking.person.full_name ?? booking.person.email ?? "This attendee";
  const busy = setIntent.isPending || setAttendance.isPending || undoIntent.isPending;
  const canUndo =
    booking.status.attendance_intent !== "not_contacted" ||
    booking.status.actual_attendance !== "unknown" ||
    Boolean(booking.status.callback_at) ||
    Boolean(booking.status.last_contacted_at);



  type QuickAction = {
    key: string;
    label: string;
    tooltip?: string;
    icon: ReactNode;
    run: () => void;
    active: boolean;
    disabled?: boolean;
  };

  const actions: QuickAction[] = [
    {
      key: "confirm",
      label: "Confirm",
      icon: <Check className="size-4" />,
      run: () => setIntent.mutate({ ref: bookingRef, intent: "confirmed" }),
      active: booking.status.attendance_intent === "confirmed",
    },
    {
      key: "decline",
      label: "Decline",
      icon: <ThumbsDown className="size-4" />,
      run: () => setIntent.mutate({ ref: bookingRef, intent: "declined" }),
      active: booking.status.attendance_intent === "declined",
    },
    {
      key: "no-answer",
      label: "No answer",
      icon: <PhoneMissed className="size-4" />,
      run: () => setIntent.mutate({ ref: bookingRef, intent: "no_answer" }),
      active: booking.status.attendance_intent === "no_answer",
    },
    {
      key: "call-back",
      label: "Call back",
      icon: <PhoneOutgoing className="size-4" />,
      run: () => setCallbackOpen(true),
      active: booking.status.attendance_intent === "call_back",
    },
    {
      key: "attended",
      label: "Attended",
      icon: <UserCheck className="size-4" />,
      run: () => setAttendance.mutate({ ref: bookingRef, attendance: "attended" }),
      active: booking.status.actual_attendance === "attended",
    },
    {
      key: "absent",
      label: "Absent",
      icon: <UserX className="size-4" />,
      run: () => setAttendance.mutate({ ref: bookingRef, attendance: "absent" }),
      active: booking.status.actual_attendance === "absent",
    },
    {
      key: "note",
      label: "Add note",
      icon: <MessageSquarePlus className="size-4" />,
      run: () => setNoteOpen(true),
      active: false,
    },
    {
      key: "undo",
      label: "Undo last status change",
      tooltip: canUndo ? "Undo last status change" : "No previous status",
      icon: <RotateCcw className="size-4" />,
      run: () => undoIntent.mutate({ ref: bookingRef }),
      active: false,
      disabled: !canUndo,
    },
  ];

  return (
    <>
      <div
        className={cn(
          "flex flex-row flex-nowrap items-center justify-end gap-1.5",
          variant === "buttons" && "flex-wrap justify-start gap-2",
          className,
        )}
      >
        {actions.map((action) =>
          variant === "icons" ? (
            <Tooltip key={action.key}>
              <TooltipTrigger asChild>
                <span className="inline-flex flex-none" tabIndex={action.disabled ? 0 : -1}>
                  <Button
                    type="button"
                    size="icon"
                    variant={action.active ? "secondary" : "ghost"}
                    className={cn(actionButtonClass, action.active && "lav-ring")}
                    aria-label={action.label}
                    disabled={busy || action.disabled}
                    onClick={action.run}
                  >
                    {action.icon}
                  </Button>
                </span>
              </TooltipTrigger>
              <TooltipContent>{action.tooltip ?? action.label}</TooltipContent>
            </Tooltip>
          ) : (
            <Button
              key={action.key}
              type="button"
              size="sm"
              variant={action.active ? "secondary" : "outline"}
              disabled={busy || action.disabled}
              onClick={action.run}
            >
              {action.icon}
              {action.label}
            </Button>

          ),
        )}
      </div>
      <CallbackDialog
        open={callbackOpen}
        onOpenChange={setCallbackOpen}
        ref={bookingRef}
        attendeeName={attendeeName}
      />
      <NoteDialog
        open={noteOpen}
        onOpenChange={setNoteOpen}
        ref={bookingRef}
        attendeeName={attendeeName}
      />
    </>
  );
}
