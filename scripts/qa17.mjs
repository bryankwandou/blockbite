import { chromium, devices } from 'playwright';
const B='http://localhost:3017';
const routes=['/','/play/1','/map','/adventure','/quests','/achievements','/shop','/themes','/mascots','/profile','/account','/settings','/onboarding','/how-to-play','/challenge','/r/abc','/waitlist','/partnership','/partner','/leaderboard'];
const br=await chromium.launch();
for (const [name,opts] of [['d',{viewport:{width:1280,height:800}}],['m',{viewport:{width:390,height:844},hasTouch:true,isMobile:true}]]) {
  const ctx=await br.newContext(opts);
  for (const r of routes){
    const p=await ctx.newPage(); const errs=[];
    p.on('console',m=>{if(m.type()==='error')errs.push(m.text().slice(0,140))});
    p.on('pageerror',e=>errs.push('PAGEERR '+e.message.slice(0,140)));
    let st; try{ st=(await p.goto(B+r,{waitUntil:'networkidle',timeout:20000})).status(); }catch(e){st='ERR '+e.message.slice(0,60)}
    await p.waitForTimeout(500);
    await p.screenshot({path:`shots/${name}${r.replace(/\W+/g,'_')}.png`});
    console.log(name,r,st,p.url().replace(B,''),errs.length?JSON.stringify([...new Set(errs)]):'');
    await p.close();
  }
  await ctx.close();
}
await br.close();
