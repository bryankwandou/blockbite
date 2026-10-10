import { chromium } from 'playwright';
const B='http://localhost:3017';
const br=await chromium.launch();
async function run(label, init, path, opts={}){
  const ctx=await br.newContext({viewport:{width:390,height:844},hasTouch:true,isMobile:true,...opts});
  if(init) await ctx.addInitScript(init);
  const p=await ctx.newPage(); const errs=[];
  p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,160))});
  p.on('pageerror',e=>errs.push('PAGEERR '+e.message.slice(0,160)));
  await p.goto(B+path,{waitUntil:'load'}).catch(e=>errs.push('NAV '+e.message.slice(0,60)));
  await p.waitForTimeout(2500);
  const txt=(await p.locator('body').innerText().catch(()=>'')).replace(/\s+/g,' ').slice(0,120);
  await p.screenshot({path:`shots/b_${label}.png`});
  console.log(label,path,'|',txt,'|',errs.length?[...new Set(errs)]:'ok');
  await ctx.close();
}
const block=`Object.defineProperty(window,'localStorage',{get(){throw new DOMException('denied','SecurityError')}});`;
const full=`Storage.prototype.setItem=function(){throw new DOMException('full','QuotaExceededError')};`;
const bad=(v)=>`try{localStorage.setItem('bb_max_level',${JSON.stringify(v)});localStorage.setItem('bb_stars','{bad');localStorage.setItem('bb_games_played','x');localStorage.setItem('bb_pb_score','-1e999')}catch(e){}`;
for (const p of ['/play/1','/map','/profile','/achievements','/settings','/shop','/quests','/themes','/mascots','/account','/how-to-play','/onboarding','/challenge','/r/<script>alert(1)<\/script>','/waitlist','/partnership']){
  const k=p.replace(/\W+/g,'_');
  await run('block'+k,block,p); await run('full'+k,full,p);
  await run('bad'+k,bad('999999999999999999999'),p);
}
await br.close();
