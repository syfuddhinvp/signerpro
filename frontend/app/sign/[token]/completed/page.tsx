"use client";

import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/Button";

export const dynamic = "force-dynamic";

export default function SigningCompletedPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <section className="w-full max-w-md rounded-md border border-border bg-white p-6 text-center shadow-panel">
        <CheckCircle2 className="mx-auto mb-4 h-10 w-10 text-emerald-600" />
        <h1 className="text-2xl font-semibold">Signing complete</h1>
        <p className="mt-2 text-sm text-mutedForeground">Your completed document has been submitted to SignFlow CRM.</p>
        <Button asChild className="mt-6">
          <Link href="/login">Return to SignFlow CRM</Link>
        </Button>
      </section>
    </main>
  );
}

