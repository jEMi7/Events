import { cn } from "@/lib/utils";
import { ChevronRight } from "lucide-react";

export function KpiCard({
  label,
  value,
  hint,
  icon,
  tone = "plain",
  className,
  accent,
  decoration,
}: {
  label: string;
  value: string | number;
  hint?: string | undefined;
  icon?: React.ReactNode;
  tone?: "plain" | "wash" | undefined;
  className?: string | undefined;
  accent?: "purple" | "green" | "rose" | "orange" | "blue";
  decoration?: React.ReactNode;
}) {
  return (
    <div
      data-accent={accent}
      className={cn(
        "kpi-card surface p-5 transition-shadow hover:shadow-pop",
        tone === "wash" && "lav-wash",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <p className="kpi-label text-xs font-medium uppercase tracking-[0.1em] text-muted-foreground">
          {label}
        </p>
        {icon ? (
          <span className="kpi-icon flex size-8 items-center justify-center rounded-lg bg-lav-100 text-primary">
            {icon}
          </span>
        ) : null}
      </div>
      <p className="kpi-value mt-3 font-display text-3xl font-semibold tracking-tight text-foreground">
        {value}
      </p>
      {hint ? <p className="kpi-hint mt-1.5 text-xs text-muted-foreground">{hint}</p> : null}
      {decoration ? (
        <>
          <span className="kpi-chevron" aria-hidden="true">
            <ChevronRight />
          </span>
          <span className="kpi-decoration" aria-hidden="true">
            {decoration}
          </span>
        </>
      ) : null}
    </div>
  );
}

export function MiniStat({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string | number;
  icon?: React.ReactNode;
  accent?: "purple" | "green" | "orange" | "rose";
}) {
  return (
    <div
      data-accent={accent}
      className="mini-stat rounded-lg border border-border bg-card px-3 py-2.5"
    >
      {icon ? (
        <span className="mini-stat-icon" aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <p className="mini-stat-label text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
        {label}
      </p>
      <p className="mini-stat-value mt-0.5 text-lg font-semibold text-foreground">{value}</p>
    </div>
  );
}
