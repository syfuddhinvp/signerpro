import type { Config } from "tailwindcss";

/**
 * Tailwind REFERENCES the CSS custom properties defined in app/tokens.css.
 * It must never own a literal color value — tokens.css is the source of truth.
 */
const hsl = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

const config: Config = {
  darkMode: ["class", '[data-theme="dark"]'],
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
    "./stores/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        // --- legacy aliases, now variable-backed ---
        border: hsl("color-border-subtle"),
        background: hsl("color-bg-canvas"),
        foreground: hsl("color-fg-default"),
        primary: hsl("color-accent-solid"),
        "primary-foreground": hsl("color-accent-on-solid"),
        accent: hsl("color-highlight-solid"),
        muted: hsl("color-bg-muted"),
        mutedForeground: hsl("color-fg-muted"),
        "muted-foreground": hsl("color-fg-muted"),
        destructive: hsl("color-bg-danger-solid"),

        // --- semantic layer ---
        canvas: hsl("color-bg-canvas"),
        surface: {
          DEFAULT: hsl("color-bg-surface"),
          raised: hsl("color-bg-surface-raised"),
          subtle: hsl("color-bg-subtle"),
          inverse: hsl("color-bg-inverse"),
          overlay: hsl("color-bg-overlay")
        },
        fg: {
          DEFAULT: hsl("color-fg-default"),
          muted: hsl("color-fg-muted"),
          subtle: hsl("color-fg-subtle"),
          "on-solid": hsl("color-fg-on-solid"),
          inverse: hsl("color-fg-inverse"),
          danger: hsl("color-fg-danger"),
          success: hsl("color-fg-success"),
          warning: hsl("color-fg-warning"),
          info: hsl("color-fg-info"),
          accent: hsl("color-accent-fg"),
          highlight: hsl("color-highlight-fg")
        },
        line: {
          subtle: hsl("color-border-subtle"),
          DEFAULT: hsl("color-border-default"),
          strong: hsl("color-border-strong"),
          danger: hsl("color-border-danger"),
          success: hsl("color-border-success"),
          warning: hsl("color-border-warning"),
          info: hsl("color-border-info"),
          accent: hsl("color-accent-border")
        },
        brand: {
          solid: hsl("color-accent-solid"),
          "solid-hover": hsl("color-accent-solid-hover"),
          "solid-active": hsl("color-accent-solid-active"),
          subtle: hsl("color-accent-subtle"),
          muted: hsl("color-accent-muted"),
          fg: hsl("color-accent-fg"),
          "on-solid": hsl("color-accent-on-solid")
        },
        highlight: {
          solid: hsl("color-highlight-solid"),
          "solid-hover": hsl("color-highlight-solid-hover"),
          subtle: hsl("color-highlight-subtle"),
          fg: hsl("color-highlight-fg"),
          border: hsl("color-highlight-border")
        },
        danger: {
          solid: hsl("color-bg-danger-solid"),
          "solid-hover": hsl("color-bg-danger-solid-hover"),
          subtle: hsl("color-bg-danger-subtle"),
          fg: hsl("color-fg-danger"),
          "on-solid": hsl("color-fg-on-danger"),
          border: hsl("color-border-danger")
        },
        success: {
          solid: hsl("color-bg-success-solid"),
          subtle: hsl("color-bg-success-subtle"),
          fg: hsl("color-fg-success"),
          border: hsl("color-border-success")
        },
        warning: {
          solid: hsl("color-bg-warning-solid"),
          subtle: hsl("color-bg-warning-subtle"),
          fg: hsl("color-fg-warning"),
          border: hsl("color-border-warning")
        },
        info: {
          solid: hsl("color-bg-info-solid"),
          subtle: hsl("color-bg-info-subtle"),
          fg: hsl("color-fg-info"),
          border: hsl("color-border-info")
        },
        field: {
          surface: hsl("color-field-surface"),
          ink: hsl("color-signature-ink"),
          ring: hsl("color-field-selected-ring"),
          locked: hsl("color-field-border-locked")
        },
        focus: hsl("color-focus-ring")
      },
      fontFamily: {
        sans: "var(--font-sans)",
        mono: "var(--font-mono)"
      },
      fontSize: {
        display: ["var(--text-display-size)", { lineHeight: "var(--text-display-leading)", letterSpacing: "var(--text-display-tracking)", fontWeight: "var(--text-display-weight)" }],
        "heading-1": ["var(--text-heading-1-size)", { lineHeight: "var(--text-heading-1-leading)", letterSpacing: "var(--text-heading-1-tracking)", fontWeight: "var(--text-heading-1-weight)" }],
        "heading-2": ["var(--text-heading-2-size)", { lineHeight: "var(--text-heading-2-leading)", letterSpacing: "var(--text-heading-2-tracking)", fontWeight: "var(--text-heading-2-weight)" }],
        "heading-3": ["var(--text-heading-3-size)", { lineHeight: "var(--text-heading-3-leading)", fontWeight: "var(--text-heading-3-weight)" }],
        body: ["var(--text-body-size)", { lineHeight: "var(--text-body-leading)" }],
        label: ["var(--text-label-size)", { lineHeight: "var(--text-label-leading)", letterSpacing: "var(--text-label-tracking)", fontWeight: "var(--text-label-weight)" }],
        code: ["var(--text-code-size)", { lineHeight: "var(--text-code-leading)" }]
      },
      spacing: {
        "space-1": "var(--space-1)",
        "space-2": "var(--space-2)",
        "space-3": "var(--space-3)",
        "space-4": "var(--space-4)",
        "space-5": "var(--space-5)",
        "space-6": "var(--space-6)",
        "space-7": "var(--space-7)",
        "space-8": "var(--space-8)"
      },
      borderRadius: {
        none: "var(--radius-none)",
        sm: "var(--radius-sm)",
        md: "var(--radius-md)",
        lg: "var(--radius-lg)",
        full: "var(--radius-full)"
      },
      boxShadow: {
        panel: "var(--shadow-1)",
        "elevation-1": "var(--shadow-1)",
        "elevation-2": "var(--shadow-2)",
        "elevation-3": "var(--shadow-3)",
        "elevation-4": "var(--shadow-4)",
        focus: "var(--focus-ring)"
      },
      transitionDuration: {
        instant: "var(--duration-instant)",
        fast: "var(--duration-fast)",
        normal: "var(--duration-normal)",
        slow: "var(--duration-slow)"
      },
      transitionTimingFunction: {
        standard: "var(--ease-standard)",
        "ease-out-token": "var(--ease-out)",
        "ease-in-token": "var(--ease-in)",
        emphasized: "var(--ease-emphasized)"
      },
      zIndex: {
        base: "var(--z-base)",
        "pdf-page": "var(--z-pdf-page)",
        "field-overlay": "var(--z-field-overlay)",
        "field-selected": "var(--z-field-selected)",
        "sticky-header": "var(--z-sticky-header)",
        panel: "var(--z-panel)",
        dropdown: "var(--z-dropdown)",
        overlay: "var(--z-overlay)",
        modal: "var(--z-modal)",
        toast: "var(--z-toast)",
        tooltip: "var(--z-tooltip)"
      }
    }
  },
  plugins: []
};

export default config;
