"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "secondary" | "ghost" | "danger";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  loading?: boolean;
  asChild?: boolean;
}

const variants: Record<Variant, string> = {
  primary: "bg-primary text-primaryForeground hover:bg-primary/90",
  secondary: "border border-border bg-white text-foreground hover:bg-muted",
  ghost: "text-foreground hover:bg-muted",
  danger: "bg-destructive text-white hover:bg-destructive/90"
};

export function Button({ className, variant = "primary", loading, children, disabled, asChild, ...props }: ButtonProps) {
  const classes = cn(
    "inline-flex h-9 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium shadow-sm transition disabled:cursor-not-allowed disabled:opacity-55",
    variants[variant],
    className
  );
  if (asChild && React.isValidElement<{ className?: string }>(children)) {
    return React.cloneElement(children, {
      className: cn(classes, children.props.className)
    });
  }
  return (
    <button
      className={classes}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : null}
      {children}
    </button>
  );
}
