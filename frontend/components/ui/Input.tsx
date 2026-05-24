"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "h-9 w-full rounded-md border border-border bg-white px-3 text-sm outline-none transition placeholder:text-mutedForeground focus:border-primary focus:ring-2 focus:ring-primary/15",
        className
      )}
      {...props}
    />
  );
}

export function PasswordInput({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = React.useState(false);
  return (
    <div className="relative">
      <input
        type={show ? "text" : "password"}
        className={cn(
          "h-9 w-full rounded-md border border-border bg-white pl-3 pr-10 text-sm outline-none transition placeholder:text-mutedForeground focus:border-primary focus:ring-2 focus:ring-primary/15",
          className
        )}
        {...props}
      />
      <button
        type="button"
        onClick={() => setShow(!show)}
        className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 transition"
      >
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "min-h-24 w-full rounded-md border border-border bg-white px-3 py-2 text-sm outline-none transition placeholder:text-mutedForeground focus:border-primary focus:ring-2 focus:ring-primary/15",
        className
      )}
      {...props}
    />
  );
}

