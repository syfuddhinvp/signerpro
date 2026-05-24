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

export default function RegisterPage() {
  const router = useRouter();
  const [organizationName, setOrganizationName] = useState("");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const response = await apiFetch<AuthResponse>("/api/auth/register", {
        method: "POST",
        auth: false,
        body: JSON.stringify({
          organization_name: organizationName,
          name,
          email,
          password
        })
      });
      setAuthToken(response.access_token);
      router.push("/dashboard");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Toast message={error} tone="error" />
      <form onSubmit={submit} className="w-full max-w-md rounded-md border border-border bg-white p-6 shadow-panel">
        <div className="mb-6">
          <h1 className="text-2xl font-semibold">Create SignFlow CRM</h1>
          <p className="mt-1 text-sm text-mutedForeground">Set up your brokerage, team, or lending workspace.</p>
        </div>
        <label className="mb-4 block text-sm font-medium">
          Organization
          <Input className="mt-1" value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} required />
        </label>
        <label className="mb-4 block text-sm font-medium">
          Name
          <Input className="mt-1" value={name} onChange={(event) => setName(event.target.value)} required />
        </label>
        <label className="mb-4 block text-sm font-medium">
          Email
          <Input className="mt-1" type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label className="mb-5 block text-sm font-medium">
          Password
          <PasswordInput className="mt-1" minLength={8} value={password} onChange={(event) => setPassword(event.target.value)} required />
        </label>
        <Button className="w-full" type="submit" loading={loading}>
          Register
        </Button>
        <p className="mt-4 text-center text-sm text-mutedForeground">
          Already registered?{" "}
          <Link href="/login" className="font-medium text-primary">
            Sign in
          </Link>
        </p>
      </form>
    </main>
  );
}

