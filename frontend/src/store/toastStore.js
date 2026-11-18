import { create } from 'zustand';

let nextId = 1;

const useToastStore = create((set) => ({
  toasts: [],
  show(message, { tone = 'info', ms = 3500 } = {}) {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, message, tone }] }));
    setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), ms);
  },
}));

export const toast = (message, opts) => useToastStore.getState().show(message, opts);

export default useToastStore;
