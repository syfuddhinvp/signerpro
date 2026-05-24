"use client";

import { ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { requiredFieldCompleted } from "@/lib/validators";
import type { FieldRecord, SigningSession } from "@/lib/types";

export function RequiredFieldsNavigator({ session }: { session: SigningSession }) {
  const fields = session.fields.filter((field) => field.recipient_id === session.current_recipient_id && field.required);
  const completed = fields.filter(requiredFieldCompleted).length;

  function nextRequired() {
    const field = fields.find((candidate) => !requiredFieldCompleted(candidate));
    if (!field) return;
    document.querySelector(`[data-field-id="${field.id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  return (
    <div className="flex items-center gap-3 rounded-md border border-border bg-white px-3 py-2 text-sm shadow-panel">
      <span className="font-medium">
        {completed} of {fields.length} required fields completed
      </span>
      <Button type="button" variant="secondary" className="h-8" onClick={nextRequired} disabled={completed === fields.length}>
        <ArrowDown className="h-4 w-4" />
        Next required
      </Button>
    </div>
  );
}

