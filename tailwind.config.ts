import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-mulish)", "system-ui", "sans-serif"],
        mono: ["var(--font-plex)", "monospace"],
      },
      colors: {
        kw: {
          bg: "var(--kw-bg)",
          surface: "var(--kw-surface)",
          ink: "var(--kw-ink)",
          muted: "var(--kw-muted)",
          line: "var(--kw-line)",
          accent: "var(--kw-accent)",
          soft: "var(--kw-accent-soft)",
          danger: "var(--kw-danger)",
        },
      },
    },
  },
  plugins: [],
};
export default config;
