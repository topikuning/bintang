import { create } from "zustand"

interface LightboxImage {
  src: string
  alt?: string
}

interface LightboxState {
  open: boolean
  images: LightboxImage[]
  index: number
  show: (images: LightboxImage[], startIndex?: number) => void
  close: () => void
  next: () => void
  prev: () => void
}

export const useLightbox = create<LightboxState>((set, get) => ({
  open: false,
  images: [],
  index: 0,
  show: (images, startIndex = 0) =>
    set({ open: true, images, index: Math.max(0, Math.min(startIndex, images.length - 1)) }),
  close: () => set({ open: false }),
  next: () =>
    set({ index: (get().index + 1) % Math.max(1, get().images.length) }),
  prev: () =>
    set({
      index:
        (get().index - 1 + get().images.length) % Math.max(1, get().images.length),
    }),
}))
