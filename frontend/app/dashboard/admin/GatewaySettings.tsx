"use client";

import { KeyRound, Mail, Smartphone } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input, PasswordInput } from "@/components/ui/Input";
import { Toast } from "@/components/ui/Toast";
import { apiFetch } from "@/lib/api";

interface OrgSettings {
  name: string;
  smtp_host?: string;
  smtp_port?: number;
  smtp_username?: string;
  smtp_password?: string;
  smtp_from_email?: string;
  sms_provider?: "twilio" | "telnyx";
  twilio_account_sid?: string;
  twilio_auth_token?: string;
  twilio_from_number?: string;
  telnyx_api_key?: string;
  telnyx_from_number?: string;
}

export function GatewaySettings() {
  const [settings, setSettings] = useState<OrgSettings>({
    name: "",
    sms_provider: "twilio"
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Field edit states (so we don't accidentally wipe secrets on patch)
  const [smtpPassword, setSmtpPassword] = useState("");
  const [twilioToken, setTwilioToken] = useState("");
  const [telnyxKey, setTelnyxKey] = useState("");

  useEffect(() => {
    setLoading(true);
    apiFetch<OrgSettings>("/api/organizations/me")
      .then((data) => {
        setSettings(data);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Failed to load gateway configurations"))
      .finally(() => setLoading(false));
  }, []);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    const payload: OrgSettings = {
      name: settings.name,
      smtp_host: settings.smtp_host || "",
      smtp_port: settings.smtp_port ? Number(settings.smtp_port) : undefined,
      smtp_username: settings.smtp_username || "",
      smtp_from_email: settings.smtp_from_email || "",
      sms_provider: settings.sms_provider || "twilio",
      twilio_account_sid: settings.twilio_account_sid || "",
      twilio_from_number: settings.twilio_from_number || "",
      telnyx_from_number: settings.telnyx_from_number || ""
    };

    if (smtpPassword.trim()) {
      payload.smtp_password = smtpPassword;
    }
    if (twilioToken.trim()) {
      payload.twilio_auth_token = twilioToken;
    }
    if (telnyxKey.trim()) {
      payload.telnyx_api_key = telnyxKey;
    }

    try {
      const updated = await apiFetch<OrgSettings>("/api/organizations/me", {
        method: "PATCH",
        body: JSON.stringify(payload)
      });
      setSettings(updated);
      setSuccess("Gateway configurations saved successfully.");
      setSmtpPassword("");
      setTwilioToken("");
      setTelnyxKey("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update configurations");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-slate-500">Loading configurations...</p>
      </div>
    );
  }

  return (
    <div className="pb-12">
      <Toast message={error} tone="error" />
      <Toast message={success} tone="success" />

      <div className="mb-6">
        <h2 className="text-2xl font-bold text-slate-800">Gateway Configurations</h2>
        <p className="text-sm text-slate-500 mt-1">
          Configure custom SMTP email servers and SMS providers (Twilio / Telnyx) for your organization.
        </p>
      </div>

      <form onSubmit={handleSave} className="space-y-8">
        {/* SMTP Email Server settings */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-6">
          <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
            <div className="p-2 bg-indigo-50 text-indigo-600 rounded-lg">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800">Custom SMTP Email Server</h3>
              <p className="text-xs text-slate-500">Enable custom branded outgoing email deliveries.</p>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-600 uppercase block">SMTP Host</label>
              <Input
                placeholder="smtp.mailgun.org"
                value={settings.smtp_host || ""}
                onChange={(e) => setSettings({ ...settings, smtp_host: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-600 uppercase block">SMTP Port</label>
              <Input
                type="number"
                placeholder="587"
                value={settings.smtp_port || ""}
                onChange={(e) => setSettings({ ...settings, smtp_port: Number(e.target.value) })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-600 uppercase block">From Address</label>
              <Input
                type="email"
                placeholder="signatures@yourcompany.com"
                value={settings.smtp_from_email || ""}
                onChange={(e) => setSettings({ ...settings, smtp_from_email: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-600 uppercase block">SMTP Username</label>
              <Input
                placeholder="postmaster@yourdomain.com"
                value={settings.smtp_username || ""}
                onChange={(e) => setSettings({ ...settings, smtp_username: e.target.value })}
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-600 uppercase block">SMTP Password</label>
              <PasswordInput
                placeholder={settings.smtp_username ? "•••••••••••• (Leave blank to keep current)" : "Password"}
                value={smtpPassword}
                onChange={(e) => setSmtpPassword(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* SMS settings */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-sm p-6 space-y-6">
          <div className="flex items-center gap-3 border-b border-slate-100 pb-4">
            <div className="p-2 bg-emerald-50 text-emerald-600 rounded-lg">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-800">SMS / OTP Verification Gateways</h3>
              <p className="text-xs text-slate-500">Configure security challenges using Twilio or Telnyx APIs.</p>
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-xs font-semibold text-slate-600 uppercase block">Active Gateway Provider</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 flex-1">
                <input
                  type="radio"
                  name="sms_provider"
                  checked={settings.sms_provider === "twilio"}
                  onChange={() => setSettings({ ...settings, sms_provider: "twilio" })}
                  className="h-4 w-4 text-indigo-600"
                />
                <div>
                  <span className="text-sm font-semibold block text-slate-800">Twilio SMS</span>
                  <span className="text-xs text-slate-500">Standard global SMS capabilities</span>
                </div>
              </label>

              <label className="flex items-center gap-2 cursor-pointer bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 flex-1">
                <input
                  type="radio"
                  name="sms_provider"
                  checked={settings.sms_provider === "telnyx"}
                  onChange={() => setSettings({ ...settings, sms_provider: "telnyx" })}
                  className="h-4 w-4 text-indigo-600"
                />
                <div>
                  <span className="text-sm font-semibold block text-slate-800">Telnyx SMS</span>
                  <span className="text-xs text-slate-500">High-volume developer SMS</span>
                </div>
              </label>
            </div>
          </div>

          {settings.sms_provider === "twilio" ? (
            <div className="space-y-4 border border-indigo-50 bg-indigo-50/20 p-4 rounded-xl">
              <div className="flex items-center gap-2 text-indigo-600 font-semibold text-sm">
                <KeyRound className="w-4 h-4" /> Twilio Credentials
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600 uppercase block">Account SID</label>
                  <Input
                    placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxx"
                    value={settings.twilio_account_sid || ""}
                    onChange={(e) => setSettings({ ...settings, twilio_account_sid: e.target.value })}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600 uppercase block">Auth Token</label>
                  <PasswordInput
                    placeholder={settings.twilio_account_sid ? "•••••••••••• (Leave blank to keep current)" : "Auth Token"}
                    value={twilioToken}
                    onChange={(e) => setTwilioToken(e.target.value)}
                  />
                </div>
              </div>
              <div className="w-full md:w-1/2 space-y-1">
                <label className="text-xs font-semibold text-slate-600 uppercase block">From Phone Number</label>
                <Input
                  placeholder="+1555XXXXXXX"
                  value={settings.twilio_from_number || ""}
                  onChange={(e) => setSettings({ ...settings, twilio_from_number: e.target.value })}
                />
              </div>
            </div>
          ) : (
            <div className="space-y-4 border border-emerald-50 bg-emerald-50/20 p-4 rounded-xl">
              <div className="flex items-center gap-2 text-emerald-600 font-semibold text-sm">
                <KeyRound className="w-4 h-4" /> Telnyx Credentials
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600 uppercase block">Telnyx API Key</label>
                  <PasswordInput
                    placeholder={settings.telnyx_from_number ? "•••••••••••• (Leave blank to keep current)" : "Telnyx Key"}
                    value={telnyxKey}
                    onChange={(e) => setTelnyxKey(e.target.value)}
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-slate-600 uppercase block">From Number / SID</label>
                  <Input
                    placeholder="+1555XXXXXXX"
                    value={settings.telnyx_from_number || ""}
                    onChange={(e) => setSettings({ ...settings, telnyx_from_number: e.target.value })}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3">
          <Button type="submit" loading={saving} className="bg-indigo-600 text-white hover:bg-indigo-700">
            Save Gateway Settings
          </Button>
        </div>
      </form>
    </div>
  );
}
