'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
export const useWorkspace = create<{ id: string; setId: (id: string) => void }>()(
  persist((set) => ({ id: '', setId: (id) => set({ id }) }), { name: 'fileforge-workspace' }),
);
