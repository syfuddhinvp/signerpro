'use client';

/* SignForge — ACCOUNT AREA.
 *
 * Every panel below reads the signed-in user's real account state. Nothing on
 * this screen is invented: where an endpoint exists it is called, and where one
 * does not the panel says so rather than showing a plausible-looking fiction.
 * That rule matters most for the two security surfaces here — the account audit
 * log and the authenticated-device list — which are read by someone checking
 * whether their account has been compromised. */

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSF } from '@/lib/sf/state';
import { credentialToJson, passkeysSupported, toCreationOptions } from '@/lib/sf/webauthn';
import { useSession } from '@/components/sf/SessionProvider';
import { useDialogs } from '@/components/sf/DialogProvider';
import type { AccountSection } from '@/lib/sf/routes';
import { accountHref } from '@/lib/sf/navigation';
import { ACCOUNT_TITLES } from '@/lib/sf/data';
import { apiCall } from '@/lib/api/browser';
import { account as accountApi, auth as authApi, organizations as organizationsApi, teams as teamsApi } from '@/lib/api/resources';
import type {
  AccountAuditFeed, CloudTargetItem, CurrentUserResponse, IntegrationResponse,
  MfaEnrollResponse, MfaStatusResponse, NotificationPreferenceResponse, PasskeyResponse,
  OrganizationResponse, SavedSignatureResponse, SessionResponse,
  TeamResponse,
} from '@/lib/api/types';
import { btn, pill, inputStyle, lbl as lblStyle, railHead, TONE_GOOD, TONE_INDIGO, TONE_MUTED, BORDER_STRONG } from '@/lib/sf/ui';

const card: CSSProperties = { background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', padding:'18px', display:'flex', flexDirection:'column', gap:'13px' };
const emptyBox: CSSProperties = { border:'1px dashed #8492a6', borderRadius:'12px', padding:'18px', textAlign:'center', fontSize:'.75rem', color:'#64748b', lineHeight:1.6 };

/** `2026-08-28T09:12:04Z` → `28 Aug 2026, 09:12`. Never invents a value. */
function stamp(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-GB', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

/** Join only the parts the server actually returned. */
function joinMeta(parts: (string | null | undefined)[]): string {
  const kept = parts.map(p => (p ?? '').trim()).filter(p => p.length > 0);
  return kept.length ? kept.join(' · ') : 'no further detail recorded';
}

function sessionLabel(row: SessionResponse): string {
  const name = joinMeta([row.browser, row.os, row.device]);
  return name === 'no further detail recorded' ? 'Unidentified client' : name;
}

export default function AccountArea({ section }: { section: AccountSection }) {
  const { flash, accent, initials } = useSF();
  const router = useRouter();
  const session = useSession();

  const A = accent();
  const { askText } = useDialogs();

  const primaryBtn = btn(A, '#fff', A);
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');
  const autoGhostBtn: CSSProperties = { ...btn('#fff', '#475569', '#e3e7ee'), marginLeft:'auto', flex:'0 0 auto' };
  const autoDangerBtn: CSSProperties = { ...btn('#fff', '#b91c1c', '#fecaca'), marginLeft:'auto', flex:'0 0 auto' };
  const mono: CSSProperties = { ...inputStyle, fontFamily:"'Inter', 'Google Sans Flex', sans-serif", fontSize:'.71875rem' };

  /* ── server state ─────────────────────────────────────────────────────── */
  const [me, setMe] = useState<CurrentUserResponse | null>(null);
  const [signatures, setSignatures] = useState<SavedSignatureResponse[] | null>(null);
  const [sessions, setSessions] = useState<SessionResponse[] | null>(null);
  const [mfa, setMfa] = useState<MfaStatusResponse | null>(null);
  const [passkeys, setPasskeys] = useState<PasskeyResponse[] | null>(null);
  const [enrolment, setEnrolment] = useState<MfaEnrollResponse | null>(null);
  const [notifPrefsData, setNotifPrefs] = useState<NotificationPreferenceResponse[] | null>(null);
  const [integrationsData, setIntegrations] = useState<IntegrationResponse[] | null>(null);
  const [cloudData, setCloud] = useState<CloudTargetItem[] | null>(null);
  const [teamsData, setTeams] = useState<TeamResponse[] | null>(null);
  const [orgData, setOrg] = useState<OrganizationResponse | null>(null);
  const [auditData, setAudit] = useState<AccountAuditFeed | null>(null);
  /** `null` = still loading, `false` = the endpoint failed. Never silently 0. */
  const [failed, setFailed] = useState<Record<string, boolean>>({});

  const markFailed = useCallback((key: string) => {
    setFailed(prev => (prev[key] ? prev : { ...prev, [key]: true }));
  }, []);

  const loadSessions = useCallback(() => {
    void authApi.sessions(apiCall).then(res => {
      if (!res.ok) { markFailed('sessions'); setSessions([]); return; }
      setSessions(res.data);
    });
  }, [markFailed]);

  const loadPasskeys = useCallback(() => {
    void authApi.passkeys(apiCall).then(res => {
      if (!res.ok) { markFailed('passkeys'); return; }
      setPasskeys(res.data);
    });
  }, [apiCall, markFailed]);

  const loadMfa = useCallback(() => {
    void authApi.mfaStatus(apiCall).then(res => {
      if (!res.ok) { markFailed('mfa'); return; }
      setMfa(res.data);
    });
  }, [markFailed]);

  const loadCloud = useCallback(() => {
    void accountApi.cloudTargets(apiCall).then(res => {
      if (!res.ok) { markFailed('cloud'); setCloud([]); return; }
      setCloud(res.data);
    });
  }, [markFailed]);

  const loadIntegrations = useCallback(() => {
    void accountApi.integrations(apiCall).then(res => {
      if (!res.ok) { markFailed('integrations'); setIntegrations([]); return; }
      setIntegrations(res.data);
    });
  }, [markFailed]);

  const loadNotifPrefs = useCallback(() => {
    void accountApi.notificationPreferences(apiCall).then(res => {
      if (!res.ok) { markFailed('notif'); setNotifPrefs([]); return; }
      setNotifPrefs(res.data);
    });
  }, [markFailed]);

  useEffect(() => {
    void accountApi.me(apiCall).then(res => { if (res.ok) setMe(res.data); else markFailed('me'); });
  }, [markFailed]);

  useEffect(() => {
    if (section === 'profile') {
      void accountApi.signatures(apiCall).then(res => {
        if (!res.ok) { markFailed('signatures'); setSignatures([]); return; }
        setSignatures(res.data);
      });
    }
    if (section === 'security') { loadSessions(); loadMfa(); loadPasskeys(); }
    if (section === 'notifications' || section === 'email') loadNotifPrefs();
    if (section === 'integrations') loadIntegrations();
    if (section === 'cloud') loadCloud();
    if (section === 'teams') {
      void teamsApi.list(apiCall).then(res => {
        if (!res.ok) { markFailed('teams'); setTeams([]); return; }
        setTeams(res.data);
      });
    }
    if (section === 'orgs') {
      void organizationsApi.me(apiCall).then(res => { if (res.ok) setOrg(res.data); else markFailed('orgs'); });
    }
    if (section === 'audit') {
      void accountApi.auditTrail(apiCall, { limit: 50 }).then(res => {
        if (!res.ok) { markFailed('audit'); setAudit({ items: [], total: 0 }); return; }
        setAudit(res.data);
      });
    }
  }, [section, loadSessions, loadMfa, loadPasskeys, loadNotifPrefs, loadIntegrations, loadCloud, markFailed]);

  const userName = me?.name || session.name;
  const userRole = me?.role || session.role;
  const userEmail = me?.email || session.email;
  const userInitials = initials(userName);

  const manageNotifications = () => router.push(accountHref('notifications'));

  /* ── security actions ─────────────────────────────────────────────────── */

  const changePassword = async () => {
    const current = await askText({ title: 'Change password', label: 'Current password', message: 'Confirm the password you sign in with today.', password: true, cta: 'Continue', required: true });
    if (!current) return;
    const next = await askText({ title: 'Change password', label: 'New password', message: 'At least 12 characters.', password: true, cta: 'Change password', required: true });
    if (!next) return;
    void authApi.changePassword(apiCall, { current_password: current, password: next }).then(res => {
      flash(res.ok ? 'Password changed' : 'Password not changed · ' + res.error.message);
    });
  };

  const revokeSession = (row: SessionResponse) => {
    void authApi.revokeSession(apiCall, row.id).then(res => {
      if (!res.ok) { flash('Could not sign that session out · ' + res.error.message); return; }
      flash(sessionLabel(row) + ' signed out');
      loadSessions();
    });
  };

  /* The WebAuthn ceremony. Everything that can fail is reported: an
     authenticator that declines and a browser that cannot do this at all look
     identical otherwise, and a button that silently does nothing is exactly
     what the audit found everywhere. */
  const addPasskey = async () => {
    if (!passkeysSupported()) {
      flash('This browser does not support passkeys');
      return;
    }
    const label = await askText({
      title: 'Add a passkey', label: 'Name this device',
      message: 'So you can tell your passkeys apart later.', placeholder: 'Work laptop', cta: 'Continue',
    });
    const started = await authApi.passkeyRegisterBegin(apiCall);
    if (!started.ok) { flash('Could not start · ' + started.error.message); return; }

    let credential: PublicKeyCredential | null = null;
    try {
      credential = (await navigator.credentials.create({
        publicKey: toCreationOptions(started.data as never),
      })) as PublicKeyCredential | null;
    } catch {
      // NotAllowedError covers both "user declined" and "timed out", and the
      // browser deliberately does not say which.
      flash('Passkey setup was cancelled');
      return;
    }
    if (!credential) { flash('No passkey was created'); return; }

    const finished = await authApi.passkeyRegisterFinish(
      apiCall, credentialToJson(credential), label || null,
    );
    if (!finished.ok) { flash('Passkey rejected · ' + finished.error.message); return; }
    flash('Passkey added');
    loadPasskeys();
  };

  const removePasskey = (row: PasskeyResponse) => {
    void authApi.passkeyDelete(apiCall, row.id).then(res => {
      if (!res.ok) { flash('Could not remove that passkey · ' + res.error.message); return; }
      flash((row.label || 'Passkey') + ' removed');
      loadPasskeys();
    });
  };

  const beginEnrolment = () => {
    void authApi.mfaEnroll(apiCall, 'totp').then(res => {
      if (!res.ok) { flash('Could not start enrolment · ' + res.error.message); return; }
      setEnrolment(res.data);
    });
  };

  const confirmEnrolment = async () => {
    const code = await askText({ title: 'Confirm two-factor', label: 'Six-digit code', message: 'Enter the code from your authenticator app.', placeholder: '000000', cta: 'Turn on 2FA', required: true });
    if (!code) return;
    void apiCall<void>('/api/auth/mfa/enroll/confirm', { method: 'POST', body: { code } }).then(res => {
      if (!res.ok) { flash('Code rejected · ' + res.error.message); return; }
      setEnrolment(null);
      flash('Two-factor authentication is now on');
      loadMfa();
    });
  };

  const disableMfa = async () => {
    const code = await askText({ title: 'Turn off two-factor', label: 'Authenticator or recovery code', message: 'A current code is required to disable 2FA.', cta: 'Turn off 2FA', required: true });
    if (!code) return;
    void apiCall<void>('/api/auth/mfa/disable', { method: 'POST', body: { code } }).then(res => {
      if (!res.ok) { flash('Could not disable 2FA · ' + res.error.message); return; }
      flash('Two-factor authentication is off');
      loadMfa();
    });
  };

  const toggle2fa = () => { if (mfa?.enrolled) void disableMfa(); else beginEnrolment(); };

  /* ── nav / titles ─────────────────────────────────────────────────────── */

  const accountTitle = ACCOUNT_TITLES[section][0];
  const accountSub = ACCOUNT_TITLES[section][1];

  const acProfile = section === 'profile';
  const acSecurity = section === 'security';
  const acNotifications = section === 'notifications';
  const acEmail = section === 'email';
  const acIntegrations = section === 'integrations';
  const acCloud = section === 'cloud';
  const acTeams = section === 'teams';
  const acOrgs = section === 'orgs';
  const acAudit = section === 'audit';

  /* ── derived rows ─────────────────────────────────────────────────────── */

  const devices = (sessions ?? []).map(row => ({
    id: row.id,
    label: sessionLabel(row) + (row.is_current ? ' · this device' : ''),
    meta: joinMeta([
      'last seen ' + stamp(row.last_seen_at),
      row.ip_address,
      row.location,
    ]),
    isCurrent: row.is_current,
    onRemove: () => revokeSession(row),
  }));

  const notifPrefs = (notifPrefsData ?? []).map(p => ({
    key: p.event_key,
    label: p.label,
    on: p.enabled,
    onToggle: () => {
      const next = !p.enabled;
      setNotifPrefs(prev => (prev ?? []).map(x => (x.event_key === p.event_key ? { ...x, enabled: next } : x)));
      void accountApi.updateNotificationPreferences(apiCall, { prefs: { [p.event_key]: next } }).then(res => {
        if (!res.ok) { flash('Could not save that preference · ' + res.error.message); loadNotifPrefs(); return; }
        setNotifPrefs(res.data);
      });
    },
    switchStyle: { width:'34px', height:'19px', borderRadius:'99px', background: p.enabled ? '#10b981' : BORDER_STRONG, position:'relative', flex:'0 0 34px', border:'none', cursor:'pointer' } as CSSProperties,
    knob: { position:'absolute', top:'2px', left: p.enabled ? '17px' : '2px', width:'15px', height:'15px', borderRadius:'99px', background:'#fff' } as CSSProperties,
  }));

  /* The account's own extra notification recipients, as the server has them. */
  const extraRecipients = Array.from(new Set((notifPrefsData ?? []).flatMap(p => p.extra_recipients)));

  const integrations = (integrationsData ?? []).map(i => ({
    key: i.provider,
    label: i.label,
    meta: i.connected ? joinMeta(['connected ' + stamp(i.connected_at), i.detail]) : (i.detail || 'not connected'),
    ctaLabel: i.connected ? 'Disconnect' : 'Connect',
    onClick: () => {
      const call = i.connected
        ? accountApi.disconnectIntegration(apiCall, i.provider)
        : accountApi.connectIntegration(apiCall, i.provider);
      void call.then(res => {
        if (!res.ok) { flash('Could not update ' + i.label + ' · ' + res.error.message); return; }
        flash(i.label + (i.connected ? ' disconnected' : ' connected'));
        loadIntegrations();
      });
    },
    ctaStyle: i.connected ? btn('#fff', '#b91c1c', '#fecaca') : btn(A, '#fff', A),
    pill: pill(i.connected ? TONE_GOOD : TONE_MUTED),
    pillLabel: i.connected ? 'Connected' : 'Available',
  }));

  const teams = (teamsData ?? []).map(t => ({
    key: t.id,
    label: t.name,
    meta: joinMeta([
      t.member_count + (t.member_count === 1 ? ' member' : ' members'),
      t.document_count + (t.document_count === 1 ? ' document' : ' documents'),
      t.description,
    ]),
    role: t.my_role ? t.my_role : 'not a member',
    pill: pill(TONE_INDIGO),
  }));

  const cloudTargets = (cloudData ?? []).map(c => ({
    key: c.provider,
    label: c.provider,
    path: c.path || 'no export path set',
    pill: pill(c.enabled ? TONE_GOOD : TONE_MUTED),
    pillLabel: c.enabled ? 'Exporting' : 'Off',
    onToggle: () => {
      const next = (cloudData ?? []).map(x => (x.provider === c.provider ? { ...x, enabled: !x.enabled } : x));
      setCloud(next);
      void accountApi.updateCloudTargets(apiCall, next).then(res => {
        if (!res.ok) { flash('Could not save the export targets · ' + res.error.message); loadCloud(); return; }
        setCloud(res.data);
      });
    },
  }));

  const audit = (auditData?.items ?? []).map((a, i) => ({
    key: a.id,
    action: a.event_type,
    actor: userEmail,
    meta: joinMeta([a.event_message, a.document_title, a.ip_address]),
    time: stamp(a.created_at),
    rowStyle: { display:'flex', justifyContent:'space-between', gap:'14px', padding:'13px 15px', borderTop: i ? '1px solid #eef1f6' : 'none' } as CSSProperties,
    dot: { width:'9px', height:'9px', borderRadius:'99px', marginTop:'5px', flex:'0 0 9px', background: A } as CSSProperties,
    actorStyle: { fontSize:'.65625rem', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", color:'#64748b', background:'#f5f6f8', border:'1px solid #e3e7ee', borderRadius:'6px', padding:'2px 6px' } as CSSProperties,
  }));

  const defaultSignature = (signatures ?? [])[0] ?? null;

  /* Rendered as an ordinary screen inside the app shell. This used to be a
     `position: fixed` overlay with its own header, its own close button and
     its own sidebar listing the eleven sections — a second layout, and a
     second navigation system, for one branch of the same tree. The sections
     are rows in the shell's sidebar now (see `lib/sf/navigation.ts`). */
  return (
    <section data-screen-label="My account" style={{ display:'flex', minHeight:'100%' }}>
      <div style={{ flex:1, minWidth:0, padding:'24px 26px 44px' }}>
          <div style={{ maxWidth:'760px', display:'flex', flexDirection:'column', gap:'18px' }}>
            <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
              <h2 style={{ margin:0, fontSize:'1.3125rem', fontWeight:700, letterSpacing:'-.5px' }}>{accountTitle}</h2>
              <span style={{ fontSize:'.78125rem', color:'#64748b', lineHeight:1.5 }}>{accountSub}</span>
            </div>

            {acProfile ? (
              <div style={{ ...card, gap:'14px' }}>
                <div style={{ display:'flex', alignItems:'center', gap:'14px' }}>
                  <span style={{ width:'56px', height:'56px', borderRadius:'99px', background:'#0f172a', color:'#f8fafc', display:'grid', placeItems:'center', fontSize:'1.125rem', fontWeight:700, flex:'0 0 56px' }}>{userInitials}</span>
                  <div style={{ display:'flex', flexDirection:'column', gap:'3px' }}>
                    <span style={{ fontSize:'.9375rem', fontWeight:700 }}>{userName}</span>
                    <span style={{ fontSize:'.75rem', color:'#64748b' }}>{userRole}</span>
                  </div>
                </div>
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'11px' }}>
                  <label style={lblStyle}>Full name<input type="text" defaultValue={userName} key={'n' + userName} style={inputStyle} readOnly /></label>
                  <label style={lblStyle}>Email<input type="text" defaultValue={userEmail} key={'e' + userEmail} style={mono} readOnly /></label>
                  <label style={lblStyle}>Time zone<input type="text" defaultValue={me?.timezone ?? ''} key={'t' + (me?.timezone ?? '')} placeholder="not set" style={mono} readOnly /></label>
                  <label style={lblStyle}>Language<input type="text" defaultValue={me?.locale ?? ''} key={'l' + (me?.locale ?? '')} placeholder="not set" style={inputStyle} readOnly /></label>
                </div>
                <div style={{ borderTop:'1px solid #eef1f6', paddingTop:'13px', display:'flex', alignItems:'center', gap:'14px' }}>
                  <div style={{ display:'flex', flexDirection:'column', gap:'3px' }}>
                    <span style={{ fontSize:'.78125rem', fontWeight:600 }}>Default signature</span>
                    <span style={{ fontSize:'.71875rem', color:'#64748b' }}>
                      {signatures === null
                        ? 'Loading…'
                        : defaultSignature
                          ? joinMeta(['adopted ' + stamp(defaultSignature.adopted_at), defaultSignature.is_passkey_bound ? 'passkey-bound' : null])
                          : 'None adopted yet'}
                    </span>
                  </div>
                  {defaultSignature && defaultSignature.signature_text ? (
                    <span style={{ fontFamily:"'" + (defaultSignature.type_face || 'Caveat') + "', cursive", fontSize:'1.625rem', marginLeft:'auto' }}>{defaultSignature.signature_text}</span>
                  ) : null}
                </div>
              </div>
            ) : null}

            {acSecurity ? (
              <div style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
                <div style={card}>
                  <span style={railHead}>Login and security</span>
                  <div style={{ display:'flex', alignItems:'center', gap:'12px', paddingBottom:'12px', borderBottom:'1px solid #f2f4f8' }}>
                    <div style={{ display:'flex', flexDirection:'column', gap:'2px' }}><span style={{ fontSize:'.75rem', color:'#64748b' }}>Email</span><span style={{ fontSize:'.8125rem', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{userEmail}</span></div>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:'12px', paddingBottom:'12px', borderBottom:'1px solid #f2f4f8' }}>
                    <div style={{ display:'flex', flexDirection:'column', gap:'2px' }}><span style={{ fontSize:'.75rem', color:'#64748b' }}>Password</span><span style={{ fontSize:'.8125rem' }}>••••••••</span></div>
                    <button type="button" onClick={changePassword} style={autoGhostBtn}>Change</button>
                  </div>
                  <div style={{ display:'flex', alignItems:'flex-start', gap:'12px' }}>
                    <div style={{ display:'flex', flexDirection:'column', gap:'3px', maxWidth:'460px' }}>
                      <span style={{ fontSize:'.8125rem', fontWeight:600 }}>Two-factor authentication</span>
                      <span style={{ fontSize:'.71875rem', color:'#64748b', lineHeight:1.55 }}>
                        {mfa === null
                          ? (failed.mfa ? 'Enrolment status could not be loaded.' : 'Checking enrolment status…')
                          : mfa.enrolled
                            ? joinMeta([(mfa.method || 'authenticator') + ' enrolled ' + stamp(mfa.enrolled_at), mfa.recovery_codes_remaining + ' recovery codes left'])
                            : 'Not enrolled. Turn this on to require a verification code in addition to your password.'}
                      </span>
                    </div>
                    <button
                      type="button" role="switch"
                      aria-checked={mfa ? mfa.enrolled : false}
                      aria-label="Two-factor authentication"
                      disabled={mfa === null}
                      onClick={toggle2fa}
                      style={{ marginLeft:'auto', width:'38px', height:'21px', borderRadius:'99px', background: mfa?.enrolled ? '#10b981' : BORDER_STRONG, border:'none', position:'relative', cursor: mfa === null ? 'default' : 'pointer', flex:'0 0 38px', opacity: mfa === null ? .5 : 1 }}>
                      <span style={{ position:'absolute', top:'3px', left: mfa?.enrolled ? '20px' : '3px', width:'15px', height:'15px', borderRadius:'99px', background:'#fff' }}></span>
                    </button>
                  </div>
                  {enrolment ? (
                    <div style={{ border:'1px solid #c7d2fe', background:'#eef2ff', borderRadius:'12px', padding:'13px', display:'flex', flexDirection:'column', gap:'8px' }}>
                      <span style={{ fontSize:'.78125rem', fontWeight:600 }}>Finish enrolment</span>
                      <span style={{ fontSize:'.71875rem', color:'#3730a3', lineHeight:1.6, wordBreak:'break-all', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>
                        Add this secret to your authenticator app: {enrolment.secret}
                      </span>
                      <span style={{ fontSize:'.71875rem', color:'#3730a3', lineHeight:1.6, wordBreak:'break-all' }}>
                        Recovery codes (store them now): {enrolment.recovery_codes.join(', ')}
                      </span>
                      <div style={{ display:'flex', gap:'7px' }}>
                        <button type="button" onClick={confirmEnrolment} style={primaryBtn}>Enter code</button>
                        <button type="button" onClick={() => setEnrolment(null)} style={ghostBtn}>Cancel</button>
                      </div>
                    </div>
                  ) : null}

                  <div style={{ display:'flex', flexDirection:'column', gap:'9px', borderTop:'1px solid #f2f4f8', paddingTop:'13px' }}>
                    <div style={{ display:'flex', alignItems:'flex-start', gap:'12px' }}>
                      <div style={{ display:'flex', flexDirection:'column', gap:'3px', maxWidth:'460px' }}>
                        <span style={{ fontSize:'.8125rem', fontWeight:600 }}>Passkeys</span>
                        <span style={{ fontSize:'.71875rem', color:'#64748b', lineHeight:1.55 }}>
                          Sign in with your device instead of a password. Unlike a code, a passkey
                          cannot be phished: it only works on this site, and nothing secret is
                          stored on our servers.
                        </span>
                      </div>
                      <button type="button" onClick={addPasskey} style={{ ...autoGhostBtn, marginLeft:'auto' }}>
                        Add passkey
                      </button>
                    </div>
                    {passkeys === null ? (
                      <span style={{ fontSize:'.71875rem', color:'#64748b' }}>
                        {failed.passkeys ? 'Passkeys could not be loaded.' : 'Loading passkeys…'}
                      </span>
                    ) : passkeys.length === 0 ? (
                      <span style={{ fontSize:'.71875rem', color:'#64748b' }}>No passkeys yet.</span>
                    ) : (
                      passkeys.map(row => (
                        <div key={row.id} style={{ display:'flex', alignItems:'center', gap:'12px' }}>
                          <div style={{ display:'flex', flexDirection:'column', gap:'2px' }}>
                            <span style={{ fontSize:'.78125rem' }}>{row.label || 'Passkey'}</span>
                            <span style={{ fontSize:'.6875rem', color:'#64748b' }}>
                              {joinMeta(['added ' + stamp(row.created_at), row.last_used_at ? 'last used ' + stamp(row.last_used_at) : 'never used'])}
                            </span>
                          </div>
                          <button
                            type="button"
                            onClick={() => removePasskey(row)}
                            style={{ ...autoGhostBtn, marginLeft:'auto' }}
                          >
                            Remove
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                <div style={{ ...card, gap:'11px' }}>
                  <span style={railHead}>Authenticated devices and browsers</span>
                  {sessions === null ? (
                    <div style={emptyBox}>Loading your active sessions…</div>
                  ) : failed.sessions ? (
                    <div style={emptyBox}>Your sessions could not be loaded. Nothing is listed rather than an incomplete list — retry before treating this as &ldquo;no other sessions&rdquo;.</div>
                  ) : devices.length === 0 ? (
                    <div style={emptyBox}>No active sessions recorded.</div>
                  ) : devices.map(d => (
                    <div key={d.id} style={{ display:'flex', alignItems:'center', gap:'12px', padding:'9px 0', borderTop:'1px solid #f2f4f8' }}>
                      <div style={{ display:'flex', flexDirection:'column', gap:'2px', minWidth:0 }}>
                        <span style={{ fontSize:'.78125rem', fontWeight:600 }}>{d.label}</span>
                        <span style={{ fontSize:'.6875rem', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{d.meta}</span>
                      </div>
                      <button type="button" onClick={d.onRemove} style={autoDangerBtn}>{d.isCurrent ? 'Sign out here' : 'Sign out'}</button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {acNotifications ? (
              <div style={{ ...card, gap:'11px' }}>
                <span style={railHead}>Notify me when</span>
                {notifPrefsData === null ? (
                  <div style={emptyBox}>Loading your notification preferences…</div>
                ) : notifPrefs.length === 0 ? (
                  <div style={emptyBox}>{failed.notif ? 'Preferences could not be loaded.' : 'No notification events are configured for this account.'}</div>
                ) : notifPrefs.map(p => (
                  <div key={p.key} style={{ display:'flex', alignItems:'center', gap:'12px', padding:'8px 0', borderTop:'1px solid #f2f4f8' }}>
                    <span style={{ fontSize:'.78125rem', color:'#334155' }}>{p.label}</span>
                    <button type="button" role="switch" aria-checked={p.on} aria-label={p.label} onClick={p.onToggle} style={{ ...p.switchStyle, marginLeft:'auto' }}><span style={p.knob}></span></button>
                  </div>
                ))}
              </div>
            ) : null}

            {acEmail ? (
              <div style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
                <div style={{ ...card, gap:'12px' }}>
                  <div style={{ display:'flex', flexDirection:'column', gap:'3px' }}>
                    <span style={{ fontSize:'.84375rem', fontWeight:600 }}>Account email</span>
                    <span style={{ fontSize:'.71875rem', color:'#64748b' }}>Notification preferences for the account owner</span>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:'12px', padding:'11px', border:'1px solid #eef1f6', borderRadius:'12px', background:'#fbfcfd', flexWrap:'wrap' }}>
                    <span style={{ fontSize:'.78125rem', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{userEmail}</span>
                    <button type="button" onClick={manageNotifications} style={autoGhostBtn}>Manage notifications</button>
                  </div>
                </div>
                <div style={{ ...card, gap:'12px' }}>
                  <div style={{ display:'flex', flexDirection:'column', gap:'3px' }}>
                    <span style={{ fontSize:'.84375rem', fontWeight:600 }}>Additional recipients</span>
                    <span style={{ fontSize:'.71875rem', color:'#64748b', maxWidth:'420px', lineHeight:1.5 }}>Addresses copied on this account&rsquo;s notification events.</span>
                  </div>
                  {notifPrefsData === null ? (
                    <div style={emptyBox}>Loading…</div>
                  ) : extraRecipients.length === 0 ? (
                    <div style={emptyBox}>No additional recipients are configured.</div>
                  ) : (
                    <div style={{ display:'flex', flexDirection:'column', gap:'8px' }}>
                      {extraRecipients.map(addr => (
                        <div key={addr} style={{ display:'flex', alignItems:'center', gap:'10px', padding:'9px 11px', border:'1px solid #eef1f6', borderRadius:'11px' }}>
                          <span style={{ fontSize:'.75rem', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{addr}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {acIntegrations ? (
              integrationsData === null ? (
                <div style={emptyBox}>Loading integrations…</div>
              ) : integrations.length === 0 ? (
                <div style={emptyBox}>{failed.integrations ? 'Integrations could not be loaded.' : 'No integrations are available on this deployment.'}</div>
              ) : (
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'12px' }}>
                  {integrations.map(i => (
                    <div key={i.key} style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'14px', padding:'14px', display:'flex', alignItems:'center', gap:'12px' }}>
                      <div style={{ display:'flex', flexDirection:'column', gap:'4px', minWidth:0 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                          <span style={{ fontSize:'.8125rem', fontWeight:600 }}>{i.label}</span>
                          <span style={i.pill}>{i.pillLabel}</span>
                        </div>
                        <span style={{ fontSize:'.71875rem', color:'#64748b', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{i.meta}</span>
                      </div>
                      <button type="button" onClick={i.onClick} style={{ ...i.ctaStyle, marginLeft:'auto', flex:'0 0 auto' }}>{i.ctaLabel}</button>
                    </div>
                  ))}
                </div>
              )
            ) : null}

            {acCloud ? (
              <div style={{ ...card, gap:'11px' }}>
                <span style={railHead}>Automatic export of completed documents</span>
                {cloudData === null ? (
                  <div style={emptyBox}>Loading export targets…</div>
                ) : cloudTargets.length === 0 ? (
                  <div style={emptyBox}>{failed.cloud ? 'Export targets could not be loaded.' : 'No cloud export targets are configured.'}</div>
                ) : cloudTargets.map(c => (
                  <div key={c.key} style={{ display:'flex', alignItems:'center', gap:'12px', padding:'10px 0', borderTop:'1px solid #f2f4f8' }}>
                    <div style={{ display:'flex', flexDirection:'column', gap:'2px', minWidth:0 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                        <span style={{ fontSize:'.78125rem', fontWeight:600 }}>{c.label}</span>
                        <span style={c.pill}>{c.pillLabel}</span>
                      </div>
                      <span style={{ fontSize:'.6875rem', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>{c.path}</span>
                    </div>
                    <button type="button" onClick={c.onToggle} style={autoGhostBtn}>{c.pillLabel === 'Exporting' ? 'Turn off' : 'Turn on'}</button>
                  </div>
                ))}
              </div>
            ) : null}

            {acTeams ? (
              <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
                {teamsData === null ? (
                  <div style={emptyBox}>Loading teams…</div>
                ) : teams.length === 0 ? (
                  <div style={emptyBox}>{failed.teams ? 'Teams could not be loaded.' : 'This organization has no teams yet.'}</div>
                ) : teams.map(t => (
                  <div key={t.key} style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'14px', padding:'15px', display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap' }}>
                    <div style={{ display:'flex', flexDirection:'column', gap:'3px', minWidth:0 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                        <span style={{ fontSize:'.84375rem', fontWeight:600 }}>{t.label}</span>
                        <span style={t.pill}>{t.role}</span>
                      </div>
                      <span style={{ fontSize:'.71875rem', color:'#64748b' }}>{t.meta}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}

            {acOrgs ? (
              <div style={{ display:'flex', flexDirection:'column', gap:'12px' }}>
                {orgData === null ? (
                  <div style={emptyBox}>{failed.orgs ? 'Your organization could not be loaded.' : 'Loading…'}</div>
                ) : (
                  <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'14px', padding:'15px', display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap' }}>
                    <div style={{ display:'flex', flexDirection:'column', gap:'3px', minWidth:0 }}>
                      <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                        <span style={{ fontSize:'.84375rem', fontWeight:600 }}>{orgData.name}</span>
                        <span style={pill(TONE_GOOD)}>{userRole}</span>
                      </div>
                      <span style={{ fontSize:'.71875rem', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif" }}>
                        {joinMeta([orgData.slug, orgData.region, orgData.seats_licensed + (orgData.seats_licensed === 1 ? ' seat' : ' seats')])}
                      </span>
                    </div>
                  </div>
                )}
                <span style={{ fontSize:'.71875rem', color:'#64748b', lineHeight:1.6 }}>You belong to one organization. Membership of additional organizations is not supported on this deployment.</span>
              </div>
            ) : null}

            {acAudit ? (
              auditData === null ? (
                <div style={emptyBox}>Loading your account audit log…</div>
              ) : failed.audit ? (
                <div style={emptyBox}>Your audit log could not be loaded. Nothing is shown rather than a partial record.</div>
              ) : audit.length === 0 ? (
                <div style={emptyBox}>No account events have been recorded yet.</div>
              ) : (
                <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', overflow:'hidden' }}>
                  {audit.map(a => (
                    <div key={a.key} style={a.rowStyle}>
                      <div style={{ display:'flex', gap:'11px', alignItems:'flex-start' }}>
                        <span style={a.dot}></span>
                        <div style={{ display:'flex', flexDirection:'column', gap:'4px', minWidth:0 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:'8px', flexWrap:'wrap' }}>
                            <span style={{ fontSize:'.8125rem', fontWeight:600 }}>{a.action}</span>
                            <span style={a.actorStyle}>{a.actor}</span>
                          </div>
                          <div style={{ fontSize:'.6875rem', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", lineHeight:1.7, wordBreak:'break-all' }}>{a.meta}</div>
                        </div>
                      </div>
                      <span style={{ fontSize:'.6875rem', color:'#64748b', fontFamily:"'Inter', 'Google Sans Flex', sans-serif", whiteSpace:'nowrap' }}>{a.time}</span>
                    </div>
                  ))}
                </div>
              )
            ) : null}
        </div>
      </div>
    </section>
  );
}
