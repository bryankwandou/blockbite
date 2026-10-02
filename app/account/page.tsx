'use client';

/**
 * /account — bind recovery methods to a wallet and recover the off-chain
 * profile onto a new wallet. Order: passkey, recovery codes, email + password,
 * Google (only when the server has it configured). None of these need a
 * partner except Google. Secrets stay server-side; sessions are httpOnly
 * cookies scoped to /api/auth.
 */

import { useCallback, useEffect, useState } from 'react';
import bs58 from 'bs58';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import Navbar from '@/components/Navbar';
import { useT } from '@/lib/i18n';
import k from '@/components/PageKit.module.css';
import s from './account.module.css';

type Provider = 'google' | 'password';

interface Status {
  available: boolean;
  google: boolean;
  wallet: string | null;
  migratedTo: string | null;
  methods: { provider: Provider; email: string | null; createdMs: number }[];
  passkeys: { createdMs: number }[];
  codesLeft: number;
  recovery: { wallet: string; provider: string; email: string | null; cooldownLeftMs: number } | null;
}

const EMPTY: Status = { available: false, google: false, wallet: null, migratedTo: null, methods: [], passkeys: [], codesLeft: 0, recovery: null };
const short = (w: string) => `${w.slice(0, 4)}…${w.slice(-4)}`;

// ── WebAuthn JSON <-> ArrayBuffer ───────────────────────────────────
const fromB64u = (v: string) => {
  const b = atob(v.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((v.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0)).buffer;
};
const toB64u = (buf: ArrayBuffer) => {
  let str = '';
  new Uint8Array(buf).forEach((x) => { str += String.fromCharCode(x); });
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};
const passkeySupported = () => typeof window !== 'undefined' && 'PublicKeyCredential' in window && !!navigator.credentials;

export default function AccountPage() {
  const t = useT('account');
  const { publicKey, signMessage } = useWallet();
  const { setVisible } = useWalletModal();
  const [st, setSt] = useState<Status | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [pkOk, setPkOk] = useState(false);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [bindEmail, setBindEmail] = useState('');
  const [bindPw, setBindPw] = useState('');
  const [logEmail, setLogEmail] = useState('');
  const [logPw, setLogPw] = useState('');
  const [codeWallet, setCodeWallet] = useState('');
  const [code, setCode] = useState('');

  const refresh = useCallback(async () => {
    try {
      const r = await fetch('/api/auth/status', { cache: 'no-store' });
      setSt({ ...EMPTY, ...((await r.json()) as Partial<Status>) });
    } catch {
      setSt(EMPTY);
    }
  }, []);

  useEffect(() => {
    setPkOk(passkeySupported());
    refresh();
    const q = new URLSearchParams(window.location.search);
    const ok = q.get('ok');
    const err = q.get('err');
    if (ok && t(`ok_${ok}`) !== `ok_${ok}`) setMsg({ ok: true, text: t(`ok_${ok}`) });
    else if (err) setMsg({ ok: false, text: errText(err) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refresh]);

  const errText = (c: unknown) => {
    const key = `err_${String(c ?? 'generic')}`;
    const s2 = t(key);
    return s2 === key ? t('err_generic') : s2;
  };

  async function signed(action: string): Promise<{ wallet: string; message: string; signature: string } | null> {
    if (!publicKey) { setVisible(true); return null; }
    if (!signMessage) { setMsg({ ok: false, text: t('no_sign') }); return null; }
    const wallet = publicKey.toBase58();
    const r = await fetch(`/api/auth/challenge?wallet=${wallet}&action=${encodeURIComponent(action)}`, { cache: 'no-store' });
    if (!r.ok) throw new Error('unavailable');
    const { message } = (await r.json()) as { message: string };
    const sig = await signMessage(new TextEncoder().encode(message));
    return { wallet, message, signature: bs58.encode(sig) };
  }

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch {
      setMsg({ ok: false, text: t('err_generic') });
    } finally {
      setBusy(false);
      refresh();
    }
  }

  async function post(url: string, data: unknown) {
    const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });
    const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: r.ok, j };
  }

  const manage = () => run(async () => {
    const p = await signed('manage');
    if (!p) return;
    const { ok } = await post('/api/auth/wallet', p);
    if (!ok) setMsg({ ok: false, text: t('err_bad_signature') });
  });

  // ── passkey
  const bindPasskey = () => run(async () => {
    const o = await post('/api/auth/passkey/options', { mode: 'bind' });
    if (!o.ok) { setMsg({ ok: false, text: errText(o.j.code) }); return; }
    const pk = o.j.publicKey as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    let cred: PublicKeyCredential | null = null;
    try {
      cred = (await navigator.credentials.create({
        publicKey: {
          ...pk,
          challenge: fromB64u(pk.challenge),
          user: { ...pk.user, id: fromB64u(pk.user.id) },
          excludeCredentials: (pk.excludeCredentials ?? []).map((c: { type: 'public-key'; id: string }) => ({ ...c, id: fromB64u(c.id) })),
        } as PublicKeyCredentialCreationOptions,
      })) as PublicKeyCredential | null;
    } catch {
      setMsg({ ok: false, text: t('err_passkey_cancelled') });
      return;
    }
    if (!cred) return;
    const r = cred.response as AuthenticatorAttestationResponse;
    const { ok, j } = await post('/api/auth/passkey/register', {
      clientDataJSON: toB64u(r.clientDataJSON), attestationObject: toB64u(r.attestationObject),
    });
    setMsg(ok ? { ok: true, text: t('ok_passkey_bound') } : { ok: false, text: errText(j.code) });
  });

  const loginPasskey = () => run(async () => {
    const o = await post('/api/auth/passkey/options', { mode: 'recover' });
    if (!o.ok) { setMsg({ ok: false, text: errText(o.j.code) }); return; }
    const pk = o.j.publicKey as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    let cred: PublicKeyCredential | null = null;
    try {
      cred = (await navigator.credentials.get({
        publicKey: { ...pk, challenge: fromB64u(pk.challenge), allowCredentials: [] } as PublicKeyCredentialRequestOptions,
      })) as PublicKeyCredential | null;
    } catch {
      setMsg({ ok: false, text: t('err_passkey_cancelled') });
      return;
    }
    if (!cred) return;
    const r = cred.response as AuthenticatorAssertionResponse;
    const { ok, j } = await post('/api/auth/passkey/login', {
      id: toB64u(cred.rawId), clientDataJSON: toB64u(r.clientDataJSON),
      authenticatorData: toB64u(r.authenticatorData), signature: toB64u(r.signature),
    });
    if (!ok) setMsg({ ok: false, text: errText(j.code) });
  });

  // ── recovery codes
  const makeCodes = () => run(async () => {
    const { ok, j } = await post('/api/auth/codes', {});
    if (ok) setNewCodes(j.codes as string[]);
    else setMsg({ ok: false, text: errText(j.code) });
  });

  const loginCode = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const { ok, j } = await post('/api/auth/codes/login', { wallet: codeWallet, code });
      setCode('');
      if (!ok) setMsg({ ok: false, text: errText(j.code) });
    });
  };

  // ── email + password
  const bindPassword = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const { ok, j } = await post('/api/auth/email', { email: bindEmail, password: bindPw });
      setMsg(ok ? { ok: true, text: t('ok_email_bound') } : { ok: false, text: errText(j.code) });
      if (ok) setBindPw('');
    });
  };

  const login = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const { ok, j } = await post('/api/auth/login', { email: logEmail, password: logPw });
      setLogPw('');
      if (!ok) setMsg({ ok: false, text: errText(j.code) });
    });
  };

  const unbind = (provider: Provider | 'passkey' | 'codes') => run(async () => {
    const p = await signed(`unbind:${provider}`);
    if (!p) return;
    const { ok, j } = await post('/api/auth/unbind', { ...p, provider });
    if (ok && provider === 'codes') setNewCodes(null);
    setMsg(ok ? { ok: true, text: t('ok_unbound') } : { ok: false, text: errText(j.code) });
  });

  const move = () => run(async () => {
    if (!st?.recovery) return;
    const p = await signed(`migrate:${st.recovery.wallet}`);
    if (!p) return;
    const { ok, j } = await post('/api/auth/recover', p);
    setMsg(ok ? { ok: true, text: t('done_move', { wallet: short(p.wallet) }) } : { ok: false, text: errText(j.code) });
  });

  const signOut = () => run(async () => { setNewCodes(null); await fetch('/api/auth/wallet', { method: 'DELETE' }); });

  const me = publicKey?.toBase58() ?? null;
  const managing = st?.wallet && st.wallet === me ? st.wallet : null;
  const rec = st?.recovery ?? null;
  const pw = st?.methods.find((m) => m.provider === 'password') ?? null;
  const gg = st?.methods.find((m) => m.provider === 'google') ?? null;
  const date = (ms: number) => new Date(ms).toLocaleDateString();

  return (
    <>
      <Navbar />
      <main className={k.page}>
        <header className={k.head}>
          <div className={`${k.wrap} ${k.narrow} ${k.headInner}`}>
            <span className={k.kicker}>{t('kicker')}</span>
            <h1 className={k.title}>{t('title')}</h1>
            <p className={k.lede}>{t('lede_v2')}</p>
          </div>
        </header>

        <div className={`${k.wrap} ${k.narrow}`}>
          <section className={k.section}>
            <div className={`${k.card} ${s.truth}`}>
              <h2 className={s.truthTitle}>{t('truth_title')}</h2>
              <p className={k.body}>{t('truth_text')}</p>
            </div>
          </section>

          {msg && <p className={msg.ok ? k.msgOk : k.msgErr} role="status">{msg.text}</p>}
          {st && !st.available && <p className={k.msgErr} role="status">{t('unavailable')}</p>}

          <section className={k.section}>
            <h2 className={k.h2}>{t('methods')}</h2>
            <div className={k.card}>
              {!managing ? (
                <div className={s.stack}>
                  <p className={k.body}>{t('methods_desc')}</p>
                  <div className={k.row}>
                    {!publicKey ? (
                      <button className={k.btn} onClick={() => setVisible(true)}>{t('connect_wallet')}</button>
                    ) : (
                      <button className={k.btn} onClick={manage} disabled={busy || !st?.available}>{busy ? t('signing') : t('sign_manage')}</button>
                    )}
                  </div>
                </div>
              ) : (
                <div className={s.stack}>
                  <div className={k.row}>
                    <p className={k.body}>{t('managing', { wallet: short(managing) })}</p>
                    <button className={k.btnGhost} onClick={signOut} disabled={busy}>{t('sign_out')}</button>
                  </div>
                  {st?.migratedTo && <p className={k.body}>{t('migrated_away', { wallet: short(st.migratedTo) })}</p>}

                  <ul className={s.list}>
                    {/* 1. Passkey */}
                    <li className={s.item}>
                      <span className={s.itemText}>
                        <strong>{t('passkey')}</strong>
                        <br /><span className={k.dim}>
                          {st && st.passkeys.length > 0 ? t('passkey_count', { n: st.passkeys.length }) : t('passkey_desc')}
                        </span>
                      </span>
                      <span className={k.row}>
                        {pkOk
                          ? <button className={k.btn} onClick={bindPasskey} disabled={busy}>{t('bind_passkey')}</button>
                          : <span className={k.dim}>{t('passkey_unsupported')}</span>}
                        {st && st.passkeys.length > 0 && <button className={k.btnGhost} onClick={() => unbind('passkey')} disabled={busy}>{t('unbind')}</button>}
                      </span>
                    </li>

                    {/* 2. Recovery codes */}
                    <li className={s.item}>
                      <span className={s.itemText}>
                        <strong>{t('codes')}</strong>
                        <br /><span className={k.dim}>{st && st.codesLeft > 0 ? t('codes_left', { n: st.codesLeft }) : t('codes_desc')}</span>
                      </span>
                      <span className={k.row}>
                        <button className={st && st.codesLeft > 0 ? k.btnGhost : k.btn} onClick={makeCodes} disabled={busy}>
                          {st && st.codesLeft > 0 ? t('codes_regenerate') : t('codes_generate')}
                        </button>
                        {st && st.codesLeft > 0 && <button className={k.btnGhost} onClick={() => unbind('codes')} disabled={busy}>{t('unbind')}</button>}
                      </span>
                    </li>
                    {newCodes && (
                      <li className={`${s.item} ${s.codesBox}`}>
                        <div className={s.stack}>
                          <p className={k.body}><strong>{t('codes_once')}</strong></p>
                          <ol className={s.codes}>{newCodes.map((c) => <li key={c} className={s.mono}>{c}</li>)}</ol>
                          <div className={k.row}>
                            <button className={k.btnGhost} onClick={() => navigator.clipboard?.writeText(newCodes.join('\n'))}>{t('codes_copy')}</button>
                            <button className={k.btn} onClick={() => setNewCodes(null)}>{t('codes_saved')}</button>
                          </div>
                        </div>
                      </li>
                    )}

                    {/* 3. Email + password */}
                    <li className={s.item}>
                      <span className={s.itemText}>
                        <strong>{t('password')}</strong>
                        {pw ? <>{` · ${pw.email}`}<br /><span className={k.dim}>{t('bound_on', { date: date(pw.createdMs) })}</span></> : null}
                      </span>
                      {pw && <button className={k.btnGhost} onClick={() => unbind('password')} disabled={busy}>{t('unbind')}</button>}
                      {!pw && (
                        <form className={s.form} onSubmit={bindPassword}>
                          <label className={s.label}>{t('email')}
                            <input className={s.input} type="email" autoComplete="email" required value={bindEmail} onChange={(e) => setBindEmail(e.target.value)} />
                          </label>
                          <label className={s.label}>{t('password_label')}
                            <input className={s.input} type="password" autoComplete="new-password" required minLength={10} value={bindPw} onChange={(e) => setBindPw(e.target.value)} />
                          </label>
                          <div className={k.row}><button className={k.btn} type="submit" disabled={busy}>{t('bind_email')}</button></div>
                        </form>
                      )}
                    </li>

                    {/* 4. Google: only when configured (or still bound from before) */}
                    {(st?.google || gg) && (
                      <li className={s.item}>
                        <span className={s.itemText}>
                          <strong>{t('google')}</strong>
                          {gg ? <>{` · ${gg.email}`}<br /><span className={k.dim}>{t('bound_on', { date: date(gg.createdMs) })}</span></> : null}
                        </span>
                        {gg
                          ? <button className={k.btnGhost} onClick={() => unbind('google')} disabled={busy}>{t('unbind')}</button>
                          : <a className={k.btn} href="/api/auth/google/start?mode=bind">{t('bind_google')}</a>}
                      </li>
                    )}
                  </ul>
                </div>
              )}
            </div>
          </section>

          <section className={k.section}>
            <h2 className={k.h2}>{t('recover')}</h2>
            <div className={k.card}>
              <div className={s.stack}>
                <p className={k.body}>{t('recover_desc')}</p>
                {!rec ? (
                  <>
                    <div className={s.stack}>
                      <h3 className={s.h3}>{t('passkey')}</h3>
                      {pkOk
                        ? <div className={k.row}><button className={k.btn} onClick={loginPasskey} disabled={busy || !st?.available}>{t('sign_in_passkey')}</button></div>
                        : <p className={k.dim}>{t('passkey_unsupported')}</p>}
                    </div>

                    <form className={s.form} onSubmit={loginCode}>
                      <h3 className={s.h3}>{t('codes')}</h3>
                      <label className={s.label}>{t('code_wallet')}
                        <input className={`${s.input} ${s.mono}`} type="text" autoComplete="off" spellCheck={false} required value={codeWallet} onChange={(e) => setCodeWallet(e.target.value)} />
                      </label>
                      <label className={s.label}>{t('code_label')}
                        <input className={`${s.input} ${s.mono}`} type="text" autoComplete="one-time-code" spellCheck={false} required placeholder="ABCD-EFGH-JKMN-PQRS" value={code} onChange={(e) => setCode(e.target.value)} />
                      </label>
                      <div className={k.row}><button className={k.btn} type="submit" disabled={busy || !st?.available}>{t('sign_in_code')}</button></div>
                    </form>

                    <form className={s.form} onSubmit={login}>
                      <h3 className={s.h3}>{t('password')}</h3>
                      <label className={s.label}>{t('email')}
                        <input className={s.input} type="email" autoComplete="username" required value={logEmail} onChange={(e) => setLogEmail(e.target.value)} />
                      </label>
                      <label className={s.label}>{t('password_label')}
                        <input className={s.input} type="password" autoComplete="current-password" required value={logPw} onChange={(e) => setLogPw(e.target.value)} />
                      </label>
                      <div className={k.row}><button className={k.btn} type="submit" disabled={busy || !st?.available}>{t('sign_in_email')}</button></div>
                    </form>

                    {st?.google && (
                      <div className={s.stack}>
                        <h3 className={s.h3}>{t('google')}</h3>
                        <div className={k.row}><a className={k.btnGhost} href="/api/auth/google/start?mode=recover">{t('sign_in_google')}</a></div>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <p className={k.body}>{t('recover_from', { wallet: short(rec.wallet) })}{rec.email ? ` (${rec.email})` : ''}</p>
                    {rec.cooldownLeftMs > 0 && <p className={k.body}>{t('recover_cooldown', { hours: Math.ceil(rec.cooldownLeftMs / 3_600_000) })}</p>}
                    {!publicKey && (
                      <>
                        <p className={k.body}>{t('recover_connect')}</p>
                        <div className={k.row}><button className={k.btn} onClick={() => setVisible(true)}>{t('connect_wallet')}</button></div>
                      </>
                    )}
                    {me && me === rec.wallet && <p className={k.body}>{t('recover_same')}</p>}
                    {me && me !== rec.wallet && (
                      <div className={k.row}>
                        <button className={k.btn} onClick={move} disabled={busy || rec.cooldownLeftMs > 0}>{t('recover_move', { wallet: short(me) })}</button>
                      </div>
                    )}
                    <div className={k.row}><button className={k.btnGhost} onClick={signOut} disabled={busy}>{t('sign_out')}</button></div>
                  </>
                )}
                <p className={k.dim}>{t('email_notice')}</p>
              </div>
            </div>
          </section>
        </div>
      </main>
    </>
  );
}
