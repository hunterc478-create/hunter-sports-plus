import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  darkMode: ["class"],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: { DEFAULT: "hsl(var(--primary))", foreground: "hsl(var(--primary-foreground))" },
        secondary: { DEFAULT: "hsl(var(--secondary))", foreground: "hsl(var(--secondary-foreground))" },
        muted: { DEFAULT: "hsl(var(--muted))", foreground: "hsl(var(--muted-foreground))" },
        accent: { DEFAULT: "hsl(var(--accent))", foreground: "hsl(var(--accent-foreground))" },
        destructive: { DEFAULT: "hsl(var(--destructive))", foreground: "hsl(var(--destructive-foreground))" },
        card: { DEFAULT: "hsl(var(--card))", foreground: "hsl(var(--card-foreground))" },
        // Hunter Sports Plus: dark charcoal; the brand color is a CSS variable set by the sport you're on
        // (header, active tabs, buttons); green marks good numbers; losses red. v1 token names kept for shared parts.
        obsidian: "#0E0F12",
        ink: "#F3F4F6",
        brand: { DEFAULT: "rgb(var(--brand) / <alpha-value>)", dim: "rgb(var(--brand) / 0.8)", soft: "rgb(var(--brand) / 0.15)" },
        neon: { DEFAULT: "#34D399", dim: "#10B981" },
        slate: { card: "#17191E", raised: "#1F2228", line: "#2B2F37", hover: "#252931" },
        info: "#7CB4FF",
        warn: "#FBBF24",
        loss: "#F87171",
      },
      boxShadow: { card: "0 1px 2px rgba(17,17,17,0.04), 0 1px 1px rgba(17,17,17,0.03)" },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "system-ui", "sans-serif"],
      },
      borderRadius: { lg: "var(--radius)", md: "calc(var(--radius) - 2px)", sm: "calc(var(--radius) - 4px)" },
      keyframes: {
        "accordion-down": { from: { height: "0" }, to: { height: "var(--radix-accordion-content-height)" } },
        "accordion-up": { from: { height: "var(--radix-accordion-content-height)" }, to: { height: "0" } },
      },
      animation: { "accordion-down": "accordion-down 0.2s ease-out", "accordion-up": "accordion-up 0.2s ease-out" },
    },
  },
  plugins: [animate],
};
export default config;
