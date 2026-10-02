/**
 * setup-kv.mjs
 * Automatically creates a Vercel KV store and links it to this project.
 * Run once: node scripts/setup-kv.mjs
 *
 * Requires VERCEL_TOKEN env var:
 *   $env:VERCEL_TOKEN="your_token"; node scripts/setup-kv.mjs
 *
 * Get your token at: https://vercel.com/account/tokens
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';

const TOKEN   = process.env.VERCEL_TOKEN;
const PROJECT = JSON.parse(readFileSync('.vercel/project.json', 'utf8'));
const { projectId, orgId } = PROJECT;

if (!TOKEN) {
  console.error('\n❌  Missing VERCEL_TOKEN\n');
  console.error('   Get it at https://vercel.com/account/tokens');
  console.error('   Then run:');
  console.error('     $env:VERCEL_TOKEN="your_token"; node scripts/setup-kv.mjs\n');
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  'Content-Type': 'application/json',
};

async function api(method, path, body) {
  const r = await fetch(`https://api.vercel.com${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await r.json();
  if (!r.ok) throw new Error(json.error?.message ?? JSON.stringify(json));
  return json;
}

(async () => {
  console.log('\n🔧  BlockBite — Vercel KV Auto-Setup\n');

  // 1. Check if KV already exists for this project
  console.log('1/3  Checking existing storage...');
  const { stores } = await api('GET', `/v1/storage/stores?teamId=${orgId}&projectId=${projectId}`);
  const existing = stores?.find(s => s.type === 'kv');
  let storeId;

  if (existing) {
    storeId = existing.id;
    console.log(`     ✓ KV already exists: ${existing.name} (${storeId})`);
  } else {
    // 2. Create a new KV store
    console.log('2/3  Creating KV store "blockbite-waitlist"...');
    const { store } = await api('POST', `/v1/storage/stores?teamId=${orgId}`, {
      type: 'kv',
      name: 'blockbite-waitlist',
      regions: ['sin1'],
    });
    storeId = store.id;
    console.log(`     ✓ Created: ${store.name} (${storeId})`);
  }

  // 3. Link store to project
  console.log('3/3  Linking KV to project...');
  try {
    await api('POST', `/v1/storage/stores/${storeId}/connections?teamId=${orgId}`, {
      projectId,
      envVarPrefix: 'KV',
    });
    console.log('     ✓ Linked and env vars injected into Vercel project');
  } catch (e) {
    if (e.message?.includes('already')) {
      console.log('     ✓ Already linked');
    } else {
      throw e;
    }
  }

  // 4. Pull env vars to .env.local
  console.log('\n📥  Pulling env vars to .env.local...');
  const { envs } = await api('GET', `/v9/projects/${projectId}/env?teamId=${orgId}&decrypt=true&source=vercel-kv`);
  if (envs?.length) {
    const existing = existsSync('.env.local') ? readFileSync('.env.local', 'utf8') : '';
    const kvLines = envs.map(e => `${e.key}=${e.value}`).join('\n');
    const cleaned = existing.split('\n').filter(l => !l.startsWith('KV_')).join('\n').trim();
    writeFileSync('.env.local', `${cleaned}\n${kvLines}\n`);
    console.log(`     ✓ Wrote ${envs.length} KV env vars to .env.local`);
  } else {
    console.log('     ⚠ Env vars not yet visible — redeploy on Vercel to activate');
  }

  console.log('\n✅  Done! Redeploy to activate KV persistence:');
  console.log('     git push   (auto-deploys on Vercel)\n');
})().catch(err => {
  console.error('\n❌  Error:', err.message ?? err);
  process.exit(1);
});
