import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-card",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2}>
        <rect x="3" y="4.5" width="18" height="16" rx="4" />
        <path d="M8 3v3M16 3v3M3 9.5h18" />
        <path d="M8.75 14.5l2.25 2.25 4-4.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </span>
  );
}

export function Wordmark({
  className,
  subtitle = true,
}: {
  className?: string;
  subtitle?: boolean;
}) {
  return (
    <span className={cn("flex items-center gap-3", className)}>
      <BrandMark />
      <span className="flex flex-col leading-none">
        <span className="font-display text-[15px] font-semibold tracking-tight text-foreground">
          Event Registrations Hub
        </span>
        {subtitle ? (
          <span className="mt-1 text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
            Confirmation operations
          </span>
        ) : null}
      </span>
    </span>
  );
}
