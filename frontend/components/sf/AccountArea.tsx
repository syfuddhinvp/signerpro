'use client';

/* SignerPro — ACCOUNT AREA.
 *
 * Every panel below reads the signed-in user's real account state. Nothing on
 * this screen is invented: where an endpoint exists it is called, and where one
 * does not the panel says so rather than showing a plausible-looking fiction.
 * That rule matters most for the two security surfaces here — the account audit
 * log and the authenticated-device list — which are read by someone checking
 * whether their account has been compromised. */

import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSF } from '@/lib/sf/state';
import { useModalBehaviour } from '@/components/sf/useModalBehaviour';
import SignatureComposer, { type ComposedSignature } from '@/components/sf/parts/SignatureComposer';
import { credentialToJson, passkeysSupported, toCreationOptions } from '@/lib/sf/webauthn';
import { useSession } from '@/components/sf/SessionProvider';
import { useDialogs } from '@/components/sf/DialogProvider';
import type { AccountSection } from '@/lib/sf/routes';
import { ACCOUNT_TITLES } from '@/lib/sf/data';
import { apiCall, proxyPath } from '@/lib/api/browser';
import { account as accountApi, auth as authApi, invitations as invitationsApi, organizations as organizationsApi, teams as teamsApi } from '@/lib/api/resources';
import type {
  AccountAuditFeed, CloudTargetItem, CurrentUserResponse, IntegrationResponse,
  MfaEnrollResponse, MfaStatusResponse, NotificationPreferenceResponse, PasskeyResponse,
  SsoConnectionResponse,
  OrganizationResponse, SavedSignatureResponse, SessionResponse,
  InvitationResponse, TeamResponse, UserResponse,
} from '@/lib/api/types';
import { btn, pill, inputStyle, lbl as lblStyle, railHead, TONE_GOOD, TONE_INDIGO, TONE_MUTED, BORDER_STRONG } from '@/lib/sf/ui';
import { typeFaceStack } from '@/lib/sf/fonts';

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
  const { s: sfState, set: setSf, flash, accent, initials } = useSF();
  const session = useSession();

  const A = accent();
  const { askText, askChoice, askConfirm } = useDialogs();

  const primaryBtn = btn(A, '#fff', A);
  const ghostBtn = btn('#fff', '#475569', '#e3e7ee');
  const autoGhostBtn: CSSProperties = { ...btn('#fff', '#475569', '#e3e7ee'), marginLeft:'auto', flex:'0 0 auto' };
  const autoDangerBtn: CSSProperties = { ...btn('#fff', '#b91c1c', '#fecaca'), marginLeft:'auto', flex:'0 0 auto' };
  /* A row-level edit that repeats down a list. Bordered buttons on every row
     turn a quiet roster into a column of competing calls to action. */
  const linkBtn: CSSProperties = {
    background:'none', border:'none', padding:0, cursor:'pointer',
    fontSize:'.71875rem', fontWeight:600, color:A, textDecoration:'underline',
    textUnderlineOffset:'2px', flex:'0 0 auto',
  };
  const mono: CSSProperties = { ...inputStyle, fontFamily:'var(--font-sans)', fontSize:'.71875rem' };

  /* ── server state ─────────────────────────────────────────────────────── */
  const [me, setMe] = useState<CurrentUserResponse | null>(null);
  const [signatures, setSignatures] = useState<SavedSignatureResponse[] | null>(null);
  const [sessions, setSessions] = useState<SessionResponse[] | null>(null);
  const [mfa, setMfa] = useState<MfaStatusResponse | null>(null);
  const [passkeys, setPasskeys] = useState<PasskeyResponse[] | null>(null);
  const [sso, setSso] = useState<SsoConnectionResponse | null>(null);
  const [enrolment, setEnrolment] = useState<MfaEnrollResponse | null>(null);
  const [notifPrefsData, setNotifPrefs] = useState<NotificationPreferenceResponse[] | null>(null);
  const [integrationsData, setIntegrations] = useState<IntegrationResponse[] | null>(null);
  const [cloudData, setCloud] = useState<CloudTargetItem[] | null>(null);
  const [teamsData, setTeams] = useState<TeamResponse[] | null>(null);
  const [orgData, setOrg] = useState<OrganizationResponse | null>(null);
  const [membersData, setMembers] = useState<UserResponse[] | null>(null);
  const [invitesData, setInvites] = useState<InvitationResponse[] | null>(null);
  /** The team whose member list is unfolded. One at a time: the point of the
   *  list is to compare teams, which a wall of expanded rosters defeats. */
  const [openTeam, setOpenTeam] = useState<string | null>(null);
  const [auditData, setAudit] = useState<AccountAuditFeed | null>(null);
  /* Audit table controls. All three are client-side over the loaded window:
     the feed is one request, so filtering it again on the server would only
     add latency to a list already in memory. */
  const AUDIT_PAGE_SIZE = 25;
  const [auditQuery, setAuditQuery] = useState('');
  const [auditType, setAuditType] = useState('all');
  const [auditActor, setAuditActor] = useState('all');
  const [auditFrom, setAuditFrom] = useState('');
  const [auditTo, setAuditTo] = useState('');
  const [auditPage, setAuditPage] = useState(0);
  const [auditSort, setAuditSort] = useState<{ key: 'time' | 'action' | 'document' | 'actor'; dir: 'asc' | 'desc' }>({ key: 'time', dir: 'desc' });
  /** True while a filter change is in flight, so the table can dim rather than
      flash the empty state over results that are still valid. */
  const [auditBusy, setAuditBusy] = useState(false);
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

  const loadSso = useCallback(() => {
    void authApi.ssoConnection(apiCall).then(res => {
      if (!res.ok) { markFailed('sso'); return; }
      setSso(res.data);
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

  /* One section, one load. The organization, its people, the invitations still
     outstanding and the teams are four endpoints answering one question —
     "who is in this workspace, and where?" — so they are fetched together and
     refreshed together after every write. */
  const loadTeams = useCallback(() => {
    void teamsApi.list(apiCall).then(res => {
      if (!res.ok) { markFailed('teams'); setTeams([]); return; }
      setTeams(res.data);
    });
  }, [markFailed]);

  const loadMembers = useCallback(() => {
    void organizationsApi.members(apiCall).then(res => {
      if (!res.ok) { markFailed('members'); setMembers([]); return; }
      setMembers(res.data);
    });
  }, [markFailed]);

  const loadInvites = useCallback(() => {
    void invitationsApi.list(apiCall).then(res => {
      /* Non-admins are not allowed to read pending invitations. That is not a
         failure to report — the panel simply has nothing to show them. */
      if (!res.ok) { setInvites([]); return; }
      setInvites(res.data);
    });
  }, []);

  const loadOrganization = useCallback(() => {
    void organizationsApi.me(apiCall).then(res => { if (res.ok) setOrg(res.data); else markFailed('orgs'); });
    loadMembers();
    loadTeams();
    loadInvites();
  }, [markFailed, loadMembers, loadTeams, loadInvites]);

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
    if (section === 'security') { loadSessions(); loadMfa(); loadPasskeys(); loadSso(); }
    if (section === 'notifications') loadNotifPrefs();
    /* One section, two feeds: whether a connector is connected, and where it
       exports to. */
    if (section === 'integrations') { loadIntegrations(); loadCloud(); }
    if (section === 'organization') loadOrganization();
  }, [section, loadSessions, loadMfa, loadPasskeys, loadSso, loadNotifPrefs, loadIntegrations, loadCloud, loadOrganization, markFailed]);

  /* The audit feed is filtered, sorted and paged on the server: the trail
     grows without bound, so narrowing a fetched window would silently search
     only the part that happened to be in hand. Every control below therefore
     re-requests. The search box is debounced so typing is one request, not one
     per keystroke. */
  const [auditSearch, setAuditSearch] = useState('');
  useEffect(() => {
    const id = setTimeout(() => setAuditSearch(auditQuery.trim()), 300);
    return () => clearTimeout(id);
  }, [auditQuery]);

  /* A narrower filter can put the current page past the end of the results.
     Going back to the first page is the only answer that always has rows. */
  useEffect(() => {
    setAuditPage(0);
  }, [auditSearch, auditType, auditActor, auditFrom, auditTo, auditSort]);

  useEffect(() => {
    if (section !== 'audit') return;
    let cancelled = false;
    setAuditBusy(true);
    void accountApi.auditTrail(apiCall, {
      limit: AUDIT_PAGE_SIZE,
      offset: auditPage * AUDIT_PAGE_SIZE,
      search: auditSearch || undefined,
      event_type: auditType === 'all' ? undefined : auditType,
      actor: auditActor === 'all' ? undefined : auditActor,
      // `<input type="date">` gives a bare day; widen it to that whole day so
      // "from the 3rd to the 3rd" means the 3rd, not an empty instant.
      date_from: auditFrom ? auditFrom + 'T00:00:00' : undefined,
      date_to: auditTo ? auditTo + 'T23:59:59' : undefined,
      sort_by: auditSort.key,
      sort_dir: auditSort.dir,
    }).then(res => {
      if (cancelled) return;
      setAuditBusy(false);
      if (!res.ok) { markFailed('audit'); setAudit({ items: [], total: 0, event_types: [], actors: [] }); return; }
      setAudit(res.data);
    });
    return () => { cancelled = true; };
  }, [section, auditPage, auditSearch, auditType, auditActor, auditFrom, auditTo, auditSort, markFailed]);

  const userName = me?.name || session.name;
  const userRole = me?.role || session.role;
  const userEmail = me?.email || session.email;
  const userInitials = initials(userName);


  /* ── profile actions ──────────────────────────────────────────────────── */

  /* The form is uncontrolled until the first keystroke: `me` arrives after the
     first paint, and a controlled field seeded from it would either blank
     itself on load or fight whatever the user had already typed. */
  const [profileDraft, setProfileDraft] = useState<{ name: string; timezone: string; locale: string } | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const profileValue = (key: 'name' | 'timezone' | 'locale'): string => {
    if (profileDraft) return profileDraft[key];
    if (key === 'name') return userName;
    return (key === 'timezone' ? me?.timezone : me?.locale) ?? '';
  };
  const editProfile = (key: 'name' | 'timezone' | 'locale', value: string) =>
    setProfileDraft({
      name: profileValue('name'), timezone: profileValue('timezone'), locale: profileValue('locale'),
      [key]: value,
    });
  const profileDirty = profileDraft !== null && (
    profileDraft.name !== userName
    || profileDraft.timezone !== (me?.timezone ?? '')
    || profileDraft.locale !== (me?.locale ?? '')
  );

  const saveProfile = () => {
    if (!profileDraft || !profileDirty) return;
    const name = profileDraft.name.trim();
    if (!name) { flash('A name is required'); return; }
    setSavingProfile(true);
    void accountApi.updateMe(apiCall, {
      name,
      timezone: profileDraft.timezone.trim(),
      locale: profileDraft.locale.trim(),
    }).then(res => {
      setSavingProfile(false);
      if (!res.ok) { flash('Could not save your profile · ' + res.error.message); return; }
      setMe(res.data);
      setProfileDraft(null);
      flash('Profile saved');
    });
  };

  /* ── profile photo ────────────────────────────────────────────────────── */

  /* The photo is saved on pick rather than folded into the profile form's
     dirty state: the picker is already a deliberate confirmation, and a
     preview that waited on Save would leave the two out of step. */
  const photoInput = useRef<HTMLInputElement | null>(null);
  const [savingPhoto, setSavingPhoto] = useState(false);
  /* Absolute (an identity provider's URL) is used as-is; ours is relative and
     goes through the session proxy, which carries the credentials. */
  const avatarSrc = me?.avatar_url
    ? (/^https?:/i.test(me.avatar_url) ? me.avatar_url : proxyPath(me.avatar_url))
    : null;

  const pickPhoto = (file: File | null) => {
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type)) {
      flash('A profile photo must be a PNG or JPEG image'); return;
    }
    if (file.size > 2 * 1024 * 1024) { flash('A profile photo must be 2 MB or smaller'); return; }
    const reader = new FileReader();
    reader.onerror = () => flash('That image could not be read');
    reader.onload = () => {
      setSavingPhoto(true);
      void accountApi.updateAvatar(apiCall, String(reader.result)).then(res => {
        setSavingPhoto(false);
        if (!res.ok) { flash('Could not save your photo · ' + res.error.message); return; }
        setMe(res.data);
        flash('Profile photo updated');
      });
    };
    reader.readAsDataURL(file);
  };

  const removePhoto = () => {
    setSavingPhoto(true);
    void accountApi.removeAvatar(apiCall).then(res => {
      setSavingPhoto(false);
      if (!res.ok) { flash('Could not remove your photo · ' + res.error.message); return; }
      setMe(res.data);
      flash('Profile photo removed');
    });
  };

  /* ── saved signatures ─────────────────────────────────────────────────── */

  /* Adopting a signature uses the same composer the signing modal does —
     draw, type or upload — rather than a name-then-style pair of prompts that
     could not produce a drawn signature at all. */
  const [sigModalOpen, setSigModalOpen] = useState(false);
  const [savingSignature, setSavingSignature] = useState(false);
  const composeRef = useRef<(() => ComposedSignature | null) | null>(null);
  const closeSigModal = useCallback(() => setSigModalOpen(false), []);
  const sigDialogRef = useModalBehaviour<HTMLDivElement>(sigModalOpen, closeSigModal);

  const openSignatureModal = () => {
    /* Seed the typed tab with the signer's own name; the composer keeps the
       chosen face and ink in shared state between openings. */
    if (!sfState.typedName && userName) setSf({ typedName: userName });
    setSigModalOpen(true);
  };

  const adoptSignature = () => {
    const composed = composeRef.current ? composeRef.current() : null;
    if (!composed) return;  // the composer has already said what is missing
    setSavingSignature(true);
    void accountApi.createSignature(apiCall, {
      signature_type: composed.signature_type,
      signature_text: composed.signature_text,
      type_face: composed.type_face,
      signature_image_base64: composed.signature_image_base64,
      label: composed.signature_text || userName,
    }).then(res => {
      setSavingSignature(false);
      if (!res.ok) { flash('Could not add that signature · ' + res.error.message); return; }
      setSigModalOpen(false);
      /* The server decides the default (the first one adopted becomes it), so
         reload rather than guessing which row now carries the flag. */
      void accountApi.signatures(apiCall).then(list => { if (list.ok) setSignatures(list.data); });
      flash('Signature adopted');
    });
  };

  const makeDefaultSignature = (row: SavedSignatureResponse) => {
    void accountApi.setDefaultSignature(apiCall, row.id).then(res => {
      if (!res.ok) { flash('Could not set the default · ' + res.error.message); return; }
      setSignatures(res.data);
      flash(row.label + ' is now your default signature');
    });
  };

  const removeSignature = async (row: SavedSignatureResponse) => {
    const ok = await askConfirm({
      title: 'Remove this signature?',
      message: row.is_default
        ? 'It is your default. The next most recent signature will take over.'
        : 'Documents already signed with it are unaffected.',
      cta: 'Remove', danger: true,
    });
    if (!ok) return;
    const res = await accountApi.deleteSignature(apiCall, row.id);
    if (!res.ok) { flash('Could not remove that signature · ' + res.error.message); return; }
    void accountApi.signatures(apiCall).then(list => { if (list.ok) setSignatures(list.data); });
    flash('Signature removed');
  };

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

  /* SSO is org-level configuration, and getting it wrong locks a workspace
     out or -- worse -- lets another tenant's IdP in, so every field is asked
     for explicitly and the domain list is never allowed to be empty. */
  const configureSso = async () => {
    const entityId = await askText({ title: 'Single sign-on', label: 'IdP entity ID', message: 'From your identity provider\u2019s metadata.', placeholder: 'https://idp.example.com/metadata', cta: 'Next', required: true });
    if (!entityId) return;
    const ssoUrl = await askText({ title: 'Single sign-on', label: 'IdP sign-on URL', placeholder: 'https://idp.example.com/sso', cta: 'Next', required: true });
    if (!ssoUrl) return;
    const cert = await askText({ title: 'Single sign-on', label: 'IdP signing certificate (X.509)', message: 'Base64 body of the certificate. This is what verifies the assertion signature.', cta: 'Next', required: true });
    if (!cert) return;
    const domains = await askText({
      title: 'Single sign-on', label: 'Allowed email domains',
      message: 'Comma-separated. Only addresses in these domains may sign in through your IdP \u2014 this is what stops another workspace\u2019s provider asserting your users.',
      placeholder: 'example.com', cta: 'Save', required: true,
    });
    if (!domains) return;

    const res = await authApi.saveSsoConnection(apiCall, {
      idp_entity_id: entityId, idp_sso_url: ssoUrl, idp_x509_cert: cert,
      allowed_email_domains: domains,
      enabled: true, enforced: sso ? sso.enforced : false,
      auto_provision: sso ? sso.auto_provision : true,
    });
    if (!res.ok) { flash('Single sign-on not saved \u00b7 ' + res.error.message); return; }
    flash('Single sign-on configured');
    setSso(res.data);
  };

  const toggleSsoEnforcement = async () => {
    if (!sso) return;
    if (!sso.enforced) {
      const confirmed = await askText({
        title: 'Require single sign-on', label: 'Type REQUIRE to confirm',
        message: 'Everyone in this workspace will have to sign in through your identity provider. Password sign-in stops working immediately, including for you.',
        cta: 'Require SSO', required: true,
      });
      if (confirmed !== 'REQUIRE') { flash('Not changed'); return; }
    }
    const res = await authApi.saveSsoConnection(apiCall, { ...sso, idp_x509_cert: '', enforced: !sso.enforced });
    if (!res.ok) { flash('Not changed \u00b7 ' + res.error.message); return; }
    setSso(res.data);
    flash(res.data.enforced ? 'Single sign-on is now required' : 'Password sign-in re-enabled');
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

  /* ── organization & teams ─────────────────────────────────────────────
     Every write here is org-admin only server-side (`require_org_admin`), so
     the buttons that raise them are only rendered for an admin. The checks
     that matter are still the server's; hiding the controls just stops a
     sender being offered an action that can only end in a 403. */

  const ORG_ROLES = [
    { id: 'admin', label: 'Administrator — manages people, teams and billing' },
    { id: 'sender', label: 'Sender — prepares and sends documents' },
  ];
  const TEAM_ROLES = [
    { id: 'lead', label: 'Lead' },
    { id: 'member', label: 'Member' },
  ];

  const inviteMember = async () => {
    const email = await askText({
      title: 'Invite someone',
      label: 'Work email',
      message: 'They join this organization once they accept.',
      placeholder: 'name@company.com',
      cta: 'Next', required: true,
    });
    if (!email) return;
    const role = await askChoice({
      title: 'Invite someone', label: 'Role', message: email,
      options: ORG_ROLES, defaultValue: 'sender', cta: 'Send invitation',
    });
    if (!role) return;
    void invitationsApi.create(apiCall, { email, role }).then(res => {
      if (!res.ok) { flash('Invitation not sent · ' + res.error.message); return; }
      flash(email + ' invited as ' + role);
      loadInvites();
    });
  };

  const revokeInvite = async (invite: InvitationResponse) => {
    const ok = await askConfirm({
      title: 'Revoke invitation',
      message: 'The link sent to ' + invite.email + ' stops working immediately.',
      cta: 'Revoke', danger: true,
    });
    if (!ok) return;
    void invitationsApi.revoke(apiCall, invite.id).then(res => {
      if (!res.ok) { flash('Could not revoke that invitation · ' + res.error.message); return; }
      flash('Invitation to ' + invite.email + ' revoked');
      loadInvites();
    });
  };

  const changeMemberRole = async (member: UserResponse) => {
    const role = await askChoice({
      title: 'Change role', label: 'Role in this organization', message: member.name + ' · ' + member.email,
      options: ORG_ROLES, defaultValue: member.role, cta: 'Save role',
    });
    if (!role || role === member.role) return;
    void organizationsApi.setMemberRole(apiCall, member.id, role).then(res => {
      if (!res.ok) { flash('Role not changed · ' + res.error.message); return; }
      flash(member.name + ' is now ' + (role === 'admin' ? 'an administrator' : 'a sender'));
      loadMembers();
    });
  };

  const createTeam = async () => {
    const name = await askText({ title: 'New team', label: 'Team name', placeholder: 'Legal', cta: 'Next', required: true });
    if (!name) return;
    const description = await askText({
      title: 'New team', label: 'Description (optional)',
      message: 'What this team is for. Leave blank to skip.', cta: 'Create team',
    });
    if (description === null) return;
    void teamsApi.create(apiCall, { name, description: description || null }).then(res => {
      if (!res.ok) { flash('Team not created · ' + res.error.message); return; }
      flash(name + ' created — you are its lead');
      loadTeams();
    });
  };

  const renameTeam = async (team: TeamResponse) => {
    const name = await askText({ title: 'Rename team', label: 'Team name', defaultValue: team.name, cta: 'Save', required: true });
    if (!name || name === team.name) return;
    void teamsApi.update(apiCall, team.id, { name }).then(res => {
      if (!res.ok) { flash('Team not renamed · ' + res.error.message); return; }
      flash('Renamed to ' + name);
      loadTeams();
    });
  };

  const deleteTeam = async (team: TeamResponse) => {
    const ok = await askConfirm({
      title: 'Delete ' + team.name + '?',
      /* Worth spelling out: the destructive-sounding action is not destructive
         to documents, and someone hesitating over it deserves to know that. */
      message: 'Its ' + team.member_count + ' member(s) lose access to the team\u2019s folders. '
        + 'No document is deleted — the folders become personal folders of whoever made them.',
      cta: 'Delete team', danger: true,
    });
    if (!ok) return;
    void teamsApi.remove(apiCall, team.id).then(res => {
      if (!res.ok) { flash('Team not deleted · ' + res.error.message); return; }
      flash(team.name + ' deleted');
      loadTeams();
    });
  };

  const addTeamMember = async (team: TeamResponse) => {
    const inTeam = new Set(team.members.map(m => m.user_id));
    const candidates = (membersData ?? []).filter(m => !inTeam.has(m.id));
    if (candidates.length === 0) {
      flash(membersData === null
        ? 'The member list is still loading'
        : 'Everyone in this organization is already in ' + team.name);
      return;
    }
    const userId = await askChoice({
      title: 'Add to ' + team.name, label: 'Person',
      options: candidates.map(m => ({ id: m.id, label: m.name + ' · ' + m.email })),
      cta: 'Next',
    });
    if (!userId) return;
    const role = await askChoice({
      title: 'Add to ' + team.name, label: 'Role in the team',
      options: TEAM_ROLES, defaultValue: 'member', cta: 'Add to team',
    });
    if (!role) return;
    void teamsApi.addMember(apiCall, team.id, { user_id: userId, role }).then(res => {
      if (!res.ok) { flash('Could not add that person · ' + res.error.message); return; }
      flash(res.data.name + ' now has ' + res.data.member_count + ' member(s)');
      loadTeams();
    });
  };

  const changeTeamRole = async (team: TeamResponse, member: { user_id: string; name: string; role: string }) => {
    const role = await askChoice({
      title: 'Role in ' + team.name, label: 'Role', message: member.name,
      options: TEAM_ROLES, defaultValue: member.role, cta: 'Save role',
    });
    if (!role || role === member.role) return;
    /* Adding an existing member is the role change — the endpoint is idempotent. */
    void teamsApi.addMember(apiCall, team.id, { user_id: member.user_id, role }).then(res => {
      if (!res.ok) { flash('Role not changed · ' + res.error.message); return; }
      flash(member.name + ' is now ' + role + ' of ' + team.name);
      loadTeams();
    });
  };

  const removeTeamMember = async (team: TeamResponse, member: { user_id: string; name: string }) => {
    const ok = await askConfirm({
      title: 'Remove ' + member.name + '?',
      message: 'They lose access to ' + team.name + '\u2019s folders. Their own documents are untouched.',
      cta: 'Remove', danger: true,
    });
    if (!ok) return;
    void teamsApi.removeMember(apiCall, team.id, member.user_id).then(res => {
      if (!res.ok) { flash('Could not remove that member · ' + res.error.message); return; }
      flash(member.name + ' removed from ' + team.name);
      loadTeams();
    });
  };

  /* ── nav / titles ─────────────────────────────────────────────────────── */

  const accountTitle = ACCOUNT_TITLES[section][0];
  const accountSub = ACCOUNT_TITLES[section][1];

  const acProfile = section === 'profile';
  const acSecurity = section === 'security';
  const acNotifications = section === 'notifications';
  const acIntegrations = section === 'integrations';
  const acOrg = section === 'organization';
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

  /* The export target for a provider, when it has one. A connector and its
     export destination are the same connector, so they are one card. */
  const cloudFor = (provider: string) => (cloudData ?? []).find(c => c.provider === provider);

  const toggleCloud = (provider: string) => {
    const next = (cloudData ?? []).map(x => (x.provider === provider ? { ...x, enabled: !x.enabled } : x));
    setCloud(next);
    void accountApi.updateCloudTargets(apiCall, next).then(res => {
      if (!res.ok) { flash('Could not save the export targets · ' + res.error.message); loadCloud(); return; }
      setCloud(res.data);
    });
  };

  const integrations = (integrationsData ?? []).map(i => {
    const target = cloudFor(i.provider);
    return {
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
    /* Export is only meaningful once the connector is connected — offering a
       folder for an account we cannot write to would be a dead control. */
    export: i.connected && target ? {
      path: target.path || 'no export path set',
      enabled: target.enabled,
      pill: pill(target.enabled ? TONE_GOOD : TONE_MUTED),
      pillLabel: target.enabled ? 'Exporting' : 'Off',
      ctaLabel: target.enabled ? 'Turn off' : 'Turn on',
      onToggle: () => toggleCloud(i.provider),
    } : null,
  };
  });

  /* Org writes are admin-only server-side; the controls follow that. */
  const isOrgAdmin = (me?.role || session.role) === 'admin';

  const teams = (teamsData ?? []).map(t => ({
    team: t,
    key: t.id,
    label: t.name,
    /* Description and figures on two lines, not one run-on: the description is
       prose the org wrote, the counts are computed. Reading "9 members" next
       to a sentence claiming a different number is how a stale description
       passes for live data. */
    description: t.description ?? '',
    counts: joinMeta([
      t.member_count + (t.member_count === 1 ? ' member' : ' members'),
      t.document_count + (t.document_count === 1 ? ' document' : ' documents'),
      t.template_count + (t.template_count === 1 ? ' template' : ' templates'),
    ]),
    role: t.my_role ? t.my_role : 'not a member',
    pill: pill(t.my_role ? TONE_INDIGO : TONE_MUTED),
    open: openTeam === t.id,
  }));

  /* Accepted invitations become members, so listing them again would show
     everyone twice. Only what is still outstanding belongs here. */
  const pendingInvites = (invitesData ?? []).filter(i => !i.accepted_at);

  /* Rows are rendered as the server returned them — already filtered, sorted
     and paged. */
  const audit = useMemo(() => (auditData?.items ?? []).map(a => ({
    key: a.id,
    action: a.event_type,
    actor: a.actor ?? 'system',
    message: a.event_message,
    document: a.document_title ?? '',
    ip: a.ip_address ?? '',
    time: stamp(a.created_at),
  })), [auditData]);

  const auditTotal = auditData?.total ?? 0;
  const auditPages = Math.max(1, Math.ceil(auditTotal / AUDIT_PAGE_SIZE));
  const auditFirst = auditTotal === 0 ? 0 : auditPage * AUDIT_PAGE_SIZE + 1;
  const auditLast = Math.min(auditTotal, (auditPage + 1) * AUDIT_PAGE_SIZE);
  const auditFiltered = Boolean(auditSearch) || auditType !== 'all' || auditActor !== 'all' || Boolean(auditFrom) || Boolean(auditTo);
  const clearAuditFilters = () => {
    setAuditQuery(''); setAuditType('all'); setAuditActor('all'); setAuditFrom(''); setAuditTo('');
  };

  const sortAudit = (key: 'time' | 'action' | 'document' | 'actor') =>
    setAuditSort(prev => (prev.key === key
      ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'time' ? 'desc' : 'asc' }));

  const auditTh = (align: 'left' | 'right' = 'left'): CSSProperties =>
    ({ textAlign: align, padding: '10px 14px', fontSize: '.6875rem', fontWeight: 600, color: '#64748b', whiteSpace: 'nowrap' });
  const auditTd: CSSProperties = { padding: '11px 14px', fontSize: '.75rem', verticalAlign: 'top', borderTop: '1px solid #eef1f6' };
  /** A header that is also the sort control; the arrow shows the active key. */
  const auditSortBtn: CSSProperties = { background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '4px' };
  const auditArrow = (key: 'time' | 'action' | 'document' | 'actor') =>
    auditSort.key === key ? (auditSort.dir === 'asc' ? '↑' : '↓') : '';
  const auditDate: CSSProperties = { ...inputStyle, flex: '0 0 auto', width: 'auto', minWidth: '140px' };
  const pagerBtn = (disabled: boolean): CSSProperties =>
    ({ ...btn('#fff', '#475569', '#e3e7ee'), opacity: disabled ? 0.45 : 1, cursor: disabled ? 'default' : 'pointer' });

  /** A saved signature drawn as it will appear.
   *
   *  An image when the server has one — through the session proxy, which is
   *  what carries the credentials for the `<img>` request. A drawn or
   *  uploaded signature whose image is missing is NOT rendered as typed text:
   *  showing handwriting the user never wrote misrepresents what is stored. */
  const signaturePreview = (row: SavedSignatureResponse) => {
    const src = row.preview_url ? proxyPath(row.preview_url) : null;
    if (src) return <img src={src} alt="" style={{ height:'34px', width:'auto', maxWidth:'160px', objectFit:'contain' }} />;
    if (row.signature_type === 'typed' && row.signature_text) {
      return (
        <span style={{ fontFamily: typeFaceStack(row.type_face), fontSize:'1.5rem', lineHeight:1.1, color:'#0f172a' }}>
          {row.signature_text}
        </span>
      );
    }
    return <span style={{ fontSize:'.6875rem', color:'#64748b', fontStyle:'italic' }}>No preview</span>;
  };

  /* Rendered as an ordinary screen inside the app shell. This used to be a
     `position: fixed` overlay with its own header, its own close button and
     its own sidebar listing the eleven sections — a second layout, and a
     second navigation system, for one branch of the same tree. The sections
     are rows in the shell's sidebar now (see `lib/sf/navigation.ts`). */
  return (
    <section data-screen-label="My account" style={{ display:'flex', minHeight:'100%' }}>
      <div style={{ flex:1, minWidth:0, padding:'24px 26px 44px' }}>
          {/* Most sections are a single column of prose-width panels; the
              audit table and the organization grid want the whole page, and
              profile sits between the two — two panels abreast. Whatever the
              width, the column is centred in the page rather than hugging the
              sidebar, so moving between sections does not shift the content. */}
          <div style={{ maxWidth: acAudit || acOrg ? 'none' : acProfile ? '1180px' : '760px', margin:'0 auto', width:'100%', display:'flex', flexDirection:'column', gap:'18px' }}>
            <div style={{ display:'flex', flexDirection:'column', gap:'4px' }}>
              <h2 style={{ margin:0, fontSize:'1.3125rem', fontWeight:700, letterSpacing:'-.5px' }}>{accountTitle}</h2>
              <span style={{ fontSize:'.78125rem', color:'#64748b', lineHeight:1.5 }}>{accountSub}</span>
            </div>

            {/* Adopt-a-signature. Same composer, same wording and the same
                consent line as the signing modal, so a signature adopted here
                is the one that appears on a document. */}
            {sigModalOpen ? (
              <div
                ref={sigDialogRef}
                role="dialog"
                aria-modal="true"
                aria-label="Adopt your signature"
                tabIndex={-1}
                data-sf-modal-open=""
                onKeyDown={(event) => { if (event.key === 'Escape') event.stopPropagation(); }}
                style={{ position:'fixed', inset:0, zIndex:80, background:'rgba(15,23,42,.55)', display:'grid', placeItems:'center', padding:'24px' }}>
                <div style={{ width:'680px', maxWidth:'100%', maxHeight:'90vh', overflowY:'auto', background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', boxShadow:'0 24px 60px rgba(15,23,42,.24)' }}>
                  <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:'14px', padding:'16px 18px', borderBottom:'1px solid #eef1f6' }}>
                    <div style={{ display:'flex', flexDirection:'column', gap:'3px' }}>
                      <span style={{ fontSize:'.9375rem', fontWeight:700, letterSpacing:'-.2px' }}>Adopt your signature</span>
                      <span style={{ fontSize:'.75rem', color:'#64748b' }}>Draw, type or upload the signature to save to your account</span>
                    </div>
                    <button
                      type="button" aria-label="Close" onClick={closeSigModal}
                      style={{ width:'30px', height:'30px', borderRadius:'9px', border:'1px solid #e3e7ee', background:'#fff', cursor:'pointer', color:'#475569', fontSize:'.8125rem', lineHeight:1 }}>
                      ✕
                    </button>
                  </div>
                  <div style={{ padding:'16px 18px', display:'flex', flexDirection:'column', gap:'14px' }}>
                    {/* No `saved` tab: this modal is where saved signatures
                        come from, so re-using one would adopt a duplicate. */}
                    <SignatureComposer accent={A} composeRef={composeRef} tabs={['draw', 'type', 'upload']} />
                    <div style={{ display:'flex', alignItems:'center', gap:'10px', borderTop:'1px solid #eef1f6', paddingTop:'13px' }}>
                      <span style={{ fontSize:'.6875rem', color:'#64748b', lineHeight:1.5, maxWidth:'420px' }}>
                        By selecting Adopt signature, I agree this signature and initials are the
                        electronic representation of my signature for all purposes.
                      </span>
                      <div style={{ marginLeft:'auto', display:'flex', gap:'8px' }}>
                        <button type="button" onClick={closeSigModal} style={ghostBtn}>Cancel</button>
                        <button
                          type="button" onClick={adoptSignature} disabled={savingSignature}
                          style={{ ...primaryBtn, opacity: savingSignature ? .5 : 1, cursor: savingSignature ? 'default' : 'pointer' }}>
                          {savingSignature ? 'Saving…' : 'Adopt signature'}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            ) : null}

            {acProfile ? (
              /* Full width, two panels abreast: the profile form and the
                 signature list are read together, and a single 760px column
                 left half the page empty while pushing signatures below the
                 fold. They stack again when there is no room for both. */
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(420px, 1fr))', alignItems:'start', gap:'14px' }}>
                <div style={card}>
                  <span style={railHead}>Profile</span>
                  <div style={{ display:'flex', alignItems:'center', gap:'14px', paddingBottom:'13px', borderBottom:'1px solid #f2f4f8' }}>
                    {/* The avatar is the control: clicking the thing you want
                        to change is the shortest path to changing it, and the
                        named button below it says so for anyone who would not
                        guess the picture is clickable. */}
                    <button
                      type="button" onClick={() => photoInput.current?.click()} disabled={savingPhoto}
                      aria-label={avatarSrc ? 'Change your profile photo' : 'Add a profile photo'}
                      style={{ width:'56px', height:'56px', borderRadius:'99px', background:'#0f172a', color:'#f8fafc', display:'grid', placeItems:'center', fontSize:'1.125rem', fontWeight:700, flex:'0 0 56px', padding:0, border:'none', overflow:'hidden', cursor: savingPhoto ? 'default' : 'pointer', opacity: savingPhoto ? .6 : 1 }}>
                      {avatarSrc
                        ? <img src={avatarSrc} alt="" style={{ width:'100%', height:'100%', objectFit:'cover' }} />
                        : userInitials}
                    </button>
                    <input
                      ref={photoInput} type="file" accept="image/png,image/jpeg" hidden
                      onChange={e => { pickPhoto(e.target.files?.[0] ?? null); e.target.value = ''; }}
                    />
                    <div style={{ display:'flex', flexDirection:'column', gap:'3px' }}>
                      <span style={{ fontSize:'.9375rem', fontWeight:700 }}>{userName}</span>
                      <span style={{ fontSize:'.75rem', color:'#64748b' }}>{joinMeta([userRole, me?.organization_name])}</span>
                      <span style={{ display:'flex', alignItems:'center', gap:'8px', marginTop:'2px' }}>
                        <button type="button" onClick={() => photoInput.current?.click()} disabled={savingPhoto} style={{ ...autoGhostBtn, marginLeft:0 }}>
                          {savingPhoto ? 'Saving…' : avatarSrc ? 'Change photo' : 'Add photo'}
                        </button>
                        {avatarSrc && !savingPhoto ? (
                          <button type="button" onClick={removePhoto} style={{ ...autoGhostBtn, marginLeft:0 }}>Remove</button>
                        ) : null}
                      </span>
                    </div>
                    <span style={{ ...pill(TONE_INDIGO), marginLeft:'auto' }}>{me?.status || 'active'}</span>
                  </div>
                  <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'11px' }}>
                    <label style={lblStyle}>Full name
                      <input type="text" value={profileValue('name')} onChange={e => editProfile('name', e.target.value)} style={inputStyle} />
                    </label>
                    {/* Email is changed under Email addresses, where the
                        verification round-trip lives; editing it here would
                        promise a change this form cannot complete. */}
                    <label style={lblStyle}>Email
                      <input type="text" value={userEmail} style={{ ...mono, background:'#f8fafc', color:'#475569' }} readOnly />
                    </label>
                    <label style={lblStyle}>Time zone
                      <input type="text" value={profileValue('timezone')} onChange={e => editProfile('timezone', e.target.value)} placeholder="e.g. Europe/London" style={mono} />
                    </label>
                    <label style={lblStyle}>Language
                      <input type="text" value={profileValue('locale')} onChange={e => editProfile('locale', e.target.value)} placeholder="e.g. en-GB" style={inputStyle} />
                    </label>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:'10px', borderTop:'1px solid #f2f4f8', paddingTop:'13px' }}>
                    <span style={{ fontSize:'.71875rem', color:'#64748b' }}>
                      {failed.me ? 'Your profile could not be loaded.' : 'Your email address is managed under Email addresses.'}
                    </span>
                    {profileDirty ? (
                      <button type="button" onClick={() => setProfileDraft(null)} style={autoGhostBtn}>Discard</button>
                    ) : null}
                    <button
                      type="button" onClick={saveProfile}
                      disabled={!profileDirty || savingProfile}
                      style={{ ...primaryBtn, marginLeft: profileDirty ? 0 : 'auto', opacity: profileDirty && !savingProfile ? 1 : .5, cursor: profileDirty && !savingProfile ? 'pointer' : 'default' }}>
                      {savingProfile ? 'Saving…' : 'Save changes'}
                    </button>
                  </div>
                </div>

                {/* Signatures. The default is the one every signing surface
                    offers first, so it is named on the row rather than left
                    to be inferred from the order of the list. */}
                <div style={card}>
                  <div style={{ display:'flex', alignItems:'flex-start', gap:'12px' }}>
                    <div style={{ display:'flex', flexDirection:'column', gap:'3px', maxWidth:'460px' }}>
                      <span style={railHead}>Signatures</span>
                      <span style={{ fontSize:'.71875rem', color:'#64748b', lineHeight:1.55 }}>
                        Adopted signatures you can reuse. The default is offered first
                        wherever you are asked to sign.
                      </span>
                    </div>
                    <button type="button" onClick={openSignatureModal} style={{ ...primaryBtn, marginLeft:'auto', flex:'0 0 auto' }}>
                      Add signature
                    </button>
                  </div>

                  {signatures === null ? (
                    <span style={{ fontSize:'.71875rem', color:'#64748b' }}>
                      {failed.signatures ? 'Your saved signatures could not be loaded.' : 'Loading signatures…'}
                    </span>
                  ) : signatures.length === 0 ? (
                    <div style={emptyBox}>
                      No signature adopted yet. Add one and it becomes your default.
                    </div>
                  ) : (
                    <div style={{ display:'flex', flexDirection:'column', gap:'9px' }}>
                      {signatures.map(row => (
                        <div
                          key={row.id}
                          style={{
                            display:'flex', alignItems:'center', gap:'14px', padding:'11px 13px',
                            border:'1px solid ' + (row.is_default ? A : '#eef1f6'), borderRadius:'12px',
                            background: row.is_default ? '#fbfcff' : '#fff',
                          }}>
                          <span style={{ flex:'0 0 auto', minWidth:'96px' }}>{signaturePreview(row)}</span>
                          <div style={{ display:'flex', flexDirection:'column', gap:'3px', minWidth:0 }}>
                            <span style={{ fontSize:'.78125rem', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{row.label}</span>
                            <span style={{ fontSize:'.6875rem', color:'#64748b' }}>
                              {joinMeta([
                                row.method || row.signature_type,
                                'adopted ' + stamp(row.adopted_at),
                                row.is_passkey_bound ? 'passkey-bound' : null,
                              ])}
                            </span>
                          </div>
                          <div style={{ display:'flex', alignItems:'center', gap:'12px', marginLeft:'auto', flex:'0 0 auto' }}>
                            {row.is_default
                              ? <span style={pill(TONE_GOOD)}>Default</span>
                              : <button type="button" onClick={() => makeDefaultSignature(row)} style={linkBtn}>Set as default</button>}
                            <button type="button" onClick={() => removeSignature(row)} style={btn('#fff', '#b91c1c', '#fecaca')}>Remove</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ) : null}

            {acSecurity ? (
              <div style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
                <div style={card}>
                  <span style={railHead}>Login and security</span>
                  <div style={{ display:'flex', alignItems:'center', gap:'12px', paddingBottom:'12px', borderBottom:'1px solid #f2f4f8' }}>
                    <div style={{ display:'flex', flexDirection:'column', gap:'2px' }}><span style={{ fontSize:'.75rem', color:'#64748b' }}>Email</span><span style={{ fontSize:'.8125rem', fontFamily:'var(--font-sans)' }}>{userEmail}</span></div>
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
                      <span style={{ fontSize:'.71875rem', color:'#3730a3', lineHeight:1.6, wordBreak:'break-all', fontFamily:'var(--font-sans)' }}>
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

                  <div style={{ display:'flex', flexDirection:'column', gap:'9px', borderTop:'1px solid #f2f4f8', paddingTop:'13px' }}>
                    <div style={{ display:'flex', alignItems:'flex-start', gap:'12px' }}>
                      <div style={{ display:'flex', flexDirection:'column', gap:'3px', maxWidth:'460px' }}>
                        <span style={{ fontSize:'.8125rem', fontWeight:600 }}>Single sign-on (SAML)</span>
                        <span style={{ fontSize:'.71875rem', color:'#64748b', lineHeight:1.55 }}>
                          {sso === null
                            ? (failed.sso ? 'Single sign-on settings could not be loaded.' : 'Not configured. Connect your identity provider to let your team sign in with it.')
                            : joinMeta([
                                sso.enabled ? 'connected to ' + sso.idp_entity_id : 'configured but off',
                                sso.allowed_email_domains,
                                sso.enforced ? 'required for everyone' : 'password sign-in still allowed',
                              ])}
                        </span>
                      </div>
                      <button type="button" onClick={configureSso} style={{ ...autoGhostBtn, marginLeft:'auto' }}>
                        {sso === null ? 'Connect' : 'Reconfigure'}
                      </button>
                    </div>
                    {sso ? (
                      <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
                        <span style={{ fontSize:'.71875rem', color:'#64748b', lineHeight:1.55, maxWidth:'460px' }}>
                          Require single sign-on. Password sign-in stops working for everyone in
                          this workspace, including you.
                        </span>
                        <button
                          type="button" role="switch"
                          aria-checked={sso.enforced}
                          aria-label="Require single sign-on"
                          onClick={toggleSsoEnforcement}
                          style={{ marginLeft:'auto', width:'38px', height:'21px', borderRadius:'99px', background: sso.enforced ? '#10b981' : BORDER_STRONG, border:'none', position:'relative', cursor:'pointer', flex:'0 0 38px' }}>
                          <span style={{ position:'absolute', top:'3px', left: sso.enforced ? '20px' : '3px', width:'15px', height:'15px', borderRadius:'99px', background:'#fff' }}></span>
                        </button>
                      </div>
                    ) : null}
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
                        <span style={{ fontSize:'.6875rem', color:'#64748b', fontFamily:'var(--font-sans)' }}>{d.meta}</span>
                      </div>
                      <button type="button" onClick={d.onRemove} style={autoDangerBtn}>{d.isCurrent ? 'Sign out here' : 'Sign out'}</button>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {acNotifications ? (
              <div style={{ display:'flex', flexDirection:'column', gap:'14px' }}>
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
                <div style={{ ...card, gap:'12px' }}>
                  <div style={{ display:'flex', flexDirection:'column', gap:'3px' }}>
                    <span style={{ fontSize:'.84375rem', fontWeight:600 }}>Account email</span>
                    <span style={{ fontSize:'.71875rem', color:'#64748b' }}>Where the events above are delivered</span>
                  </div>
                  <div style={{ display:'flex', alignItems:'center', gap:'12px', padding:'11px', border:'1px solid #eef1f6', borderRadius:'12px', background:'#fbfcfd', flexWrap:'wrap' }}>
                    <span style={{ fontSize:'.78125rem', fontFamily:'var(--font-sans)' }}>{userEmail}</span>
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
                          <span style={{ fontSize:'.75rem', fontFamily:'var(--font-sans)' }}>{addr}</span>
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
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap:'12px' }}>
                  {integrations.map(i => (
                    <div key={i.key} style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'14px', padding:'14px', display:'flex', flexDirection:'column', gap:'10px' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
                        <div style={{ display:'flex', flexDirection:'column', gap:'4px', minWidth:0 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                            <span style={{ fontSize:'.8125rem', fontWeight:600 }}>{i.label}</span>
                            <span style={i.pill}>{i.pillLabel}</span>
                          </div>
                          <span style={{ fontSize:'.71875rem', color:'#64748b', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{i.meta}</span>
                        </div>
                        <button type="button" onClick={i.onClick} style={{ ...i.ctaStyle, marginLeft:'auto', flex:'0 0 auto' }}>{i.ctaLabel}</button>
                      </div>
                      {i.export ? (
                        <div style={{ display:'flex', alignItems:'center', gap:'12px', paddingTop:'10px', borderTop:'1px solid #f2f4f8' }}>
                          <div style={{ display:'flex', flexDirection:'column', gap:'2px', minWidth:0 }}>
                            <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                              <span style={{ fontSize:'.71875rem', fontWeight:600, color:'#475569' }}>Export completed documents</span>
                              <span style={i.export.pill}>{i.export.pillLabel}</span>
                            </div>
                            <span style={{ fontSize:'.6875rem', color:'#64748b', fontFamily:'var(--font-sans)', whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{i.export.path}</span>
                          </div>
                          <button type="button" onClick={i.export.onToggle} style={{ ...autoGhostBtn, marginLeft:'auto', flex:'0 0 auto' }}>{i.export.ctaLabel}</button>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )
            ) : null}

            {acOrg ? (
              <div style={{ display:'flex', flexDirection:'column', gap:'18px' }}>

                {/* The organization itself. */}
                <div style={{ ...card, gap:'11px' }}>
                  <span style={railHead}>Organization</span>
                  {orgData === null ? (
                    <div style={emptyBox}>{failed.orgs ? 'Your organization could not be loaded.' : 'Loading…'}</div>
                  ) : (
                    <div style={{ display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap' }}>
                      <div style={{ display:'flex', flexDirection:'column', gap:'3px', minWidth:0 }}>
                        <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                          <span style={{ fontSize:'.84375rem', fontWeight:600 }}>{orgData.name}</span>
                          <span style={pill(TONE_GOOD)}>{userRole}</span>
                        </div>
                        <span style={{ fontSize:'.71875rem', color:'#64748b', fontFamily:'var(--font-sans)' }}>
                          {joinMeta([orgData.slug, orgData.region, orgData.seats_licensed + (orgData.seats_licensed === 1 ? ' seat' : ' seats')])}
                        </span>
                      </div>
                    </div>
                  )}
                  <span style={{ fontSize:'.71875rem', color:'#64748b', lineHeight:1.6 }}>
                    You belong to one organization. Membership of additional organizations is not
                    supported on this deployment.
                  </span>
                </div>

                {/* Everyone in it, and everyone invited into it. */}
                <div style={{ ...card, gap:'11px' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
                    <span style={railHead}>People{membersData?.length ? ' · ' + membersData.length : ''}</span>
                    {isOrgAdmin ? (
                      <button type="button" onClick={inviteMember} style={{ ...primaryBtn, marginLeft:'auto', flex:'0 0 auto' }}>Invite member</button>
                    ) : null}
                  </div>
                  {membersData === null ? (
                    <div style={emptyBox}>Loading the people in your organization…</div>
                  ) : failed.members ? (
                    <div style={emptyBox}>The member list could not be loaded. Nothing is listed rather than a partial list — retry before treating this as the whole organization.</div>
                  ) : membersData.length === 0 ? (
                    <div style={emptyBox}>No members recorded.</div>
                  ) : membersData.map(m => (
                    <div key={m.id} style={{ display:'flex', alignItems:'center', gap:'12px', padding:'8px 0', borderTop:'1px solid #f2f4f8' }}>
                      <div style={{ display:'flex', flexDirection:'column', gap:'1px', minWidth:0 }}>
                        <span style={{ fontSize:'.78125rem', fontWeight:600 }}>
                          {m.name}{m.id === me?.id ? ' · you' : ''}
                        </span>
                        <span style={{ fontSize:'.6875rem', color:'#64748b', fontFamily:'var(--font-sans)', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{m.email}</span>
                      </div>
                      {/* Role and its control sit together on the right: the
                          pill says what the row is, the link changes it. A
                          bordered button on every row read as one competing
                          call to action per person, for what is a rare edit. */}
                      <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:'10px', flex:'0 0 auto' }}>
                        <span style={pill(m.role === 'admin' ? TONE_GOOD : TONE_MUTED)}>{m.role}</span>
                        {isOrgAdmin && m.id !== me?.id ? (
                          <button type="button" onClick={() => { void changeMemberRole(m); }} style={linkBtn} aria-label={'Change role for ' + m.name}>Change</button>
                        ) : null}
                      </div>
                    </div>
                  ))}

                  {pendingInvites.length ? (
                    <div style={{ display:'flex', flexDirection:'column', gap:'9px', borderTop:'1px solid #f2f4f8', paddingTop:'13px' }}>
                      <span style={railHead}>Invited, not yet accepted</span>
                      {pendingInvites.map(i => (
                        <div key={i.id} style={{ display:'flex', alignItems:'center', gap:'12px' }}>
                          <div style={{ display:'flex', flexDirection:'column', gap:'1px', minWidth:0 }}>
                            <span style={{ fontSize:'.78125rem', fontWeight:600, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{i.email}</span>
                            <span style={{ fontSize:'.6875rem', color:'#64748b' }}>invited {stamp(i.created_at)} · expires {stamp(i.expires_at)}</span>
                          </div>
                          <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:'10px', flex:'0 0 auto' }}>
                            <span style={pill(TONE_MUTED)}>{i.role}</span>
                            {isOrgAdmin ? (
                              <button type="button" onClick={() => { void revokeInvite(i); }} style={{ ...linkBtn, color:'#b91c1c' }}>Revoke</button>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>

                {/* The teams inside it. A team is a sharing boundary: its
                    folders and their documents are visible to members only. */}
                <div style={{ ...card, gap:'11px' }}>
                  <div style={{ display:'flex', alignItems:'center', gap:'12px' }}>
                    <span style={railHead}>Teams{teams.length ? ' · ' + teams.length : ''}</span>
                    {isOrgAdmin ? (
                      <button type="button" onClick={createTeam} style={{ ...primaryBtn, marginLeft:'auto', flex:'0 0 auto' }}>Create team</button>
                    ) : null}
                  </div>
                  {teamsData === null ? (
                    <div style={emptyBox}>Loading teams…</div>
                  ) : teams.length === 0 ? (
                    <div style={emptyBox}>{failed.teams ? 'Teams could not be loaded.' : 'This organization has no teams yet.'}</div>
                  ) : teams.map(t => (
                    <div key={t.key} style={{ display:'flex', flexDirection:'column', gap:'9px', padding:'11px 0', borderTop:'1px solid #f2f4f8' }}>
                      <div style={{ display:'flex', alignItems:'center', gap:'12px', flexWrap:'wrap' }}>
                        <div style={{ display:'flex', flexDirection:'column', gap:'3px', minWidth:0 }}>
                          <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                            <span style={{ fontSize:'.84375rem', fontWeight:600 }}>{t.label}</span>
                            <span style={t.pill}>{t.role}</span>
                          </div>
                          {t.description ? (
                            <span style={{ fontSize:'.75rem', color:'#475569' }}>{t.description}</span>
                          ) : null}
                          <span style={{ fontSize:'.6875rem', color:'#64748b', fontFamily:'var(--font-sans)' }}>{t.counts}</span>
                        </div>
                        <button
                          type="button"
                          aria-expanded={t.open}
                          onClick={() => setOpenTeam(t.open ? null : t.key)}
                          style={autoGhostBtn}>
                          {t.open ? 'Hide members' : 'Manage members'}
                        </button>
                      </div>

                      {t.open ? (
                        <div style={{ display:'flex', flexDirection:'column', gap:'8px', paddingLeft:'11px', borderLeft:'2px solid #f2f4f8' }}>
                          {t.team.members.length === 0 ? (
                            <span style={{ fontSize:'.71875rem', color:'#64748b' }}>Nobody is in this team yet.</span>
                          ) : t.team.members.map(m => (
                            <div key={m.user_id} style={{ display:'flex', alignItems:'center', gap:'10px' }}>
                              <div style={{ display:'flex', flexDirection:'column', gap:'2px', minWidth:0 }}>
                                <div style={{ display:'flex', alignItems:'center', gap:'8px' }}>
                                  <span style={{ fontSize:'.75rem', fontWeight:600 }}>{m.name}</span>
                                  <span style={pill(m.role === 'lead' ? TONE_INDIGO : TONE_MUTED)}>{m.role}</span>
                                </div>
                                <span style={{ fontSize:'.6875rem', color:'#64748b', fontFamily:'var(--font-sans)' }}>{m.email}</span>
                              </div>
                              {isOrgAdmin ? (
                                <>
                                  <button type="button" onClick={() => { void changeTeamRole(t.team, m); }} style={autoGhostBtn}>Role</button>
                                  <button type="button" onClick={() => { void removeTeamMember(t.team, m); }} style={{ ...btn('#fff', '#b91c1c', '#fecaca'), flex:'0 0 auto' }}>Remove</button>
                                </>
                              ) : null}
                            </div>
                          ))}
                          {isOrgAdmin ? (
                            <div style={{ display:'flex', gap:'8px', flexWrap:'wrap', paddingTop:'2px' }}>
                              <button type="button" onClick={() => { void addTeamMember(t.team); }} style={ghostBtn}>Add member</button>
                              <button type="button" onClick={() => { void renameTeam(t.team); }} style={ghostBtn}>Rename team</button>
                              <button type="button" onClick={() => { void deleteTeam(t.team); }} style={btn('#fff', '#b91c1c', '#fecaca')}>Delete team</button>
                            </div>
                          ) : (
                            <span style={{ fontSize:'.6875rem', color:'#64748b' }}>Only an organization administrator can change who is in a team.</span>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {acAudit ? (
              auditData === null ? (
                <div style={emptyBox}>Loading your account audit log…</div>
              ) : failed.audit ? (
                <div style={emptyBox}>Your audit log could not be loaded. Nothing is shown rather than a partial record.</div>
              ) : (
                <div style={{ background:'#fff', border:'1px solid #e3e7ee', borderRadius:'16px', overflow:'hidden' }}>
                  <div style={{ padding:'12px 14px', borderBottom:'1px solid #eef1f6', display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap' }}>
                    <input
                      type="search"
                      value={auditQuery}
                      onChange={e => setAuditQuery(e.target.value)}
                      placeholder="Search events, documents, addresses…"
                      aria-label="Search the audit log"
                      style={{ ...inputStyle, flex:'1 1 240px', minWidth:'180px' }}
                    />
                    <select
                      value={auditType}
                      onChange={e => setAuditType(e.target.value)}
                      aria-label="Filter by event type"
                      style={{ ...inputStyle, flex:'0 0 auto', width:'auto' }}
                    >
                      <option value="all">All event types</option>
                      {(auditData.event_types ?? []).map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                    <select
                      value={auditActor}
                      onChange={e => setAuditActor(e.target.value)}
                      aria-label="Filter by user"
                      style={{ ...inputStyle, flex:'0 0 auto', width:'auto', maxWidth:'220px' }}
                    >
                      <option value="all">All users</option>
                      {(auditData.actors ?? []).map(a => <option key={a} value={a}>{a}</option>)}
                    </select>
                    <label style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'.6875rem', color:'#64748b' }}>
                      From
                      <input type="date" value={auditFrom} max={auditTo || undefined} onChange={e => setAuditFrom(e.target.value)} aria-label="Events from date" style={auditDate} />
                    </label>
                    <label style={{ display:'flex', alignItems:'center', gap:'6px', fontSize:'.6875rem', color:'#64748b' }}>
                      To
                      <input type="date" value={auditTo} min={auditFrom || undefined} onChange={e => setAuditTo(e.target.value)} aria-label="Events to date" style={auditDate} />
                    </label>
                    {auditFiltered ? (
                      <button type="button" onClick={clearAuditFilters} style={btn('#fff', '#475569', '#e3e7ee')}>Clear filters</button>
                    ) : null}
                  </div>
                  {audit.length === 0 ? (
                    <div style={{ padding:'28px 14px', textAlign:'center', fontSize:'.75rem', color:'#64748b' }}>
                      {auditFiltered ? 'No events match those filters.' : 'No account events have been recorded yet.'}
                    </div>
                  ) : (
                    <div style={{ overflowX:'auto', opacity: auditBusy ? 0.6 : 1, transition:'opacity .12s' }} aria-busy={auditBusy}>
                      <table style={{ width:'100%', borderCollapse:'collapse', tableLayout:'auto' }}>
                        <thead>
                          <tr style={{ background:'#fafbfc' }}>
                            <th scope="col" style={auditTh()}>
                              <button type="button" onClick={() => sortAudit('action')} style={auditSortBtn}>Event {auditArrow('action')}</button>
                            </th>
                            <th scope="col" style={auditTh()}>
                              <button type="button" onClick={() => sortAudit('actor')} style={auditSortBtn}>User {auditArrow('actor')}</button>
                            </th>
                            <th scope="col" style={auditTh()}>Details</th>
                            <th scope="col" style={auditTh()}>
                              <button type="button" onClick={() => sortAudit('document')} style={auditSortBtn}>Document {auditArrow('document')}</button>
                            </th>
                            <th scope="col" style={auditTh()}>IP address</th>
                            <th scope="col" style={auditTh('right')}>
                              <button type="button" onClick={() => sortAudit('time')} style={auditSortBtn}>Time {auditArrow('time')}</button>
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {audit.map(a => (
                            <tr key={a.key}>
                              <td style={{ ...auditTd, whiteSpace:'nowrap' }}>
                                <span style={{ display:'inline-flex', alignItems:'center', gap:'8px', fontWeight:600 }}>
                                  <span style={{ width:'8px', height:'8px', borderRadius:'99px', background:A, flex:'0 0 8px' }}></span>
                                  {a.action}
                                </span>
                              </td>
                              <td style={{ ...auditTd, color:'#64748b', fontFamily:'var(--font-sans)', fontSize:'.6875rem', whiteSpace:'nowrap' }}>{a.actor}</td>
                              <td style={{ ...auditTd, color:'#475569', lineHeight:1.6, minWidth:'240px' }}>{a.message}</td>
                              <td style={{ ...auditTd, color:'#475569' }}>{a.document || '—'}</td>
                              <td style={{ ...auditTd, color:'#64748b', fontFamily:'var(--font-sans)', fontSize:'.6875rem', whiteSpace:'nowrap' }}>{a.ip || '—'}</td>
                              <td style={{ ...auditTd, textAlign:'right', color:'#64748b', fontFamily:'var(--font-sans)', fontSize:'.6875rem', whiteSpace:'nowrap' }}>{a.time}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div style={{ padding:'11px 14px', borderTop:'1px solid #eef1f6', display:'flex', alignItems:'center', gap:'10px', flexWrap:'wrap' }}>
                    <span style={{ fontSize:'.6875rem', color:'#64748b' }}>
                      {auditTotal === 0
                        ? 'No events'
                        : 'Showing ' + auditFirst + '–' + auditLast + ' of ' + auditTotal + (auditFiltered ? ' matching events' : ' events')}
                    </span>
                    <div style={{ marginLeft:'auto', display:'flex', alignItems:'center', gap:'8px' }}>
                      <span style={{ fontSize:'.6875rem', color:'#64748b' }}>Page {auditPage + 1} of {auditPages}</span>
                      <button
                        type="button"
                        onClick={() => setAuditPage(p => Math.max(0, p - 1))}
                        disabled={auditPage === 0}
                        style={pagerBtn(auditPage === 0)}
                      >Previous</button>
                      <button
                        type="button"
                        onClick={() => setAuditPage(p => p + 1)}
                        disabled={auditPage + 1 >= auditPages}
                        style={pagerBtn(auditPage + 1 >= auditPages)}
                      >Next</button>
                    </div>
                  </div>
                </div>
              )
            ) : null}
        </div>
      </div>
    </section>
  );
}
