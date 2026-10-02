/**
 * Computes one prize round and, with --send, posts it to the prize program.
 *
 *   npx tsx --env-file=.env.local scripts/post-results.ts day 2026-10-01           dry run
 *   npx tsx --env-file=.env.local scripts/post-results.ts month 2026-10 --send     post it
 *
 * Env
 *   blockbite_DATABASE_URL or RANKED_DATABASE_URL, RANKED_DB_SCHEMA   the Ranked database
 *   PRIZE_POSTER_KEY   secret key of the POSTER hot key (base58, or a JSON byte array).
 *                      Read only with --send. Never printed, logged or stored; keep it
 *                      in the environment, never in a file in this repo.
 *   PRIZE_RPC_URL      RPC to read and send through (default: NEXT_PUBLIC_RPC_URL or
 *                      public mainnet, see lib/solana/config.ts)
 *
 * The dry run writes nothing and sends nothing: it prints the pool, the
 * winners (with speed-review flags), the merkle root, and whether the vault
 * can cover the round.
 * --send stores the round first (once: a stored round is never recomputed),
 * checks the vault's unpromised USDC covers it, sends PostResults signed by
 * POSTER, and records the signature and the on-chain posting time. Claims
 * open 24 h later unless the team vetoes the round.
 * Re-running is safe. A round already on-chain with the stored root is only
 * recorded; one with a different root stops the script.
 */
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import bs58 from 'bs58';

import { USDC_DECIMALS, USDC_UNIT } from '../lib/ranked/config';

const usdc = (x: bigint) => `${x / USDC_UNIT}.${(x % USDC_UNIT).toString().padStart(USDC_DECIMALS, '0')} USDC`;

/** The POSTER keypair from the environment. Errors never quote the key. */
function posterKey(expected: PublicKey): Keypair {
  const raw = process.env.PRIZE_POSTER_KEY?.trim();
  if (!raw) throw new Error('PRIZE_POSTER_KEY is not set');
  let kp: Keypair;
  try {
    kp = Keypair.fromSecretKey(raw.startsWith('[') ? Uint8Array.from(JSON.parse(raw) as number[]) : bs58.decode(raw));
  } catch {
    throw new Error('PRIZE_POSTER_KEY is not a valid secret key (base58 or JSON byte array)');
  }
  if (!kp.publicKey.equals(expected)) {
    throw new Error(`PRIZE_POSTER_KEY is the key of ${kp.publicKey.toBase58()}, not the pinned poster ${expected.toBase58()}`);
  }
  return kp;
}

async function main() {
  const args = process.argv.slice(2);
  const send = args.includes('--send');
  const [kind, period] = args.filter((a) => !a.startsWith('--'));
  if ((kind !== 'day' && kind !== 'month') || !period) {
    throw new Error('usage: post-results.ts day YYYY-MM-DD | month YYYY-MM [--send]');
  }

  const results = await import('../lib/ranked/results');
  const db = await import('../lib/ranked/db');
  const cfg = await import('../lib/ranked/config');
  const pix = await import('../lib/ranked/prize-ix');
  const { RPC_URL } = await import('../lib/solana/config');

  // ── What the round pays ────────────────────────────────────────────
  const roundId = results.roundIdOf(kind, period);
  const roundPda = pix.roundAddress(roundId);
  const stored = await db.getRound(roundId);
  const plan = stored ? null : await results.computeRound(kind, period);
  const leaves = stored?.leaves ?? (plan ? results.leavesOf(plan) : []);
  const total = stored?.total ?? plan!.total;

  console.log(`${kind} ${period}  round ${roundId}  account ${roundPda.toBase58()}`);
  if (stored) {
    console.log(`stored round (computed earlier, never recomputed); posted: ${stored.postedSig ?? 'not yet'}`);
  } else {
    console.log(`pool ${usdc(plan!.pool)}  promised ${usdc(plan!.total)}  unallocated ${usdc(plan!.unallocated)}`);
  }
  const { from, to } = results.periodSpan(kind, period);
  const flags = await db.flagsOf(leaves.map((l) => l.w), from, to);
  leaves.forEach((l, i) => {
    const f = flags.get(l.w);
    console.log(`  #${String(l.r).padStart(2)}  leaf ${String(i).padStart(2)}  ${l.w.padEnd(44)}  score ${l.s}  ${usdc(BigInt(l.a))}${f ? `  FLAGGED x${f}` : ''}`);
  });
  if (leaves.length === 0 || total === 0n) {
    console.log('nothing to pay: no round to post');
    return;
  }
  if (stored) results.treeOf(stored); // stored root and total must match the stored leaves
  const rootHex = stored?.root ?? results.rootOfLeaves(roundId, leaves);
  console.log(`root ${rootHex}  leaves ${leaves.length}`);

  // ── What the chain says ────────────────────────────────────────────
  const conn = new Connection(process.env.PRIZE_RPC_URL || RPC_URL, 'confirmed');
  let chain: { free: bigint; onchainRoot: string | null; postedMs: number | null; stateLamports: number | null; roundLamports: number } | null = null;
  let blocked: string | null = null;
  try {
    const [vault, state, round] = await conn.getMultipleAccountsInfo([cfg.PRIZE_VAULT, cfg.PRIZE_STATE, roundPda]);
    const held = vault && vault.data.length === 165 ? vault.data.readBigUInt64LE(64) : 0n;
    const reserved = state && state.owner.equals(cfg.PRIZE_PROGRAM_ID) ? state.data.readBigUInt64LE(8) : 0n;
    const posted = round && round.owner.equals(cfg.PRIZE_PROGRAM_ID) && round.data[0] === 2;
    chain = {
      free: held - reserved,
      onchainRoot: posted ? round.data.subarray(16, 48).toString('hex') : null,
      postedMs: posted ? Number(round.data.readBigUInt64LE(64)) * 1000 : null,
      // Lamports already at an address the program does not own yet (anyone can send SOL there).
      stateLamports: state && state.owner.equals(cfg.PRIZE_PROGRAM_ID) ? null : state?.lamports ?? 0,
      roundLamports: round && !round.owner.equals(cfg.PRIZE_PROGRAM_ID) ? round.lamports : 0,
    };
    if (round && round.owner.equals(cfg.PRIZE_PROGRAM_ID) && !posted) {
      throw new Error('round account exists but was never posted: investigate before sending');
    }
    console.log(`vault ${usdc(held)}  already promised ${usdc(reserved)}  free ${usdc(held - reserved)}`);
    // Round ids only move forward on-chain (day ids at byte 0, month ids at byte 16 of the state).
    const mark = state && state.owner.equals(cfg.PRIZE_PROGRAM_ID) ? state.data.readBigUInt64LE(kind === 'month' ? 16 : 0) : 0n;
    if (!posted && roundId <= mark) {
      blocked = `round ${roundId} can no longer be posted: ${kind} round ${mark} is already on-chain (rounds must be posted in date order)`;
    } else if (!posted && mark > 0n) {
      // A veto gives an id back only while its round is the latest of its kind,
      // so the next round waits until the previous one is past its veto window.
      const prev = await conn.getAccountInfo(pix.roundAddress(mark));
      if (prev && prev.owner.equals(cfg.PRIZE_PROGRAM_ID) && prev.data[0] === 2 && prev.data[1] === 0) {
        const openUntil = (Number(prev.data.readBigUInt64LE(64)) + cfg.PRIZE_VETO_WINDOW_S) * 1000;
        if (Date.now() < openUntil) {
          blocked = `previous ${kind} round ${mark} can still be vetoed until ${new Date(openUntil).toISOString()}; post after that`;
        }
      }
    }
    if (chain.onchainRoot) console.log(`on-chain: posted, root ${chain.onchainRoot === rootHex ? 'matches' : 'DIFFERS'}`);
    else if (total > chain.free) console.log(`WARNING: the vault cannot cover this round (${usdc(total)} > ${usdc(chain.free)})`);
  } catch (e) {
    if (send) throw e;
    console.log(`chain check unavailable: ${(e as Error).name}`);
  }

  if (blocked) {
    console.log(`BLOCKED: ${blocked}`);
    if (send) throw new Error(blocked);
  }
  if (!send) {
    console.log('dry run: nothing stored, nothing sent (add --send to post)');
    return;
  }

  // ── Post ───────────────────────────────────────────────────────────
  const key = posterKey(cfg.PRIZE_POSTER);
  const row = stored ?? await results.storeRound(plan!);
  results.treeOf(row);
  if (row.root !== rootHex) throw new Error('stored root changed under us; run again');
  if (row.postedSig) {
    console.log(`already posted in ${row.postedSig}`);
    return;
  }
  if (chain!.onchainRoot) {
    if (chain!.onchainRoot !== row.root) {
      throw new Error('this round is on-chain with a DIFFERENT root: investigate before anything else (the team can veto it within 24 h)');
    }
    const sigs = await conn.getSignaturesForAddress(roundPda, { limit: 1000 });
    const first = sigs[sigs.length - 1]?.signature ?? 'unknown';
    await db.markRoundPosted(roundId, first, chain!.postedMs!);
    console.log(`was already on-chain; recorded ${first}`);
    return;
  }
  if (row.total > chain!.free) throw new Error('the vault cannot cover this round; not sending');

  const tx = new Transaction();
  if (chain!.stateLamports !== null) {
    // First post ever: the program's state account does not exist yet.
    tx.add(...pix.createStateIxs(await conn.getMinimumBalanceForRentExemption(pix.STATE_SPACE), chain!.stateLamports));
  }
  const rent = await conn.getMinimumBalanceForRentExemption(pix.roundSpace(row.leaves.length));
  tx.add(...pix.postRoundIxs(roundId, Buffer.from(row.root, 'hex'), row.total, row.leaves.length, rent, chain!.roundLamports));
  const sig = await sendAndConfirmTransaction(conn, tx, [key], { commitment: 'confirmed' });
  const after = await conn.getAccountInfo(roundPda, 'confirmed');
  if (!after || after.data.subarray(16, 48).toString('hex') !== row.root) throw new Error(`sent ${sig} but the round account does not show the root`);
  const postedMs = Number(after.data.readBigUInt64LE(64)) * 1000;
  await db.markRoundPosted(roundId, sig, postedMs);
  console.log(`posted in ${sig}; claims open ${new Date(postedMs + cfg.PRIZE_VETO_WINDOW_S * 1000).toISOString()}`);
}

main().then(() => process.exit(0), (e) => {
  // RPC and database errors can quote their URL, and a URL can carry an API key.
  console.error(`error: ${String((e as Error).message).replace(/\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, '<url>')}`);
  process.exit(1);
});
