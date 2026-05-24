import { useEffect, useRef } from "react";
import { toast } from "sonner";

export { toast };

export function Toast({ message, tone = "neutral" }: { message: string | null; tone?: "neutral" | "success" | "error" }) {
  const lastMessageRef = useRef<string | null>(null);

  useEffect(() => {
    if (message && message !== lastMessageRef.current) {
      if (tone === "success") {
        toast.success(message);
      } else if (tone === "error") {
        toast.error(message);
      } else {
        toast(message);
      }
      lastMessageRef.current = message;
    } else if (!message) {
      lastMessageRef.current = null;
    }
  }, [message, tone]);

  return null;
}

