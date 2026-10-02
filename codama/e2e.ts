// Live end-to-end run of every instruction through the Codama client.
//   RPC_URL=<devnet or mainnet rpc> PAYER=<keypair.json> npx tsx e2e.ts
// Creates a fresh 6-decimal test mint (payer = mint authority), so it moves
// no real funds besides SOL for rent and fees.

import { readFileSync } from 'node:fs';
import {
  address,
  appendTransactionMessageInstructions,
  createKeyPairSignerFromBytes,
  createSolanaRpc,
  createSolanaRpcSubscriptions,
  createTransactionMessage,
  generateKeyPairSigner,
  getAddressEncoder,
  getProgramDerivedAddress,
  getSignatureFromTransaction,
  pipe,
  sendAndConfirmTransactionFactory,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type Address,
  type Instruction,
  type TransactionSigner,
} from '@solana/kit';
import { getCreateAccountInstruction } from '@solana-program/system';
import {
  TOKEN_PROGRAM_ADDRESS,
  fetchToken,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getInitializeAccount3Instruction,
  getInitializeMintInstruction,
  getMintToInstruction,
} from '@solana-program/token';
import {
  BLOCKBITE_VESTING_PROGRAM_ADDRESS,
  fetchVestingStream,
  findProofCachePda,
  getCancelInstructionAsync,
  getCreateStreamInstruction,
  getFundVaultInstruction,
  getUpdateProofInstructionAsync,
  getWithdrawInstructionAsync,
} from './clients/js/src/generated/index.ts';

const TEAM_WALLET = address('ETcQvsQek2w9feLfsqoe4AypCWfnrSwQiv3djqocaP2m');
const rpcUrl = process.env.RPC_URL!;
const rpc = createSolanaRpc(rpcUrl);
const rpcSubscriptions = createSolanaRpcSubscriptions(rpcUrl.replace(/^http/, 'ws'));
const sendAndConfirm = sendAndConfirmTransactionFactory({ rpc, rpcSubscriptions });

let failures = 0;
function check(name: string, ok: boolean, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  ' + detail : ''}`);
  if (!ok) failures++;
}

async function send(payer: TransactionSigner, ixs: Instruction[]) {
  const { value: blockhash } = await rpc.getLatestBlockhash().send();
  const msg = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(ixs, m),
  );
  const tx = await signTransactionMessageWithSigners(msg);
  await sendAndConfirm(tx as Parameters<typeof sendAndConfirm>[0], { commitment: 'confirmed' });
  return getSignatureFromTransaction(tx);
}

async function expectFail(name: string, code: number, payer: TransactionSigner, ixs: Instruction[]) {
  try {
    await send(payer, ixs);
    check(name, false, 'unexpectedly succeeded');
  } catch (e) {
    const text = JSON.stringify(e, (_, v) => (typeof v === 'bigint' ? v.toString() : v)) + String(e);
    const hit = text.includes(`"Custom":${code}`) || text.includes(`0x${code.toString(16)}`) || text.includes(`#${code}`) || text.includes(`Custom(${code})`);
    check(name, hit, hit ? `rejected with ${code}` : text.slice(0, 300));
  }
}

const amountOf = async (a: Address) => (await fetchToken(rpc, a)).data.amount;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const payer = await createKeyPairSignerFromBytes(new Uint8Array(JSON.parse(readFileSync(process.env.PAYER!, 'utf8'))));
  const beneficiary = await generateKeyPairSigner();
  console.log('program', BLOCKBITE_VESTING_PROGRAM_ADDRESS, 'payer', payer.address);

  // 1. Test mint + token accounts.
  const mint = await generateKeyPairSigner();
  const rentMint = await rpc.getMinimumBalanceForRentExemption(82n).send();
  const rentTa = await rpc.getMinimumBalanceForRentExemption(165n).send();
  const rentStream = await rpc.getMinimumBalanceForRentExemption(189n).send();
  const ata = async (owner: Address) => (await findAssociatedTokenPda({ mint: mint.address, owner, tokenProgram: TOKEN_PROGRAM_ADDRESS }))[0];
  const [authorityAta, beneficiaryAta, teamAta] = await Promise.all([ata(payer.address), ata(beneficiary.address), ata(TEAM_WALLET)]);
  const mkAta = (owner: Address) => getCreateAssociatedTokenIdempotentInstructionAsync({ payer, owner, mint: mint.address });
  await send(payer, [
    getCreateAccountInstruction({ payer, newAccount: mint, lamports: rentMint, space: 82, programAddress: TOKEN_PROGRAM_ADDRESS }),
    getInitializeMintInstruction({ mint: mint.address, decimals: 6, mintAuthority: payer.address }),
    await mkAta(payer.address),
    await mkAta(beneficiary.address),
    await mkAta(TEAM_WALLET),
    getMintToInstruction({ mint: mint.address, token: authorityAta, mintAuthority: payer, amount: 10_000_000n }),
  ]);
  check('mint 10 test tokens', (await amountOf(authorityAta)) === 10_000_000n);

  // 2. CreateStream: stream + vault created in the same transaction.
  const stream = await generateKeyPairSigner();
  const vault = await generateKeyPairSigner();
  const [vaultAuthority, bump] = await getProgramDerivedAddress({
    programAddress: BLOCKBITE_VESTING_PROGRAM_ADDRESS,
    seeds: [getAddressEncoder().encode(stream.address)],
  });
  const now = BigInt(Math.floor(Date.now() / 1000));
  const start = now - 100n;
  const end = now + 300n;
  await send(payer, [
    getCreateAccountInstruction({ payer, newAccount: stream, lamports: rentStream, space: 189, programAddress: BLOCKBITE_VESTING_PROGRAM_ADDRESS }),
    getCreateAccountInstruction({ payer, newAccount: vault, lamports: rentTa, space: 165, programAddress: TOKEN_PROGRAM_ADDRESS }),
    getInitializeAccount3Instruction({ account: vault.address, mint: mint.address, owner: vaultAuthority }),
    getCreateStreamInstruction({
      authority: payer,
      beneficiary: beneficiary.address,
      stream: stream.address,
      vault: vault.address,
      authorityAta,
      streamId: 1n,
      amount: 4_000_000n,
      startTs: start,
      cliffTs: 0n,
      endTs: end,
      vaultAuthorityBump: bump,
    }),
  ]);
  const s = await fetchVestingStream(rpc, stream.address);
  check('create_stream state', s.data.totalAmount === 4_000_000n && s.data.vault === vault.address && s.data.beneficiary === beneficiary.address);
  check('vault funded', (await amountOf(vault.address)) === 4_000_000n);

  // 3. Withdraw (partial, linear).
  const withdrawIx = () => getWithdrawInstructionAsync({ beneficiary, stream: stream.address, vault: vault.address, beneficiaryAta });
  await send(payer, [await withdrawIx()]);
  const got = await amountOf(beneficiaryAta);
  check('withdraw partial', got > 0n && got < 4_000_000n, `${got}`);

  // 4. Non-beneficiary cannot withdraw.
  const thief = await generateKeyPairSigner();
  await expectFail('thief withdraw rejected', 6004, payer, [
    await getWithdrawInstructionAsync({ beneficiary: thief, stream: stream.address, vault: vault.address, beneficiaryAta: authorityAta }),
  ]);

  // 5. FundVault: 70/15/10/5; team+dev both go to TEAM_WALLET, referral to beneficiary.
  const before = { vault: await amountOf(vault.address), team: await amountOf(teamAta), ref: await amountOf(beneficiaryAta) };
  await send(payer, [
    getFundVaultInstruction({
      funder: payer,
      stream: stream.address,
      vault: vault.address,
      funderAta: authorityAta,
      teamAta,
      devAta: teamAta,
      referralAta: beneficiaryAta,
      amount: 1_000_000n,
    }),
  ]);
  check('fund_vault vault +70%', (await amountOf(vault.address)) - before.vault === 700_000n);
  check('fund_vault team+dev +25%', (await amountOf(teamAta)) - before.team === 250_000n);
  check('fund_vault referral +5%', (await amountOf(beneficiaryAta)) - before.ref === 50_000n);
  await expectFail('fee redirection rejected', 6004, payer, [
    getFundVaultInstruction({
      funder: payer,
      stream: stream.address,
      vault: vault.address,
      funderAta: authorityAta,
      teamAta: authorityAta,
      devAta: teamAta,
      referralAta: beneficiaryAta,
      amount: 1_000n,
    }),
  ]);

  // 6. UpdateProof (creates the PDA), then a fast second update earns a strike.
  const player = (await generateKeyPairSigner()).address;
  const [proof, proofBump] = await findProofCachePda({ stream: stream.address, player });
  const proofIx = (tier: number) =>
    getUpdateProofInstructionAsync({ admin: payer, stream: stream.address, player, proof, cohortId: 1, tierReached: tier, proofBump });
  await send(payer, [await proofIx(1)]);
  const acc = await rpc.getAccountInfo(proof, { encoding: 'base64' }).send();
  check('update_proof created cache', acc.value?.owner === BLOCKBITE_VESTING_PROGRAM_ADDRESS);
  await expectFail('tier 3 rejected', 6008, payer, [await proofIx(3)]);
  await send(payer, [await proofIx(2)]);
  await sleep(1500);
  await send(payer, [await proofIx(2)]);
  await sleep(1500);
  await expectFail('3rd fast proof -> velocity', 6007, payer, [await proofIx(2)]);

  // 7. Cancel: vested to beneficiary, rest back to creator, vault empty.
  const benBefore = await amountOf(beneficiaryAta);
  const authBefore = await amountOf(authorityAta);
  await send(payer, [
    await getCancelInstructionAsync({ authority: payer, stream: stream.address, vault: vault.address, authorityAta, beneficiaryAta }),
  ]);
  const paidBen = (await amountOf(beneficiaryAta)) - benBefore;
  const paidAuth = (await amountOf(authorityAta)) - authBefore;
  check('cancel empties vault', (await amountOf(vault.address)) === 0n, `ben +${paidBen}, creator +${paidAuth}`);
  check('cancel flag set', (await fetchVestingStream(rpc, stream.address)).data.cancelled === true);
  await expectFail('withdraw after cancel rejected', 6005, payer, [await withdrawIx()]);

  console.log(failures === 0 ? '\nALL LIVE CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
