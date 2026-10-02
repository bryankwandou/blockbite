/**
 * Minimal WebAuthn (passkey) verification with node:crypto only (server only, no I/O).
 * Supports attestation fmt "none", COSE algs ES256 (-7, P-256) and RS256 (-257).
 * Checks: clientData type, challenge, origin, rpIdHash, UP flag, signCount.
 */

import { createHash, createPublicKey, verify, type KeyObject } from 'node:crypto';
import { same } from './core';

export const ALG_ES256 = -7;
export const ALG_RS256 = -257;

// ── Minimal CBOR decoder (definite lengths; what WebAuthn uses) ─────

export type Cbor = number | bigint | string | Buffer | boolean | null | undefined | Cbor[] | Map<Cbor, Cbor>;

export function cborDecode(buf: Buffer, offset = 0): { value: Cbor; end: number } {
  let p = offset;
  const need = (n: number) => { if (p + n > buf.length) throw new Error('cbor_eof'); };
  const item = (depth: number): Cbor => {
    if (depth > 16) throw new Error('cbor_depth');
    need(1);
    const ib = buf[p++];
    const major = ib >> 5;
    const info = ib & 31;
    let len: number;
    if (info < 24) len = info;
    else if (info === 24) { need(1); len = buf[p]; p += 1; }
    else if (info === 25) { need(2); len = buf.readUInt16BE(p); p += 2; }
    else if (info === 26) { need(4); len = buf.readUInt32BE(p); p += 4; }
    else if (info === 27) {
      need(8);
      const big = buf.readBigUInt64BE(p); p += 8;
      if (big > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('cbor_big');
      len = Number(big);
    } else throw new Error('cbor_indefinite');
    switch (major) {
      case 0: return len;
      case 1: return -1 - len;
      case 2: { need(len); const b = Buffer.from(buf.subarray(p, p + len)); p += len; return b; }
      case 3: { need(len); const s = buf.toString('utf8', p, p + len); p += len; return s; }
      case 4: { const a: Cbor[] = []; for (let i = 0; i < len; i++) a.push(item(depth + 1)); return a; }
      case 5: {
        const m = new Map<Cbor, Cbor>();
        for (let i = 0; i < len; i++) { const key = item(depth + 1); m.set(key, item(depth + 1)); }
        return m;
      }
      case 7:
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        if (info === 23) return undefined;
        throw new Error('cbor_simple');
      default: throw new Error('cbor_tag');
    }
  };
  const value = item(0);
  return { value, end: p };
}

// ── COSE key → node KeyObject ───────────────────────────────────────

export function coseToKey(cose: Cbor): { key: KeyObject; alg: number } {
  if (!(cose instanceof Map)) throw new Error('cose');
  const kty = cose.get(1);
  const alg = cose.get(3);
  if (kty === 2 && alg === ALG_ES256) {
    const x = cose.get(-2);
    const y = cose.get(-3);
    if (cose.get(-1) !== 1 || !Buffer.isBuffer(x) || !Buffer.isBuffer(y) || x.length !== 32 || y.length !== 32) throw new Error('cose_ec');
    return { key: createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: x.toString('base64url'), y: y.toString('base64url') }, format: 'jwk' }), alg };
  }
  if (kty === 3 && alg === ALG_RS256) {
    const n = cose.get(-1);
    const e = cose.get(-2);
    if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e) || n.length < 256) throw new Error('cose_rsa');
    return { key: createPublicKey({ key: { kty: 'RSA', n: n.toString('base64url'), e: e.toString('base64url') }, format: 'jwk' }), alg };
  }
  throw new Error('cose_alg');
}

// ── authenticatorData ───────────────────────────────────────────────

export const FLAG_UP = 0x01;
export const FLAG_UV = 0x04;
export const FLAG_AT = 0x40;

export interface AuthData {
  rpIdHash: Buffer; flags: number; signCount: number;
  credentialId?: Buffer; cose?: Cbor;
}

export function parseAuthData(ad: Buffer): AuthData {
  if (ad.length < 37) throw new Error('authdata_short');
  const out: AuthData = { rpIdHash: ad.subarray(0, 32), flags: ad[32], signCount: ad.readUInt32BE(33) };
  if (out.flags & FLAG_AT) {
    if (ad.length < 55) throw new Error('authdata_short');
    const idLen = ad.readUInt16BE(53);
    if (idLen < 16 || idLen > 1023 || ad.length < 55 + idLen) throw new Error('authdata_credid');
    out.credentialId = Buffer.from(ad.subarray(55, 55 + idLen));
    out.cose = cborDecode(ad, 55 + idLen).value;
  }
  return out;
}

// ── clientDataJSON ──────────────────────────────────────────────────

const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest();

function checkClientData(raw: Buffer, type: string, challenge: string, origin: string): void {
  let cd: { type?: unknown; challenge?: unknown; origin?: unknown; crossOrigin?: unknown };
  try { cd = JSON.parse(raw.toString('utf8')); } catch { throw new Error('client_data'); }
  if (cd.type !== type) throw new Error('type');
  if (typeof cd.challenge !== 'string' || !same(cd.challenge, challenge)) throw new Error('challenge');
  if (cd.origin !== origin) throw new Error('origin');
  if (cd.crossOrigin === true) throw new Error('cross_origin');
}

function checkRp(a: AuthData, rpId: string): void {
  if (!same(a.rpIdHash, sha256(rpId))) throw new Error('rp_id');
  if (!(a.flags & FLAG_UP)) throw new Error('user_presence');
}

export interface Expect { challenge: string; origin: string; rpId: string }

export interface NewCredential { credentialId: string; publicKey: string; alg: number; signCount: number }

/** Verifies a navigator.credentials.create() result (fmt "none"). Throws a short reason code. */
export function verifyRegistration(
  r: { clientDataJSON: string; attestationObject: string }, exp: Expect,
): NewCredential {
  const cdj = Buffer.from(String(r.clientDataJSON ?? ''), 'base64url');
  checkClientData(cdj, 'webauthn.create', exp.challenge, exp.origin);
  const att = cborDecode(Buffer.from(String(r.attestationObject ?? ''), 'base64url')).value;
  if (!(att instanceof Map)) throw new Error('attestation');
  if (att.get('fmt') !== 'none') throw new Error('fmt');
  const ad = att.get('authData');
  if (!Buffer.isBuffer(ad)) throw new Error('attestation');
  const a = parseAuthData(ad);
  checkRp(a, exp.rpId);
  if (!a.credentialId || a.cose === undefined) throw new Error('no_credential');
  const { key, alg } = coseToKey(a.cose);
  return {
    credentialId: a.credentialId.toString('base64url'),
    publicKey: (key.export({ format: 'der', type: 'spki' }) as Buffer).toString('base64url'),
    alg, signCount: a.signCount,
  };
}

/** Verifies a navigator.credentials.get() result; returns the new signCount. Throws a short reason code. */
export function verifyAssertion(
  r: { clientDataJSON: string; authenticatorData: string; signature: string },
  cred: { publicKey: string; alg: number; signCount: number },
  exp: Expect,
): number {
  const cdj = Buffer.from(String(r.clientDataJSON ?? ''), 'base64url');
  checkClientData(cdj, 'webauthn.get', exp.challenge, exp.origin);
  const ad = Buffer.from(String(r.authenticatorData ?? ''), 'base64url');
  const a = parseAuthData(ad);
  checkRp(a, exp.rpId);
  const key = createPublicKey({ key: Buffer.from(cred.publicKey, 'base64url'), format: 'der', type: 'spki' });
  const data = Buffer.concat([ad, sha256(cdj)]);
  const sig = Buffer.from(String(r.signature ?? ''), 'base64url');
  const algName = cred.alg === ALG_ES256 ? 'sha256' : cred.alg === ALG_RS256 ? 'RSA-SHA256' : null;
  let ok = false;
  try { ok = Boolean(algName) && verify(algName!, data, key, sig); } catch { ok = false; }
  if (!ok) throw new Error('signature');
  // A counter that does not grow means a possibly cloned authenticator; 0/0 means it has no counter.
  if ((a.signCount !== 0 || cred.signCount !== 0) && a.signCount <= cred.signCount) throw new Error('sign_count');
  return a.signCount;
}
