import { create } from "zustand";
import type { FieldType } from "@/lib/types";

interface EditorState {
  selectedTool: FieldType;
  selectedRecipientId: string | null;
  selectedFieldId: string | null;
  zoom: number;
  setSelectedTool: (tool: FieldType) => void;
  setSelectedRecipientId: (recipientId: string | null) => void;
  setSelectedFieldId: (fieldId: string | null) => void;
  setZoom: (zoom: number) => void;
}

export const useDocumentEditorStore = create<EditorState>((set) => ({
  selectedTool: "signature",
  selectedRecipientId: null,
  selectedFieldId: null,
  zoom: 1,
  setSelectedTool: (selectedTool) => set({ selectedTool }),
  setSelectedRecipientId: (selectedRecipientId) => set({ selectedRecipientId }),
  setSelectedFieldId: (selectedFieldId) => set({ selectedFieldId }),
  setZoom: (zoom) => set({ zoom: Math.min(1.75, Math.max(0.75, zoom)) })
}));

