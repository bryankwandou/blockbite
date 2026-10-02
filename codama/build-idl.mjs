// Source of truth for the blockbite-vesting client.
// Describes programs/blockbite-vesting/src/lib.rs as a Codama tree, writes
// idl/blockbite_vesting.json and renders the TypeScript client into
// clients/js/src/generated. Keep in sync with the layouts in lib.rs.
//
//   cd codama && npm install && npm run generate

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createFromRoot,
  rootNode,
  programNode,
  accountNode,
  instructionNode,
  instructionAccountNode,
  instructionArgumentNode,
  structTypeNode,
  structFieldTypeNode,
  numberTypeNode,
  publicKeyTypeNode,
  booleanTypeNode,
  numberValueNode,
  publicKeyValueNode,
  errorNode,
  pdaNode,
  pdaLinkNode,
  pdaValueNode,
  pdaSeedValueNode,
  accountValueNode,
  argumentValueNode,
  constantPdaSeedNodeFromString,
  variablePdaSeedNode,
  fieldDiscriminatorNode,
} from 'codama';
import { renderVisitor } from '@codama/renderers-js';

const here = dirname(fileURLToPath(import.meta.url));
const PROGRAM_ID = readFileSync(join(here, 'program-id.txt'), 'utf8').trim();
const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';

const u8 = numberTypeNode('u8');
const u64 = numberTypeNode('u64');
const i64 = numberTypeNode('i64');
const pk = publicKeyTypeNode();
const field = (name, type, extra = {}) => structFieldTypeNode({ name, type, ...extra });
const tag = (value) => field('tag', u8, { defaultValue: numberValueNode(value), defaultValueStrategy: 'omitted' });
const disc = (value) =>
  instructionArgumentNode({ name: 'discriminator', type: u8, defaultValue: numberValueNode(value), defaultValueStrategy: 'omitted' });
const arg = (name, type, docs = []) => instructionArgumentNode({ name, type, docs });
const acc = (name, { writable = false, signer = false, docs = [], defaultValue } = {}) =>
  instructionAccountNode({ name, isWritable: writable, isSigner: signer, docs, defaultValue });
const tokenProgram = acc('tokenProgram', { defaultValue: publicKeyValueNode(TOKEN_PROGRAM, 'splToken') });
const vaultAuthority = acc('vaultAuthority', {
  docs: ['PDA [stream]; owner of the vault token account.'],
  defaultValue: pdaValueNode(pdaLinkNode('vaultAuthority'), [pdaSeedValueNode('stream', accountValueNode('stream'))]),
});

const root = rootNode(
  programNode({
    name: 'blockbiteVesting',
    publicKey: PROGRAM_ID,
    version: '1.0.0',
    docs: ['Linear vesting with cliff, 70/15/10/5 revenue split and VGPV bot checks (Pinocchio).'],
    pdas: [
      pdaNode({ name: 'vaultAuthority', seeds: [variablePdaSeedNode('stream', pk)] }),
      pdaNode({
        name: 'proofCache',
        seeds: [constantPdaSeedNodeFromString('utf8', 'proof_cache'), variablePdaSeedNode('stream', pk), variablePdaSeedNode('player', pk)],
      }),
    ],
    accounts: [
      accountNode({
        name: 'vestingStream',
        size: 189,
        docs: ['Created by the client (owner = program, 189 zero bytes) in the CreateStream transaction.'],
        discriminators: [fieldDiscriminatorNode('tag')],
        data: structTypeNode([
          tag(1),
          field('authority', pk),
          field('beneficiary', pk),
          field('mint', pk),
          field('totalAmount', u64),
          field('withdrawnAmount', u64),
          field('startTs', i64),
          field('cliffTs', i64),
          field('endTs', i64),
          field('streamId', u64),
          field('lastActionTs', i64),
          field('cancelled', booleanTypeNode()),
          field('vaultAuthorityBump', u8),
          field('velocityStrikes', u8),
          field('vault', pk),
        ]),
      }),
      accountNode({
        name: 'proofCache',
        size: 77,
        pda: pdaLinkNode('proofCache'),
        discriminators: [fieldDiscriminatorNode('tag')],
        data: structTypeNode([
          tag(2),
          field('schedule', pk),
          field('player', pk),
          field('lastProofTs', i64),
          field('cohortId', u8),
          field('tierReached', u8),
          field('velocityStrikes', u8),
          field('bump', u8),
        ]),
      }),
    ],
    instructions: [
      instructionNode({
        name: 'createStream',
        docs: [
          'Initialises a client-created stream account and locks `amount` in the vault.',
          'Same transaction must first: create `stream` (189 bytes, owner = program) and',
          'create + InitializeAccount3 `vault` with owner = vaultAuthority PDA [stream].',
        ],
        accounts: [
          acc('authority', { signer: true }),
          acc('beneficiary'),
          acc('stream', { writable: true }),
          acc('vault', { writable: true }),
          acc('authorityAta', { writable: true }),
          tokenProgram,
        ],
        arguments: [
          disc(0),
          arg('streamId', u64),
          arg('amount', u64),
          arg('startTs', i64),
          arg('cliffTs', i64, ['0 = no cliff (cliff = start).']),
          arg('endTs', i64, ['end - start must be <= 2^32 - 1 seconds.']),
          arg('vaultAuthorityBump', u8),
        ],
      }),
      instructionNode({
        name: 'withdraw',
        accounts: [
          acc('beneficiary', { signer: true }),
          acc('stream', { writable: true }),
          vaultAuthority,
          acc('vault', { writable: true }),
          acc('beneficiaryAta', { writable: true }),
          tokenProgram,
        ],
        arguments: [disc(1)],
      }),
      instructionNode({
        name: 'fundVault',
        docs: ['Splits `amount`: 70% (+dust) vault, 15% team, 10% dev, 5% referral. Team/dev ATAs must be owned by the team wallet.'],
        accounts: [
          acc('funder', { signer: true }),
          acc('stream', { writable: true }),
          acc('vault', { writable: true }),
          acc('funderAta', { writable: true }),
          acc('teamAta', { writable: true }),
          acc('devAta', { writable: true }),
          acc('referralAta', { writable: true }),
          tokenProgram,
        ],
        arguments: [disc(2), arg('amount', u64)],
      }),
      instructionNode({
        name: 'updateProof',
        accounts: [
          acc('admin', { signer: true, writable: true }),
          acc('stream'),
          acc('player'),
          acc('proof', {
            writable: true,
            defaultValue: pdaValueNode(pdaLinkNode('proofCache'), [
              pdaSeedValueNode('stream', accountValueNode('stream')),
              pdaSeedValueNode('player', accountValueNode('player')),
            ]),
          }),
          acc('systemProgram', { defaultValue: publicKeyValueNode(SYSTEM_PROGRAM, 'splSystem') }),
        ],
        arguments: [disc(3), arg('cohortId', u8), arg('tierReached', u8, ['0..=2']), arg('proofBump', u8)],
      }),
      instructionNode({
        name: 'cancel',
        accounts: [
          acc('authority', { signer: true }),
          acc('stream', { writable: true }),
          vaultAuthority,
          acc('vault', { writable: true }),
          acc('authorityAta', { writable: true }),
          acc('beneficiaryAta', { writable: true, docs: ['Token account owned by the stream beneficiary.'] }),
          tokenProgram,
        ],
        arguments: [disc(4)],
      }),
    ],
    errors: [
      [6000, 'zeroAmount', 'Amount must be greater than zero'],
      [6001, 'invalidTimeRange', 'End must be after start and within 2^32-1 seconds'],
      [6002, 'invalidCliff', 'Cliff must lie within [start, end]'],
      [6003, 'nothingToWithdraw', 'Nothing unlocked to withdraw'],
      [6004, 'unauthorized', 'Signer or destination not authorised'],
      [6005, 'streamCancelled', 'Stream is cancelled'],
      [6006, 'overflow', 'Arithmetic overflow'],
      [6007, 'velocityViolation', 'Too many actions faster than the human threshold'],
      [6008, 'invalidTier', 'Tier must be 0, 1 or 2'],
      [6009, 'invalidInstruction', 'Malformed instruction data or account list'],
      [6010, 'invalidAccount', 'Account failed validation'],
    ].map(([code, name, message]) => errorNode({ code, name, message })),
  }),
);

const codama = createFromRoot(root);
mkdirSync(join(here, '..', 'idl'), { recursive: true });
writeFileSync(join(here, '..', 'idl', 'blockbite_vesting.json'), codama.getJson() + '\n');
await codama.accept(renderVisitor(join(here, 'clients', 'js'), { formatCode: true }));
// The renderer's package.json omits "type"; the client is ESM.
const pkgPath = join(here, 'clients', 'js', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
writeFileSync(pkgPath, JSON.stringify({ ...pkg, name: 'blockbite-vesting-client', type: 'module' }, null, 2) + '\n');
console.log('IDL + client generated for', PROGRAM_ID);
