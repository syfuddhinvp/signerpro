import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./stores/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        border: "hsl(210 18% 86%)",
        background: "hsl(42 18% 98%)",
        foreground: "hsl(218 24% 13%)",
        primary: "hsl(174 68% 28%)",
        primaryForeground: "hsl(0 0% 100%)",
        accent: "hsl(31 92% 52%)",
        muted: "hsl(210 20% 96%)",
        mutedForeground: "hsl(215 14% 42%)",
        destructive: "hsl(0 72% 48%)"
      },
      boxShadow: {
        panel: "0 1px 2px rgb(15 23 42 / 0.08)"
      }
    }
  },
  plugins: []
};

export default config;

