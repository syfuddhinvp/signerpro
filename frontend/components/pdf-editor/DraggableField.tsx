"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

export interface ScreenRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function DraggableField({
  rect,
  label,
  color,
  selected,
  locked,
  onSelect,
  onCommit
}: {
  rect: ScreenRect;
  label: string;
  color: string;
  selected: boolean;
  locked?: boolean;
  onSelect: () => void;
  onCommit: (rect: ScreenRect) => void;
}) {
  const startRef = useRef<{ pointerX: number; pointerY: number; rect: ScreenRect; mode: "move" | "resize" } | null>(null);
  const latestRef = useRef(rect);
  const [liveRect, setLiveRect] = useState(rect);

  useEffect(() => {
    setLiveRect(rect);
    latestRef.current = rect;
  }, [rect]);

  function begin(event: React.PointerEvent, mode: "move" | "resize") {
    if (locked) return;
    event.preventDefault();
    event.stopPropagation();
    onSelect();
    startRef.current = { pointerX: event.clientX, pointerY: event.clientY, rect, mode };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
  }

  function move(event: PointerEvent) {
    const start = startRef.current;
    if (!start) return;
    const dx = event.clientX - start.pointerX;
    const dy = event.clientY - start.pointerY;
    if (start.mode === "resize") {
      latestRef.current = {
        ...start.rect,
        width: Math.max(18, start.rect.width + dx),
        height: Math.max(18, start.rect.height + dy)
      };
    } else {
      latestRef.current = {
        ...start.rect,
        x: Math.max(0, start.rect.x + dx),
        y: Math.max(0, start.rect.y + dy)
      };
    }
    setLiveRect(latestRef.current);
  }

  function end() {
    onCommit(latestRef.current);
    startRef.current = null;
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", end);
  }

  return (
    <div
      className={cn(
        "absolute flex cursor-move items-center overflow-hidden rounded border-2 bg-white/90 px-2 text-xs font-medium shadow-sm",
        selected ? "ring-2 ring-accent" : "",
        locked ? "cursor-not-allowed opacity-60" : ""
      )}
      style={{
        left: liveRect.x,
        top: liveRect.y,
        width: liveRect.width,
        height: liveRect.height,
        borderColor: color,
        color
      }}
      onPointerDown={(event) => begin(event, "move")}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      title={label}
    >
      <span className="truncate">{label}</span>
      {!locked ? (
        <span
          className="absolute bottom-0 right-0 h-3 w-3 cursor-nwse-resize border-l border-t bg-white"
          style={{ borderColor: color }}
          onPointerDown={(event) => begin(event, "resize")}
        />
      ) : null}
    </div>
  );
}
