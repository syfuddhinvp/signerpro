"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BarChart3,
  Calendar,
  Check,
  CreditCard,
  Files,
  RefreshCw,
  Search,
  Shield,
  Sparkles,
  UserCheck,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Toast } from "@/components/ui/Toast";
import { apiFetch } from "@/lib/api";
import { requireToken } from "@/lib/auth";
import type { SaaSMetrics, SaaSOrganization, SaaSUser } from "@/lib/types";

export default function SaaSAdminPage() {
  const [metrics, setMetrics] = useState<SaaSMetrics | null>(null);
  const [organizations, setOrganizations] = useState<SaaSOrganization[]>([]);
  const [users, setUsers] = useState<SaaSUser[]>([]);
  
  const [orgSearch, setOrgSearch] = useState("");
  const [userSearch, setUserSearch] = useState("");
  const [activeTab, setActiveTab] = useState<"organizations" | "users">("organizations");
  
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Modal State for Subscription Editing
  const [editingOrg, setEditingOrg] = useState<SaaSOrganization | null>(null);
  const [editTier, setEditTier] = useState("free");
  const [editStatus, setEditStatus] = useState("active");
  const [editExpires, setEditExpires] = useState("");
  const [submittingOrg, setSubmittingOrg] = useState(false);

  // Modal State for User Role Editing
  const [editingUser, setEditingUser] = useState<SaaSUser | null>(null);
  const [editRole, setEditRole] = useState("sender");
  const [submittingUser, setSubmittingUser] = useState(false);

  useEffect(() => {
    requireToken();
    loadAllData();
  }, []);

  async function loadAllData() {
    setLoading(true);
    try {
      const [metricsData, orgsData, usersData] = await Promise.all([
        apiFetch<SaaSMetrics>("/api/saas/metrics"),
        apiFetch<SaaSOrganization[]>("/api/saas/organizations"),
        apiFetch<SaaSUser[]>("/api/saas/users"),
      ]);
      setMetrics(metricsData);
      setOrganizations(orgsData);
      setUsers(usersData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load SaaS admin data.");
    } finally {
      setLoading(false);
    }
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const [metricsData, orgsData, usersData] = await Promise.all([
        apiFetch<SaaSMetrics>("/api/saas/metrics"),
        apiFetch<SaaSOrganization[]>("/api/saas/organizations"),
        apiFetch<SaaSUser[]>("/api/saas/users"),
      ]);
      setMetrics(metricsData);
      setOrganizations(orgsData);
      setUsers(usersData);
      setSuccess("Dashboard data refreshed successfully!");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed.");
    } finally {
      setRefreshing(false);
    }
  }

  // Filter lists
  const filteredOrgs = useMemo(() => {
    return organizations.filter(
      (org) =>
        org.name.toLowerCase().includes(orgSearch.toLowerCase()) ||
        org.subscription_tier.toLowerCase().includes(orgSearch.toLowerCase())
    );
  }, [organizations, orgSearch]);

  const filteredUsers = useMemo(() => {
    return users.filter(
      (user) =>
        user.name.toLowerCase().includes(userSearch.toLowerCase()) ||
        user.email.toLowerCase().includes(userSearch.toLowerCase()) ||
        user.organization_name.toLowerCase().includes(userSearch.toLowerCase())
    );
  }, [users, userSearch]);

  // Open Edit Subscription Modal
  function openEditOrg(org: SaaSOrganization) {
    setEditingOrg(org);
    setEditTier(org.subscription_tier);
    setEditStatus(org.subscription_status);
    
    if (org.subscription_expires_at) {
      // Format YYYY-MM-DD
      const date = new Date(org.subscription_expires_at);
      const yyyy = date.getFullYear();
      const mm = String(date.getMonth() + 1).padStart(2, "0");
      const dd = String(date.getDate()).padStart(2, "0");
      setEditExpires(`${yyyy}-${mm}-${dd}`);
    } else {
      setEditExpires("");
    }
  }

  // Save Subscription Plan
  async function handleSaveSubscription(e: React.FormEvent) {
    e.preventDefault();
    if (!editingOrg) return;
    setSubmittingOrg(true);
    setError(null);
    
    try {
      const formattedExpires = editExpires ? new Date(editExpires).toISOString() : null;
      const updated = await apiFetch<SaaSOrganization>(`/api/saas/organizations/${editingOrg.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          subscription_tier: editTier,
          subscription_status: editStatus,
          subscription_expires_at: formattedExpires,
        }),
      });

      // Update state local list
      setOrganizations((prev) => prev.map((org) => (org.id === updated.id ? updated : org)));
      setSuccess(`Subscription for ${updated.name} updated successfully!`);
      setEditingOrg(null);
      
      // Reload metrics to show correct plan metrics
      const newMetrics = await apiFetch<SaaSMetrics>("/api/saas/metrics");
      setMetrics(newMetrics);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update subscription.");
    } finally {
      setSubmittingOrg(false);
    }
  }

  // Open Edit User Role Modal
  function openEditUser(user: SaaSUser) {
    setEditingUser(user);
    setEditRole(user.role);
  }

  // Save User Role
  async function handleSaveUserRole(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUser) return;
    setSubmittingUser(true);
    setError(null);

    try {
      const updated = await apiFetch<SaaSUser>(`/api/saas/users/${editingUser.id}/role`, {
        method: "PATCH",
        body: JSON.stringify({
          role: editRole,
        }),
      });

      setUsers((prev) => prev.map((user) => (user.id === updated.id ? updated : user)));
      setSuccess(`User role for ${updated.name} updated successfully!`);
      setEditingUser(null);

      // Reload metrics
      const newMetrics = await apiFetch<SaaSMetrics>("/api/saas/metrics");
      setMetrics(newMetrics);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update user role.");
    } finally {
      setSubmittingUser(false);
    }
  }

  // Auto-clear success and error alerts
  useEffect(() => {
    if (success) {
      const timer = setTimeout(() => setSuccess(null), 3500);
      return () => clearTimeout(timer);
    }
  }, [success]);

  useEffect(() => {
    if (error) {
      const timer = setTimeout(() => setError(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [error]);

  const activeRate = useMemo(() => {
    if (!metrics || metrics.total_organizations === 0) return 0;
    return Math.round((metrics.active_subscriptions / metrics.total_organizations) * 100);
  }, [metrics]);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-800">
      <Toast message={error} tone="error" />
      <Toast message={success} tone="success" />

      {/* Header Section */}
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-md sticky top-0 z-10 shadow-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-3">
            <Button variant="ghost" asChild className="p-2 h-auto text-slate-500 hover:text-slate-900">
              <Link href="/dashboard">
                <ArrowLeft className="h-5 w-5" />
              </Link>
            </Button>
            <div className="border-l border-slate-200 pl-3">
              <h1 className="text-xl font-bold bg-gradient-to-r from-indigo-600 via-purple-600 to-indigo-800 bg-clip-text text-transparent flex items-center gap-1.5">
                <Shield className="h-5 w-5 text-indigo-600" /> SaaS Admin Control
              </h1>
              <p className="text-xs text-slate-500 hidden sm:block">Global Multi-Tenant Hub</p>
            </div>
          </div>

          <Button
            variant="secondary"
            onClick={handleRefresh}
            loading={refreshing}
            className="flex items-center gap-1.5 hover:bg-slate-50"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            Refresh Control
          </Button>
        </div>
      </header>

      <section className="mx-auto max-w-7xl px-6 py-8">
        {loading ? (
          <div className="flex h-[60vh] flex-col items-center justify-center gap-3">
            <RefreshCw className="h-10 w-10 animate-spin text-indigo-600" />
            <p className="text-sm font-semibold text-slate-500">Retrieving system-wide analytics...</p>
          </div>
        ) : (
          <>
            {/* KPI Cards Grid */}
            <div className="mb-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              {/* Card 1 */}
              <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md">
                <div className="absolute right-0 top-0 h-24 w-24 translate-x-4 -translate-y-4 rounded-full bg-indigo-50/50" />
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600">
                    <CreditCard className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Tenants</p>
                    <h3 className="text-3xl font-black text-slate-800 mt-1">{metrics?.total_organizations}</h3>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-1.5 text-xs text-emerald-600 font-medium">
                  <span className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                  Live multi-tenant nodes
                </div>
              </div>

              {/* Card 2 */}
              <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md">
                <div className="absolute right-0 top-0 h-24 w-24 translate-x-4 -translate-y-4 rounded-full bg-purple-50/50" />
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-50 text-purple-600">
                    <Users className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Global Users</p>
                    <h3 className="text-3xl font-black text-slate-800 mt-1">{metrics?.total_users}</h3>
                  </div>
                </div>
                <div className="mt-4 flex items-center gap-1 text-xs text-purple-600 font-semibold">
                  <Sparkles className="h-3 w-3" />
                  {Math.round((metrics?.total_users || 0) / (metrics?.total_organizations || 1))} avg users / tenant
                </div>
              </div>

              {/* Card 3 */}
              <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md">
                <div className="absolute right-0 top-0 h-24 w-24 translate-x-4 -translate-y-4 rounded-full bg-blue-50/50" />
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 text-blue-600">
                    <Files className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Total Documents</p>
                    <h3 className="text-3xl font-black text-slate-800 mt-1">{metrics?.total_documents}</h3>
                  </div>
                </div>
                <div className="mt-4 text-xs text-slate-500 font-medium">
                  Across all active tenants
                </div>
              </div>

              {/* Card 4 */}
              <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:shadow-md">
                <div className="absolute right-0 top-0 h-24 w-24 translate-x-4 -translate-y-4 rounded-full bg-emerald-50/50" />
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
                    <BarChart3 className="h-6 w-6" />
                  </div>
                  <div>
                    <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Active Rate</p>
                    <h3 className="text-3xl font-black text-slate-800 mt-1">{activeRate}%</h3>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-teal-500 transition-all duration-500"
                      style={{ width: `${activeRate}%` }}
                    />
                  </div>
                </div>
              </div>
            </div>

            {/* Plan Distribution Graphics */}
            <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
              <h3 className="text-md font-bold text-slate-800 mb-4 flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-indigo-600 animate-pulse" /> Subscription Plan Shares
              </h3>
              <div className="grid gap-6 md:grid-cols-3">
                {/* Plan Card Free */}
                <div className="rounded-xl border border-slate-100 bg-slate-50/50 p-4 transition hover:border-slate-200">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-slate-400 uppercase tracking-wide">Free Trial</span>
                    <span className="text-sm font-black text-slate-600">
                      {metrics?.tier_counts["free"] || 0} tenants
                    </span>
                  </div>
                  <div className="h-2.5 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-slate-400 transition-all"
                      style={{
                        width: `${Math.round(
                          ((metrics?.tier_counts["free"] || 0) / (metrics?.total_organizations || 1)) * 100
                        )}%`,
                      }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-500 mt-2">
                    Standard testing and onboarding tier.
                  </p>
                </div>

                {/* Plan Card Growth */}
                <div className="rounded-xl border border-blue-100 bg-blue-50/30 p-4 transition hover:border-blue-200">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-blue-600 uppercase tracking-wide">Growth Pro</span>
                    <span className="text-sm font-black text-blue-700">
                      {metrics?.tier_counts["growth"] || 0} tenants
                    </span>
                  </div>
                  <div className="h-2.5 w-full rounded-full bg-blue-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-blue-500 transition-all"
                      style={{
                        width: `${Math.round(
                          ((metrics?.tier_counts["growth"] || 0) / (metrics?.total_organizations || 1)) * 100
                        )}%`,
                      }}
                    />
                  </div>
                  <p className="text-[11px] text-blue-600/80 mt-2">
                    Core real estate and broker operations plan.
                  </p>
                </div>

                {/* Plan Card Enterprise */}
                <div className="rounded-xl border border-purple-100 bg-purple-50/30 p-4 transition hover:border-purple-200">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-xs font-bold text-purple-600 uppercase tracking-wide">Enterprise Scale</span>
                    <span className="text-sm font-black text-purple-700">
                      {metrics?.tier_counts["enterprise"] || 0} tenants
                    </span>
                  </div>
                  <div className="h-2.5 w-full rounded-full bg-purple-100 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-purple-500 transition-all"
                      style={{
                        width: `${Math.round(
                          ((metrics?.tier_counts["enterprise"] || 0) / (metrics?.total_organizations || 1)) * 100
                        )}%`,
                      }}
                    />
                  </div>
                  <p className="text-[11px] text-purple-600/80 mt-2">
                    Custom scale API and broker house systems.
                  </p>
                </div>
              </div>
            </div>

            {/* Tab Swapper */}
            <div className="mb-6 flex border-b border-slate-200">
              <button
                className={`py-3 px-6 font-semibold text-sm border-b-2 transition flex items-center gap-1.5 ${
                  activeTab === "organizations"
                    ? "border-indigo-600 text-indigo-600"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
                onClick={() => setActiveTab("organizations")}
              >
                🏢 Tenants & Subscriptions
              </button>
              <button
                className={`py-3 px-6 font-semibold text-sm border-b-2 transition flex items-center gap-1.5 ${
                  activeTab === "users"
                    ? "border-indigo-600 text-indigo-600"
                    : "border-transparent text-slate-500 hover:text-slate-800"
                }`}
                onClick={() => setActiveTab("users")}
              >
                👥 Global User Directory
              </button>
            </div>

            {/* Organizations View */}
            {activeTab === "organizations" && (
              <div>
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div className="relative w-72">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                      className="pl-9 bg-white border-slate-200"
                      placeholder="Search tenants..."
                      value={orgSearch}
                      onChange={(e) => setOrgSearch(e.target.value)}
                    />
                  </div>
                  <p className="text-xs text-slate-500 font-semibold">
                    Showing {filteredOrgs.length} of {organizations.length} tenants
                  </p>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200 uppercase tracking-wider text-[11px]">
                        <th className="py-3 px-4">Organization Name</th>
                        <th className="py-3 px-4">Subscription Plan</th>
                        <th className="py-3 px-4">Status</th>
                        <th className="py-3 px-4">Users</th>
                        <th className="py-3 px-4">Docs</th>
                        <th className="py-3 px-4">Expires</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredOrgs.map((org) => (
                        <tr key={org.id} className="hover:bg-slate-50/50 transition">
                          <td className="py-4 px-4 font-bold text-slate-800">{org.name}</td>
                          <td className="py-4 px-4">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold uppercase ${
                                org.subscription_tier === "enterprise"
                                  ? "bg-purple-100 text-purple-700"
                                  : org.subscription_tier === "growth"
                                  ? "bg-blue-100 text-blue-700"
                                  : "bg-slate-100 text-slate-700"
                              }`}
                            >
                              {org.subscription_tier}
                            </span>
                          </td>
                          <td className="py-4 px-4">
                            <span
                              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold ${
                                org.subscription_status === "active"
                                  ? "bg-emerald-100 text-emerald-700"
                                  : org.subscription_status === "trialing"
                                  ? "bg-indigo-100 text-indigo-700"
                                  : "bg-red-100 text-red-700"
                              }`}
                            >
                              <span
                                className={`h-1.5 w-1.5 rounded-full ${
                                  org.subscription_status === "active"
                                    ? "bg-emerald-500"
                                    : org.subscription_status === "trialing"
                                    ? "bg-indigo-500"
                                    : "bg-red-500"
                                }`}
                              />
                              {org.subscription_status}
                            </span>
                          </td>
                          <td className="py-4 px-4 font-medium text-slate-600">{org.users_count}</td>
                          <td className="py-4 px-4 font-medium text-slate-600">{org.documents_count}</td>
                          <td className="py-4 px-4 text-xs font-semibold text-slate-500">
                            {org.subscription_expires_at
                              ? new Date(org.subscription_expires_at).toLocaleDateString()
                              : "Lifetime"}
                          </td>
                          <td className="py-4 px-4 text-right">
                            <Button
                              variant="secondary"
                              className="text-xs h-8 border-slate-200 hover:bg-slate-100"
                              onClick={() => openEditOrg(org)}
                            >
                              Manage Sub
                            </Button>
                          </td>
                        </tr>
                      ))}
                      {filteredOrgs.length === 0 && (
                        <tr>
                          <td colSpan={7} className="py-6 text-center text-slate-400">
                            No tenants matched your query.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Users View */}
            {activeTab === "users" && (
              <div>
                <div className="mb-4 flex items-center justify-between gap-4">
                  <div className="relative w-72">
                    <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-slate-400" />
                    <Input
                      className="pl-9 bg-white border-slate-200"
                      placeholder="Search users by name, email, tenant..."
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                    />
                  </div>
                  <p className="text-xs text-slate-500 font-semibold">
                    Showing {filteredUsers.length} of {users.length} users
                  </p>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 font-bold border-b border-slate-200 uppercase tracking-wider text-[11px]">
                        <th className="py-3 px-4">Name</th>
                        <th className="py-3 px-4">Email Address</th>
                        <th className="py-3 px-4">Assigned Tenant</th>
                        <th className="py-3 px-4">System Role</th>
                        <th className="py-3 px-4">Registered At</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {filteredUsers.map((u) => (
                        <tr key={u.id} className="hover:bg-slate-50/50 transition">
                          <td className="py-4 px-4 font-bold text-slate-800 flex items-center gap-2">
                            <div className="flex h-7 w-7 items-center justify-center rounded-full bg-slate-100 text-slate-600 font-bold text-xs uppercase">
                              {u.name.charAt(0)}
                            </div>
                            {u.name}
                          </td>
                          <td className="py-4 px-4 text-slate-600 font-medium">{u.email}</td>
                          <td className="py-4 px-4 font-bold text-indigo-700">{u.organization_name}</td>
                          <td className="py-4 px-4">
                            <span
                              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-bold capitalize ${
                                u.role === "admin"
                                  ? "bg-purple-100 text-purple-700"
                                  : "bg-emerald-100 text-emerald-700"
                              }`}
                            >
                              {u.role}
                            </span>
                          </td>
                          <td className="py-4 px-4 text-xs font-semibold text-slate-500">
                            {new Date(u.created_at).toLocaleDateString()}
                          </td>
                          <td className="py-4 px-4 text-right">
                            <Button
                              variant="secondary"
                              className="text-xs h-8 border-slate-200 hover:bg-slate-100"
                              onClick={() => openEditUser(u)}
                            >
                              Change Role
                            </Button>
                          </td>
                        </tr>
                      ))}
                      {filteredUsers.length === 0 && (
                        <tr>
                          <td colSpan={6} className="py-6 text-center text-slate-400">
                            No users matched your query.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {/* EDIT SUBSCRIPTION DIALOG MODAL */}
      {editingOrg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="mb-4">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-1.5">
                <CreditCard className="h-5 w-5 text-indigo-600" /> Manage Subscription
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Modify billing properties for tenant: <strong className="text-slate-800">{editingOrg.name}</strong>
              </p>
            </div>
            
            <form onSubmit={handleSaveSubscription} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Subscription Tier
                </label>
                <Select
                  value={editTier}
                  onChange={(e) => setEditTier(e.target.value)}
                  className="w-full bg-white border-slate-200"
                >
                  <option value="free">Free Trial (Base)</option>
                  <option value="growth">Growth Pro (Realtors/Brokers)</option>
                  <option value="enterprise">Enterprise Scale (Broker Houses)</option>
                </Select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Status
                </label>
                <Select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  className="w-full bg-white border-slate-200"
                >
                  <option value="active">Active</option>
                  <option value="trialing">Trialing</option>
                  <option value="past_due">Past Due (Delinquent)</option>
                  <option value="canceled">Canceled</option>
                  <option value="expired">Expired</option>
                </Select>
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1">
                  <Calendar className="h-3 w-3 text-slate-400" /> Expiry Date (Optional)
                </label>
                <Input
                  type="date"
                  value={editExpires}
                  onChange={(e) => setEditExpires(e.target.value)}
                  className="w-full bg-white border-slate-200"
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setEditingOrg(null)}
                  className="hover:bg-slate-100"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  loading={submittingOrg}
                  className="bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  <Check className="h-4 w-4" /> Save Changes
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* EDIT USER ROLE DIALOG MODAL */}
      {editingUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 shadow-2xl animate-in fade-in zoom-in duration-200">
            <div className="mb-4">
              <h3 className="text-lg font-bold text-slate-900 flex items-center gap-1.5">
                <UserCheck className="h-5 w-5 text-indigo-600" /> Modify User Role
              </h3>
              <p className="text-xs text-slate-500 mt-1">
                Change system permission roles for user: <strong className="text-slate-800">{editingUser.name}</strong>
              </p>
            </div>

            <form onSubmit={handleSaveUserRole} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  System Role
                </label>
                <Select
                  value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}
                  className="w-full bg-white border-slate-200"
                >
                  <option value="sender">Sender (Create, prepare and track signature packets)</option>
                  <option value="admin">Administrator (Tenant configurations and SaaS management)</option>
                </Select>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setEditingUser(null)}
                  className="hover:bg-slate-100"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  loading={submittingUser}
                  className="bg-indigo-600 text-white hover:bg-indigo-700"
                >
                  <Check className="h-4 w-4" /> Apply Role
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
