import { chromium } from 'playwright';
const br=await chromium.launch(); const ctx=await br.newContext();
await ctx.addInitScript(`Object.defineProperty(window,'localStorage',{get(){throw new DOMException('denied','SecurityError')}});`);
for (const path of process.argv.slice(2)){ const p=await ctx.newPage();
p.on('pageerror',e=>console.log(path,(e.stack||'').split('\n').slice(0,4).join(' | ')));
await p.goto('http://localhost:3017'+path); await p.waitForTimeout(2000); await p.close();}
await br.close();
