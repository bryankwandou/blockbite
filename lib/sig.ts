/**
 * Ed25519 wallet signature verification via Web Crypto API (Node 18+).
 * Uses Buffer.from() to satisfy TypeScript's strict BufferSource typing.
 */
import { PublicKey } from '@solana/web3.js';

export async function verifySig(
  addr: string,
  message: string,
  signatureBase64: string,
): Promise<boolean> {
  try {
    // Buffer.from() returns Uint8Array<ArrayBuffer> — satisfies SubtleCrypto's BufferSource
    const msgBytes = Buffer.from(message, 'utf8');
    const sigBytes = Buffer.from(signatureBase64, 'base64');
    const pubkeyBytes = Buffer.from(new PublicKey(addr).toBytes());

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      pubkeyBytes,
      { name: 'Ed25519' },
      false,
      ['verify'],
    );

    return await crypto.subtle.verify('Ed25519', cryptoKey, sigBytes, msgBytes);
  } catch {
    return false;
  }
}
