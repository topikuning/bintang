import { create } from "zustand";
import type { Attachment } from "@/types";

interface LightboxState {
  open: boolean;
  items: Attachment[];
  index: number;
  show: (items: Attachment[], index?: number) => void;
  close: () => void;
  next: () => void;
  prev: () => void;
}

export const useLightbox = create<LightboxState>((set) => ({
  open: false,
  items: [],
  index: 0,
  show: (items, index = 0) => set({ open: true, items, index }),
  close: () => set({ open: false }),
  next: () =>
    set((s) => ({ index: Math.min(s.index + 1, Math.max(0, s.items.length - 1)) })),
  prev: () => set((s) => ({ index: Math.max(s.index - 1, 0) })),
}));

export const EXTERNAL_MIME = "external/link";

export function isExternalLink(a: Attachment) {
  return a.mime_type === EXTERNAL_MIME || /^https?:\/\//.test(a.url);
}

export function isImageAttachment(a: Attachment) {
  return a.mime_type.startsWith("image/") && !isExternalLink(a);
}

export function isPdfAttachment(a: Attachment) {
  return a.mime_type === "application/pdf";
}
