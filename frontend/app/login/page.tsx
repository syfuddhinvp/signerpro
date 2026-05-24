"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, PasswordInput } from "@/components/ui/Input";
import { Toast } from "@/components/ui/Toast";
import { apiFetch } from "@/lib/api";
import { setAuthToken } from "@/lib/auth";
import type { AuthResponse } from "@/lib/types";

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch<AuthResponse>("/api/auth/login", {
        method: "POST",
        auth: false,
        body: JSON.stringify({ email, password })
      });
      setAuthToken(response.access_token);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Toast message={error} tone="error" />
      <form onSubmit={submit} className="w-full max-w-sm rounded-md border border-border bg-white p-6 shadow-panel">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">SignFlow CRM</h1>
          <p className="mt-1 text-sm text-mutedForeground">Sign in to manage real estate document packets.</p>
        </div>
        <label className="mb-4 block text-sm font-medium">
          Email
          <Input className="mt-1" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label className="mb-5 block text-sm font-medium">
          Password
          <PasswordInput className="mt-1" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label>
        <Button className="w-full" type="submit" loading={loading}>
          Sign in
        </Button>
        <p className="mt-4 text-center text-sm text-mutedForeground">
          New workspace?{" "}
          <Link href="/register" className="font-medium text-primary">
            Register
          </Link>
        </p>
      </form>
    </main>
  );
}

