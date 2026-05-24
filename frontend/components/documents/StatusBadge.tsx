import { Badge } from "@/components/ui/Badge";
import type { DocumentStatus, RecipientStatus } from "@/lib/types";

const labels: Record<DocumentStatus | RecipientStatus, string> = {
  draft: "Draft",
  prepared: "Prepared",
  sent: "Sent",
  viewed: "Viewed",
  partially_completed: "Partly complete",
  completed: "Completed",
  declined: "Declined",
  expired: "Expired",
  voided: "Voided",
  waiting: "Waiting"
};

export function StatusBadge({ status }: { status: DocumentStatus | RecipientStatus }) {
  const tone =
    status === "completed"
      ? "green"
      : status === "declined" || status === "expired" || status === "voided"
        ? "red"
        : status === "sent" || status === "viewed" || status === "partially_completed"
          ? "amber"
          : status === "prepared"
            ? "teal"
            : "neutral";
  return <Badge tone={tone}>{labels[status]}</Badge>;
}

