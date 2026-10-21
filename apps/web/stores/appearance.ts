'use client';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { defaultPreferences, type UserPreferencesData } from '@fileforge/shared';
interface AppearanceStore {
  preferences: UserPreferencesData;
  hydrated: boolean;
  update: (value: Partial<UserPreferencesData>) => void;
  reset: () => void;
  setHydrated: () => void;
}
export const useAppearance = create<AppearanceStore>()(
  persist(
    (set) => ({
      preferences: defaultPreferences,
      hydrated: false,
      update: (value) => set((s) => ({ preferences: { ...s.preferences, ...value } })),
      reset: () => set({ preferences: defaultPreferences }),
      setHydrated: () => set({ hydrated: true }),
    }),
    {
      name: 'fileforge-appearance',
      partialize: (s) => ({ preferences: s.preferences }),
      onRehydrateStorage: () => (s) => s?.setHydrated(),
    },
  ),
);
