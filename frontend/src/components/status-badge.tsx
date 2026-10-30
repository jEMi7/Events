import { cn } from "@/lib/utils";
import {
  ATTENDANCE_LABELS,
  ATTENDANCE_TONE,
  INTENT_LABELS,
  INTENT_TONE,
  toneClasses,
} from "@/lib/domain";
import type { ActualAttendance, AttendanceIntent } from "@/lib/domain";

const base =
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap";

export function IntentBadge({
  value,
  className,
  showDot = false,
}: {
  value: AttendanceIntent;
  className?: string;
  showDot?: boolean;
}) {
  const tone = INTENT_TONE[value];
  return (
    <span className={cn(base, toneClasses[tone], className)}>
      {showDot ? (
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 rounded-full bg-current",
            tone === "neutral" && "opacity-60",
          )}
        />
      ) : null}
      {INTENT_LABELS[value]}
    </span>
  );
}

export function AttendanceBadge({
  value,
  className,
}: {
  value: ActualAttendance;
  className?: string;
}) {
  return (
    <span className={cn(base, toneClasses[ATTENDANCE_TONE[value]], className)}>
      {ATTENDANCE_LABELS[value]}
    </span>
  );
}

export function SoftBadge({
  children,
  tone = "lavender",
  className,
}: {
  children: React.ReactNode;
  tone?: keyof typeof toneClasses;
  className?: string;
}) {
  return <span className={cn(base, toneClasses[tone], className)}>{children}</span>;
}

export function OriginBadge({ origin }: { origin: string }) {
  if (origin === "demo") return <SoftBadge tone="warning">Demo data</SoftBadge>;
  return <SoftBadge tone="lavender">Imported</SoftBadge>;
}
