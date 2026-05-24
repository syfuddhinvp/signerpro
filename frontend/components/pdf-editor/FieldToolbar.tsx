"use client";

import { CalendarDays, CheckSquare, PenLine, Type, UserRound } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import type { FieldType } from "@/lib/types";

const tools: Array<{ type: FieldType; label: string; icon: React.ComponentType<{ className?: string }> }> = [
  { type: "signature", label: "Signature", icon: PenLine },
  { type: "full_name", label: "Full Name", icon: UserRound },
  { type: "date", label: "Date", icon: CalendarDays },
  { type: "text", label: "Text", icon: Type },
  { type: "checkbox", label: "Checkbox", icon: CheckSquare }
];

export function FieldToolbar({ selectedTool, onSelect }: { selectedTool: FieldType; onSelect: (type: FieldType) => void }) {
  return (
    <div className="space-y-2">
      {tools.map((tool) => {
        const Icon = tool.icon;
        return (
          <Button
            key={tool.type}
            type="button"
            variant={selectedTool === tool.type ? "primary" : "secondary"}
            className={cn("w-full justify-start")}
            draggable
            onDragStart={(event) => event.dataTransfer.setData("application/signflow-field", tool.type)}
            onClick={() => onSelect(tool.type)}
            title={tool.label}
          >
            <Icon className="h-4 w-4" />
            {tool.label}
          </Button>
        );
      })}
    </div>
  );
}

