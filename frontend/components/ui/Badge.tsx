import { cn } from "@/lib/utils";

const tones = {
  neutral: "bg-muted text-mutedForeground",
  teal: "bg-primary/10 text-primary",
  amber: "bg-accent/15 text-amber-800",
  red: "bg-red-100 text-red-700",
  green: "bg-emerald-100 text-emerald-700"
};

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: keyof typeof tones }) {
  return <span className={cn("inline-flex rounded-full px-2 py-0.5 text-xs font-medium", tones[tone])}>{children}</span>;
}

