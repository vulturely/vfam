import type { Profile } from "../runtime/defineApp";

/**
 * Theme presets are pure CSS custom-property swaps — components only ever read
 * `var(--v-*)`, so a profile change re-themes every plugin screen with zero
 * component changes. Elders is high-contrast + large-type; kids is rounded and
 * playful; standard is the neutral default.
 */
export type ThemeVars = Record<string, string>;

export const PRESETS: Record<Profile, ThemeVars> = {
	standard: {
		"--v-font-base": "16px",
		"--v-radius": "18px",
		"--v-radius-sm": "10px",
		"--v-control-h": "40px",
		"--v-space": "8px",
		"--v-bg": "#f8f7f3",
		"--v-brand-bg": "transparent",
		"--v-brand-fg": "#8c6500",
		"--v-bg-gradient":
			"radial-gradient(ellipse at 0% 0%, rgba(255, 198, 0, 0.06) 0%, rgba(255, 198, 0, 0) 60%), linear-gradient(180deg, #f8f7f3, #fafaf8)",
		"--v-glass": "rgba(255, 255, 255, 0.88)",
		"--v-shadow": "0 2px 10px rgba(24, 44, 56, 0.06)",
		"--v-surface": "#ffffff",
		"--v-nav-surface": "rgba(255, 255, 255, 0.94)",
		"--v-nav-selected": "#e6f2fa",
		"--v-fg": "#182c38",
		"--v-muted": "#526874",
		"--v-primary": "#1a659e",
		"--v-primary-fg": "#ffffff",
		"--v-danger": "#dc2626",
		"--v-border": "rgba(45, 30, 47, 0.1)",
		"--v-ring": "rgba(26, 101, 158, 0.5)",
	},
	kids: {
		"--v-font-base": "18px",
		"--v-radius": "22px",
		"--v-radius-sm": "14px",
		"--v-control-h": "52px",
		"--v-space": "8px",
		"--v-bg": "#fff7ed",
		"--v-surface": "#ffffff",
		"--v-fg": "#431407",
		"--v-muted": "#9a6b3f",
		"--v-primary": "#f59e0b",
		"--v-primary-fg": "#431407",
		"--v-danger": "#e11d48",
		"--v-border": "#ffd9a8",
		"--v-ring": "rgba(245, 158, 11, 0.4)",
	},
	elders: {
		"--v-font-base": "22px",
		"--v-radius": "14px",
		"--v-radius-sm": "10px",
		"--v-control-h": "64px",
		"--v-space": "10px",
		"--v-bg": "#000000",
		"--v-surface": "#1a1a1a",
		"--v-fg": "#ffffff",
		"--v-muted": "#e6e6e6",
		"--v-primary": "#ffd60a",
		"--v-primary-fg": "#000000",
		"--v-danger": "#ff6b6b",
		"--v-border": "#ffffff",
		"--v-ring": "rgba(255, 214, 10, 0.5)",
	},
};
