"use client";

import Link from "next/link";
import { Plus, Search, LogOut } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Toast } from "@/components/ui/Toast";
import { DocumentTable } from "@/components/documents/DocumentTable";
import { apiFetch } from "@/lib/api";
import { requireToken, clearAuthToken } from "@/lib/auth";
import type { DocumentRecord, DocumentStatus, User } from "@/lib/types";

const statuses: Array<DocumentStatus | "all"> = [
  "all",
  "draft",
  "prepared",
  "sent",
  "viewed",
  "partially_completed",
  "completed",
  "declined",
  "voided"
];

export default function DashboardPage() {
  const [documents, setDocuments] = useState<DocumentRecord[]>([]);
  const [status, setStatus] = useState<DocumentStatus | "all">("all");
  const [activeTab, setActiveTab] = useState<"documents" | "templates">("documents");
  const [search, setSearch] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    requireToken();
    // Fetch logged in user profile
    apiFetch<User>("/api/auth/me")
      .then(setUser)
      .catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    if (activeTab === "templates") {
      apiFetch<DocumentRecord[]>("/api/documents/templates/all")
        .then(setDocuments)
        .catch((err) => setError(err instanceof Error ? err.message : "Could not load templates"))
        .finally(() => setLoading(false));
    } else {
      const query = status === "all" ? "" : `?status=${status}`;
      apiFetch<DocumentRecord[]>(`/api/documents${query}`)
        .then(setDocuments)
        .catch((err) => setError(err instanceof Error ? err.message : "Could not load documents"))
        .finally(() => setLoading(false));
    }
  }, [activeTab, status]);

  const filtered = useMemo(() => {
    return documents.filter((document) => document.title.toLowerCase().includes(search.toLowerCase()));
  }, [documents, search]);

  function handleLogout() {
    clearAuthToken();
    window.location.href = "/login";
  }

  return (
    <main className="min-h-screen bg-slate-50">
      <Toast message={error} tone="error" />
      <header className="border-b border-slate-200 bg-white shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-bold text-slate-800">SignFlow CRM</h1>
            {user && (
              <div className="hidden items-center gap-2 border-l border-slate-200 pl-4 md:flex">
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-50 text-indigo-700 font-bold text-sm">
                  {user.name.charAt(0).toUpperCase()}
                </div>
                <div className="text-left">
                  <p className="text-xs font-semibold text-slate-800">{user.name}</p>
                  <p className="text-[10px] text-slate-500 capitalize">{user.role}</p>
                </div>
              </div>
            )}
          </div>
          
          <div className="flex items-center gap-3">
            {user?.role === "admin" && (
              <Button variant="secondary" asChild className="border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 hover:text-indigo-800">
                <Link href="/dashboard/admin">
                  Admin Panel
                </Link>
              </Button>
            )}
            <Button asChild className="bg-indigo-600 text-white hover:bg-indigo-700">
              <Link href="/documents/new">
                <Plus className="h-4 w-4" />
                New document
              </Link>
            </Button>
            <Button 
              variant="ghost" 
              onClick={handleLogout} 
              className="text-slate-500 hover:text-slate-800 hover:bg-slate-50 flex items-center gap-1.5"
            >
              <LogOut className="h-4 w-4" />
              <span className="hidden sm:inline">Logout</span>
            </Button>
          </div>
        </div>
      </header>
      
      <section className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 border-b border-slate-200">
          <div className="flex gap-6">
            <button
              onClick={() => setActiveTab("documents")}
              className={`pb-3 text-sm font-semibold border-b-2 transition-all ${
                activeTab === "documents"
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              My Documents
            </button>
            <button
              onClick={() => setActiveTab("templates")}
              className={`pb-3 text-sm font-semibold border-b-2 transition-all ${
                activeTab === "templates"
                  ? "border-indigo-600 text-indigo-600"
                  : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              Reusable Templates
            </button>
          </div>
        </div>

        <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-slate-900">
              {activeTab === "templates" ? "Reusable Templates" : "Documents"}
            </h2>
            <p className="text-sm text-slate-500">
              {activeTab === "templates"
                ? "Configure document packets once, drag and drop signature zones, and reuse them instantly for new signers."
                : "Contracts, disclosures, buyer forms, seller forms, and mortgage packets."}
            </p>
          </div>
          <div className="flex gap-2">
            <div className="relative w-64">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" aria-hidden />
              <Input className="pl-9 bg-white border-slate-200" placeholder="Search documents" value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <Select className="w-48 bg-white border-slate-200" value={status} onChange={(event) => setStatus(event.target.value as DocumentStatus | "all")}>
              {statuses.map((item) => (
                <option key={item} value={item}>
                  {item === "all" ? "All statuses" : item.replaceAll("_", " ")}
                </option>
              ))}
            </Select>
          </div>
        </div>
        {loading ? (
          <div className="rounded-md border border-slate-200 bg-white p-6 text-sm text-slate-500">Loading documents...</div>
        ) : (
          <DocumentTable documents={filtered} />
        )}
      </section>
    </main>
  );
}
