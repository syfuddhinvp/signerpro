"use client";

import { useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

export function SignatureModal({
  open,
  signerName,
  onClose,
  onSave
}: {
  open: boolean;
  signerName: string;
  onClose: () => void;
  onSave: (payload: { signature_type: "typed" | "drawn"; signature_text?: string; signature_image_base64?: string }) => Promise<void>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [mode, setMode] = useState<"typed" | "drawn">("typed");
  const [signatureText, setSignatureText] = useState(signerName);
  const [drawing, setDrawing] = useState(false);
  const [saving, setSaving] = useState(false);

  if (!open) return null;

  function point(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const bounds = canvas.getBoundingClientRect();
    return {
      x: event.clientX - bounds.left,
      y: event.clientY - bounds.top
    };
  }

  function beginDraw(event: React.PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    const next = point(event);
    if (!ctx || !next) return;
    setDrawing(true);
    ctx.strokeStyle = "#111827";
    ctx.lineWidth = 2;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(next.x, next.y);
  }

  function draw(event: React.PointerEvent<HTMLCanvasElement>) {
    if (!drawing) return;
    const ctx = canvasRef.current?.getContext("2d");
    const next = point(event);
    if (!ctx || !next) return;
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
  }

  async function save() {
    setSaving(true);
    try {
      if (mode === "typed") {
        await onSave({ signature_type: "typed", signature_text: signatureText });
      } else {
        const image = canvasRef.current?.toDataURL("image/png");
        await onSave({ signature_type: "drawn", signature_text: signatureText || signerName, signature_image_base64: image });
      }
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4">
      <div className="w-full max-w-lg rounded-md border border-border bg-white p-5 shadow-panel">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Signature</h2>
          <div className="flex rounded-md border border-border p-1">
            <button
              type="button"
              className={`rounded px-3 py-1 text-sm ${mode === "typed" ? "bg-primary text-white" : ""}`}
              onClick={() => setMode("typed")}
            >
              Typed
            </button>
            <button
              type="button"
              className={`rounded px-3 py-1 text-sm ${mode === "drawn" ? "bg-primary text-white" : ""}`}
              onClick={() => setMode("drawn")}
            >
              Drawn
            </button>
          </div>
        </div>
        {mode === "typed" ? (
          <Input value={signatureText} onChange={(event) => setSignatureText(event.target.value)} />
        ) : (
          <canvas
            ref={canvasRef}
            width={560}
            height={180}
            className="h-44 w-full rounded-md border border-border bg-white"
            onPointerDown={beginDraw}
            onPointerMove={draw}
            onPointerUp={() => setDrawing(false)}
            onPointerLeave={() => setDrawing(false)}
          />
        )}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={save} loading={saving}>
            Apply
          </Button>
        </div>
      </div>
    </div>
  );
}

