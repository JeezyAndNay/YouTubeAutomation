type Status = "idle" | "running" | "awaiting_review" | "done" | "error" | "rejected";

const styles: Record<Status, string> = {
  idle:            "text-weathered-stone bg-deep-teal",
  running:         "text-cosmic-teal    bg-cosmic-teal/10",
  awaiting_review: "text-portal-gold    bg-portal-gold/10",
  done:            "text-portal-gold    bg-portal-gold/15",
  error:           "text-bone-white     bg-deep-crimson/70",
  rejected:        "text-bone-white     bg-deep-crimson/50",
};

const labels: Record<Status, string> = {
  idle:            "Idle",
  running:         "Running",
  awaiting_review: "Awaiting Review",
  done:            "Done",
  error:           "Error",
  rejected:        "Rejected",
};

export default function StatusPill({ status }: { status: Status }) {
  return (
    <span className={`inline-block px-2 py-0.5 rounded text-[11px] font-medium tracking-wide uppercase ${styles[status]}`}>
      {labels[status]}
    </span>
  );
}
