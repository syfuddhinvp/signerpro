"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CheckCircle2, ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Toast } from "@/components/ui/Toast";
import { RequiredFieldsNavigator } from "@/components/signer/RequiredFieldsNavigator";
import { SigningPdfViewer } from "@/components/signer/SigningPdfViewer";
import { apiFetch } from "@/lib/api";
import { requiredFieldCompleted } from "@/lib/validators";
import type { FieldRecord, RecipientRecord, SigningSession } from "@/lib/types";

export default function SignerPage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const [session, setSession] = useState<SigningSession | null>(null);
  const [fields, setFields] = useState<FieldRecord[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [finishing, setFinishing] = useState(false);

  // OTP and Consent Workflow States
  const [otpSent, setOtpSent] = useState(false);
  const [otpCode, setOtpCode] = useState("");
  const [otpVerifying, setOtpVerifying] = useState(false);
  const [otpSending, setOtpSending] = useState(false);

  async function handleSendOtp() {
    setOtpSending(true);
    setError(null);
    try {
      await apiFetch(`/api/sign/${params.token}/otp/send`, { method: "POST", auth: false });
      setOtpSent(true);
      setSuccess("Verification code sent successfully.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to send verification code");
    } finally {
      setOtpSending(false);
    }
  }

  async function handleVerifyOtp() {
    if (!otpCode.trim()) return;
    setOtpVerifying(true);
    setError(null);
    try {
      const loaded = await apiFetch<SigningSession>(`/api/sign/${params.token}/otp/verify`, {
        method: "POST",
        auth: false,
        body: JSON.stringify({ code: otpCode })
      });
      setSession(loaded);
      setFields(loaded.fields);
      setSuccess("Identity verified.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invalid code. Please try again.");
    } finally {
      setOtpVerifying(false);
    }
  }

  async function handleAcceptConsent() {
    setError(null);
    try {
      const loaded = await apiFetch<SigningSession>(`/api/sign/${params.token}/consent`, {
        method: "POST",
        auth: false
      });
      setSession(loaded);
      setFields(loaded.fields);
      setSuccess("Disclosure accepted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not accept disclosure");
    }
  }

  async function load() {
    const loaded = await apiFetch<SigningSession>(`/api/sign/${params.token}`, { auth: false });
    setSession(loaded);
    setFields(loaded.fields);
  }

  useEffect(() => {
    setLoading(true);
    apiFetch<SigningSession>(`/api/sign/${params.token}/viewed`, { method: "POST", auth: false })
      .then((loaded) => {
        setSession(loaded);
        setFields(loaded.fields);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "Signing link could not be opened"))
      .finally(() => setLoading(false));
  }, [params.token]);

  const currentSession = useMemo(() => {
    if (!session) return null;
    return { ...session, fields };
  }, [session, fields]);

  const recipients = useMemo<RecipientRecord[]>(() => {
    if (!session) return [];
    return [
      {
        id: session.current_recipient_id,
        document_id: "public",
        name: session.recipient.name,
        email: session.recipient.email,
        role_name: session.recipient.role_name,
        signing_order: 1,
        status: session.recipient.status,
        viewed_at: null,
        completed_at: null,
        declined_at: null,
        decline_reason: null,
        created_at: "",
        updated_at: ""
      }
    ];
  }, [session]);

  async function saveValue(field: FieldRecord, value: string | boolean) {
    setError(null);
    try {
      const updated = await apiFetch<FieldRecord>(`/api/sign/${params.token}/fields/${field.id}/value`, {
        method: "POST",
        auth: false,
        body: JSON.stringify({ value })
      });
      setFields((current) => current.map((item) => (item.id === updated.id ? updated : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save field");
      await load();
    }
  }

  async function saveSignature(
    field: FieldRecord,
    payload: { signature_type: "typed" | "drawn"; signature_text?: string; signature_image_base64?: string }
  ) {
    setError(null);
    try {
      const updated = await apiFetch<FieldRecord>(`/api/sign/${params.token}/fields/${field.id}/signature`, {
        method: "POST",
        auth: false,
        body: JSON.stringify(payload)
      });
      setFields((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setSuccess("Signature saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not save signature");
      await load();
    }
  }

  async function complete() {
    if (!currentSession) return;
    const incomplete = fields.filter((field) => field.recipient_id === currentSession.current_recipient_id && !requiredFieldCompleted(field));
    if (incomplete.length) {
      setError(`Complete required field: ${incomplete[0].label}`);
      document.querySelector(`[data-field-id="${incomplete[0].id}"]`)?.scrollIntoView({ behavior: "smooth", block: "center" });
      return;
    }
    setFinishing(true);
    setError(null);
    try {
      await apiFetch(`/api/sign/${params.token}/complete`, { method: "POST", auth: false });
      router.push(`/sign/${params.token}/completed`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not finish signing");
    } finally {
      setFinishing(false);
    }
  }

  async function decline() {
    const reason = window.prompt("Decline reason");
    if (!reason) return;
    try {
      await apiFetch(`/api/sign/${params.token}/decline`, {
        method: "POST",
        auth: false,
        body: JSON.stringify({ reason })
      });
      setSuccess("Document declined.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not decline document");
    }
  }

  if (loading) return <main className="p-6 text-sm">Loading signing session...</main>;
  if (!currentSession) return <main className="p-6 text-sm text-red-700">{error ?? "Signing session unavailable."}</main>;

  // Render OTP Identity Verification Screen
  if (currentSession.otp_required) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Toast message={error} tone="error" />
        <Toast message={success} tone="success" />
        <div className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-100 p-8">
          <div className="text-center mb-6">
            <div className="inline-flex items-center justify-center w-14 h-14 bg-indigo-50 text-indigo-600 rounded-full mb-4">
              <ShieldOff className="w-6 h-6" />
            </div>
            <h2 className="text-2xl font-bold text-slate-800">Identity Verification</h2>
            <p className="text-sm text-slate-500 mt-2">
              A security verification code is required to access and sign this document.
            </p>
          </div>

          {!otpSent ? (
            <div className="space-y-4">
              <div className="bg-slate-50 p-4 rounded-xl border border-slate-100 text-xs text-slate-600 space-y-1">
                <p><strong>Signer:</strong> {currentSession.recipient.name}</p>
                <p><strong>Email:</strong> {currentSession.recipient.email}</p>
              </div>
              <Button
                type="button"
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl py-3"
                onClick={handleSendOtp}
                loading={otpSending}
              >
                Send Verification Code
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider block">
                  Enter 6-Digit Code
                </label>
                <input
                  type="text"
                  maxLength={6}
                  placeholder="000000"
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ""))}
                  className="w-full border border-slate-200 rounded-xl px-4 py-3 text-center text-lg font-bold tracking-widest focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>
              <div className="flex gap-3">
                <Button
                  type="button"
                  variant="secondary"
                  className="flex-1 rounded-xl py-3"
                  onClick={handleSendOtp}
                  disabled={otpSending}
                >
                  Resend Code
                </Button>
                <Button
                  type="button"
                  className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl py-3"
                  onClick={handleVerifyOtp}
                  loading={otpVerifying}
                  disabled={otpCode.length < 4}
                >
                  Verify Code
                </Button>
              </div>
            </div>
          )}
        </div>
      </main>
    );
  }

  // Render ESIGN Consent Confirmation Screen
  if (currentSession.consent_required) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <Toast message={error} tone="error" />
        <Toast message={success} tone="success" />
        <div className="w-full max-w-2xl bg-white rounded-2xl shadow-xl border border-slate-100 p-8">
          <div className="text-center mb-6">
            <h2 className="text-2xl font-bold text-slate-800">Electronic Record & Signature Disclosure</h2>
            <p className="text-sm text-slate-500 mt-2">
              Please review and accept the electronic record and signature disclosure to continue.
            </p>
          </div>

          <div className="border border-slate-200 rounded-xl p-4 bg-slate-50 h-64 overflow-y-auto text-xs text-slate-600 leading-relaxed mb-6 space-y-3">
            <p className="font-bold text-slate-700">CONSUMER DISCLOSURE AND ESIGN ACT CONSENT</p>
            <p>
              By checking the box below and clicking "Accept and Continue", you agree and consent to use electronic records, communications, and signatures in connection with this transaction.
            </p>
            <p>
              <strong>1. Scope of Consent:</strong> Your consent covers all documents, contracts, disclosures, and communications provided during this signing session.
            </p>
            <p>
              <strong>2. Paper Copies:</strong> You have the right to receive paper copies of any electronic records. If you wish to receive a paper copy, you can download and print the signed PDF document upon completion or contact the sender.
            </p>
            <p>
              <strong>3. Hardware/Software Requirements:</strong> To access and retain electronic records, you need a device with internet access and a modern web browser capable of viewing PDF files.
            </p>
            <p>
              <strong>4. Tamper Detection & Security:</strong> Once completed, all electronic records are digitally hashed and locked to prevent modification. IP addresses, device user agents, and timestamps are logged as part of the immutable compliance audit trail.
            </p>
          </div>

          <div className="space-y-4">
            <label className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-1 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                id="consent-check"
              />
              <span className="text-xs text-slate-600 leading-normal">
                I agree to use electronic records and signatures, and acknowledge that electronic signatures carry the same legal weight as hand-written signatures under UETA and the federal ESIGN Act.
              </span>
            </label>

            <Button
              type="button"
              className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl py-3"
              onClick={() => {
                const checked = (document.getElementById("consent-check") as HTMLInputElement)?.checked;
                if (!checked) {
                  setError("You must accept the disclosure to proceed.");
                  return;
                }
                handleAcceptConsent();
              }}
            >
              Accept and Continue
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-muted">
      <Toast message={error} tone="error" />
      <Toast message={success} tone="success" />
      <header className="sticky top-0 z-30 border-b border-border bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div>
            <h1 className="text-lg font-semibold">{currentSession.document.title}</h1>
            <p className="text-sm text-mutedForeground">
              {currentSession.recipient.name} · {currentSession.recipient.email}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <RequiredFieldsNavigator session={currentSession} />
            <Button type="button" variant="secondary" onClick={decline} disabled={currentSession.read_only}>
              <ShieldOff className="h-4 w-4" />
              Decline
            </Button>
            <Button type="button" onClick={complete} loading={finishing} disabled={currentSession.read_only}>
              <CheckCircle2 className="h-4 w-4" />
              Finish signing
            </Button>
          </div>
        </div>
      </header>
      <section className="px-6 py-6">
        <SigningPdfViewer
          session={currentSession}
          fields={fields}
          recipients={recipients}
          onSaveValue={saveValue}
          onSaveSignature={saveSignature}
        />
      </section>
    </main>
  );
}

