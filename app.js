// Aptitude Trainer UI. Depends on Geom (geom.js), Engine (engine.js), BANK_GZ (bank.gz.js).
'use strict';
const E=window.Engine,G=window.Geom;
let BANK=null,I=null,S=null,SESS=null,VIEW='home';
const $=s=>document.querySelector(s);
const esc=s=>String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
const pct=(a,b)=>b?Math.round(100*a/b)+'%':'–';
const secs=ms=>(ms/1000).toFixed(ms<10000?1:0)+'s';
const mmss=ms=>{ms=Math.max(0,ms);const s=Math.ceil(ms/1000);return Math.floor(s/60)+':'+String(s%60).padStart(2,'0');};
function toast(t){const el=$('#toast');el.textContent=t;el.classList.add('on');clearTimeout(toast._t);toast._t=setTimeout(()=>el.classList.remove('on'),2200);}
const CATPFX={SEQ:'seq',ODD:'odd',VER:'verb',LOG:'logic',ABS:'abstract',SPA:'spatial',COM:'compare',MAT:'math',COD:'code'};
const catOfId=id=>CATPFX[id.slice(0,3)];
const IS_APP=(window.matchMedia&&matchMedia('(display-mode: standalone)').matches)||navigator.standalone===true;
const IS_PWA=!!document.querySelector('link[rel=manifest]');

// ---------------- persistence: per-user cloud store (artifact db) with local fallback ----------------
const Store={db:null,uid:null,cloud:false,chains:{},dirty:new Set(),timer:null,LK:'aptTrainer.v1',
  async init(){try{if(!window.claude||!window.claude.use)return;const to=new Promise(r=>setTimeout(()=>r(null),10000));
    const db=await Promise.race([window.claude.use('db'),to]);const us=db?await Promise.race([window.claude.use('user'),to]):null;if(!db||!us)return;const id=await us.id();if(!id)return;this.db=db;this.uid=id;this.cloud=true;}catch(e){this.cloud=false;}},
  doc(name){return this.db.doc('data/users/'+this.uid+'/'+name);},
  localLoad(){try{const t=localStorage.getItem(this.LK);return t?JSON.parse(t):null;}catch(e){return null;}},
  localSave(){try{localStorage.setItem(this.LK,JSON.stringify(S));}catch(e){}},
  async load(){const local=this.localLoad();if(!this.cloud)return E.normState(local);
    try{const timeout=new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')),10000));
      const names=['state',...E.CATS.map(([c])=>'seen_'+c)];const snaps=await Promise.race([Promise.all(names.map(n=>this.doc(n).get())),timeout]);
      if(!snaps[0].exists){if(local){this.markAll();return E.normState(local);}return E.newState();}
      const st=JSON.parse(JSON.stringify(snaps[0].data()));st.seen={};snaps.slice(1).forEach(s=>{if(s.exists)Object.assign(st.seen,(s.data()||{}).m||{});});
      if(local&&(local.updated||0)>(st.updated||0)){this.markAll();return E.normState(local);}return E.normState(st);
    }catch(e){this.cloud=false;toast('Cloud sync unavailable — saving in this browser');return E.normState(local);}},
  markAll(){this.dirty.add('state');E.CATS.forEach(([c])=>this.dirty.add('seen_'+c));},
  touch(q){this.dirty.add('state');if(q)this.dirty.add('seen_'+q.c);this.localSave();clearTimeout(this.timer);this.timer=setTimeout(()=>this.flush(),8000);},
  write(name,data){const prev=this.chains[name]||Promise.resolve();const p=prev.then(()=>this.doc(name).set(data)).catch(e=>{if(e&&e.code==='quota_exceeded')toast('Cloud storage is full');});this.chains[name]=p;return p;},
  async flush(){clearTimeout(this.timer);this.localSave();if(!this.cloud||!this.dirty.size)return;const names=[...this.dirty];this.dirty.clear();const ps=[];
    for(const n of names){if(n==='state'){const {seen,...rest}=S;ps.push(this.write('state',JSON.parse(JSON.stringify(rest))));}
      else{const c=n.slice(5);const m={};for(const id in S.seen)if(catOfId(id)===c)m[id]=S.seen[id];ps.push(this.write(n,{m}));}}
    await Promise.all(ps);},
  async report(q,note){if(!this.cloud)return false;try{await this.db.collection('reports').add({id:q.id,c:q.c,f:q.f,d:q.d,note:String(note).slice(0,500),ts:Date.now(),bank:window.BANK_VERSION});return true;}catch(e){return false;}}};
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='hidden'&&S)Store.flush();});

// ---------------- boot ----------------
async function loadBank(){const b64=window.BANK_GZ;const bin=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
  if(typeof DecompressionStream!=='undefined'){const st=new Blob([bin]).stream().pipeThrough(new DecompressionStream('gzip'));return JSON.parse(await new Response(st).text());}
  throw new Error('This browser is too old to unpack the question bank (needs DecompressionStream). Please update your browser.');}
async function boot(){try{const [bank]=await Promise.all([loadBank(),Store.init()]);BANK=bank;I=E.buildIndex(BANK);S=await Store.load();go(location.hash.slice(1)||'home');}
  catch(e){$('#app').innerHTML='<div class="card">Could not load the question bank: '+esc(e.message)+'</div>';}}
window.addEventListener('hashchange',()=>{const h=location.hash.slice(1);if(['home','stats','settings'].includes(h)&&h!==VIEW&&!SESS)go(h);});

// ---------------- navigation ----------------
function go(v){if(SESS&&!SESS.done&&v!=='session'){if(!confirmLeave())return;}
  VIEW=v;document.querySelectorAll('.tab').forEach(t=>t.classList.toggle('on',t.dataset.v===v));
  if(['home','stats','settings'].includes(v)&&location.hash.slice(1)!==v)history.replaceState(null,'','#'+v);
  ({home:viewHome,stats:viewStats,settings:viewSettings,quick:viewQuickSetup,cat:viewCatSetup,assess:viewAssessSetup}[v]||viewHome)();window.scrollTo(0,0);}
function confirmLeave(){if(SESS.mode==='assess'){if(!SESS._leaveAsk){SESS._leaveAsk=true;toast('An assessment is running — click again to abandon it');setTimeout(()=>{if(SESS)SESS._leaveAsk=false;},3000);return false;}}
  endSession(true);return true;}
const levelBar=th=>`<div class="bar" title="${th.toFixed(2)}"><i style="width:${Math.round(100*(th-1)/5.5)}%"></i></div>`;

const LVC=['#64748b','#64748b','#2563eb','#0d9488','#ea580c','#9333ea','#b91c1c'];
const lvColor=th=>LVC[E.clamp(Math.round(th),1,E.MAXL)];
function levelTile(th){const L=E.clamp(Math.round(th),1,E.MAXL);const frac=L===E.MAXL&&th>=E.MAXL?1:E.clamp(th-(L-0.5),0,1);const next=L<E.MAXL?E.LEVELS[L+1]:null;
  return `<div class="lvtile" style="--lc:${lvColor(th)}"><div class="row" style="align-items:baseline;gap:8px"><div class="v">${th.toFixed(1)}</div><div class="lvname">${E.LEVELS[L]}</div></div><div class="lbar"><i style="width:${Math.round(frac*100)}%"></i></div><div class="l">${next?Math.round(frac*100)+'% of the way to '+next:'Top level'} · overall level</div></div>`;}
const MODES=[['adaptive','Adaptive practice','Endless. Picks the category and difficulty for you, leaning on weaker areas. Feedback after each answer.','startAdaptive()','#2563eb','∞'],
 ['assess','Timed assessment','50 questions in 20 minutes across all nine categories, like a recruitment test. Review at the end.',"go('assess')",'#e11d48','⏱'],
 ['quick','Quick practice','A short session. Choose length, categories and difficulty.',"go('quick')",'#16a34a','⚡'],
 ['cat','Category practice','Focus on one question type at your level, or a level you choose.',"go('cat')",'#d97706','◎']];
function viewHome(){const tot=E.CATS.reduce((a,[c])=>a+S.stats[c].n,0),cor=E.CATS.reduce((a,[c])=>a+S.stats[c].c,0);const ov=E.overall(S);
  const weak=E.CATS.slice().sort((a,b)=>S.ability[a[0]]-S.ability[b[0]]).slice(0,3);const today=S.sessions.filter(x=>new Date(x.ts).toDateString()===new Date().toDateString()).reduce((a,x)=>a+x.n,0);
  $('#app').innerHTML=`
  <div class="toprow">${levelTile(ov)}
   <div class="stat"><div class="v">${tot.toLocaleString()}</div><div class="l">Questions answered${today?` · ${today} today`:''}</div></div>
   <div class="stat"><div class="v">${pct(cor,tot)}</div><div class="l">Overall accuracy</div></div>
   <div class="stat"><div class="v">${BANK.length.toLocaleString()}</div><div class="l">Questions in bank</div></div></div>
  <div class="grid g2">${MODES.map(([k,t,d,fn,c,ic])=>`<button class="mode m2" style="--mc:${c}" onclick="${fn}"><span class="mi">${ic}</span><span class="mt"><b>${t}</b><span>${d}</span></span><span class="ma">→</span></button>`).join('')}</div>
  <div class="focus"><span class="small muted">Focus areas:</span>${weak.map(([c,n])=>`<button class="fchip" style="--lc:${lvColor(S.ability[c])}" onclick="startCat('${c}',0)">${n} <span>${S.ability[c].toFixed(1)}</span></button>`).join('')}<a class="small" href="#stats" onclick="go('stats');return false" style="margin-left:auto;color:var(--acc)">All categories →</a></div>
  ${Store.cloud?'':`<p class="tiny muted">Progress is saved on this device${IS_APP?'':' (this browser)'} — back it up from Settings.</p>`}`;}

// ---------------- setup screens ----------------
const qsCfg={n:20,cats:E.CATS.map(x=>x[0]),level:0};
function segBtns(name,vals,cur,fn){return `<div class="seg">${vals.map(([v,l])=>`<button class="${v===cur?'on':''}" onclick="${fn}(${JSON.stringify(v).replace(/"/g,"'")})">${l}</button>`).join('')}</div>`;}
function viewQuickSetup(){$('#app').innerHTML=`<div class="card"><h3>Quick practice</h3>
  <p class="small muted">Feedback after every answer. Adaptive difficulty follows your ability in each category.</p>
  <div class="row" style="margin:10px 0"><span class="small" style="width:90px">Length</span>${segBtns('n',[[10,'10'],[20,'20'],[30,'30'],[50,'50']],qsCfg.n,'setQN')}</div>
  <div class="row" style="margin:10px 0"><span class="small" style="width:90px">Difficulty</span>${segBtns('l',[[0,'Adaptive'],[1,'L1'],[2,'L2'],[3,'L3'],[4,'L4'],[5,'L5'],[6,'L6']],qsCfg.level,'setQL')}</div>
  <div style="margin:10px 0"><span class="small">Categories</span><div style="margin-top:6px">${E.CATS.map(([c,n])=>`<label class="chk"><input type="checkbox" ${qsCfg.cats.includes(c)?'checked':''} onchange="togQC('${c}',this.checked)"> ${n}</label>`).join('')}</div></div>
  <div class="row" style="margin-top:14px"><button class="btn" onclick="startQuick()">Start</button><button class="btn sec" onclick="go('home')">Back</button></div></div>`;}
window.setQN=v=>{qsCfg.n=v;viewQuickSetup();};window.setQL=v=>{qsCfg.level=v;viewQuickSetup();};window.togQC=(c,on)=>{qsCfg.cats=on?[...new Set([...qsCfg.cats,c])]:qsCfg.cats.filter(x=>x!==c);};
let catCfg={c:'seq',level:0,n:20};
function viewCatSetup(){$('#app').innerHTML=`<div class="card"><h3>Category practice</h3>
  <div class="grid g3" style="margin:10px 0">${E.CATS.map(([c,n])=>{const p=E.poolInfo(I,S,c);return `<button class="mode" style="${catCfg.c===c?'border-color:var(--acc)':''}" onclick="catCfg.c='${c}';viewCatSetup()"><b>${n}</b><span>Level ${S.ability[c].toFixed(1)} · ${p.seen}/${p.tot} seen</span></button>`;}).join('')}</div>
  <div class="row" style="margin:10px 0"><span class="small" style="width:90px">Difficulty</span>${segBtns('l',[[0,'Adaptive'],[1,'L1'],[2,'L2'],[3,'L3'],[4,'L4'],[5,'L5'],[6,'L6']],catCfg.level,'setCL')}</div>
  <div class="row" style="margin:10px 0"><span class="small" style="width:90px">Length</span>${segBtns('n',[[10,'10'],[20,'20'],[0,'Endless']],catCfg.n,'setCN')}</div>
  <div class="row" style="margin-top:14px"><button class="btn" onclick="startCat(catCfg.c,catCfg.level,catCfg.n)">Start</button><button class="btn sec" onclick="go('home')">Back</button></div></div>`;}
window.setCL=v=>{catCfg.level=v;viewCatSetup();};window.setCN=v=>{catCfg.n=v;viewCatSetup();};
let asCfg={kind:'std',len:'full'};
function viewAssessSetup(){$('#app').innerHTML=`<div class="card"><h3>Timed assessment</h3>
  <p class="small muted">Questions from all nine categories in mixed order. You can skip, flag and go back. Answers and explanations are shown at the end.</p>
  <div class="row" style="margin:10px 0"><span class="small" style="width:90px">Format</span>${segBtns('len',[['full','50 questions · 20 min'],['half','25 questions · 10 min']],asCfg.len,'setAL')}</div>
  <div class="row" style="margin:10px 0"><span class="small" style="width:90px">Difficulty</span>${segBtns('k',[['std','Standard mix'],['adapt','Matched to my level']],asCfg.kind,'setAK')}</div>
  <p class="tiny muted">Standard mix spans Basic to Legendary, roughly easier first. "Matched" centres each category on your current level.</p>
  <div class="row" style="margin-top:14px"><button class="btn" onclick="startAssess()">Start assessment</button><button class="btn sec" onclick="go('home')">Back</button></div></div>`;}
window.setAL=v=>{asCfg.len=v;viewAssessSetup();};window.setAK=v=>{asCfg.kind=v;viewAssessSetup();};

// ---------------- sessions ----------------
function newSess(mode,opt){return {mode,opt:opt||{},qs:[],ans:[],i:0,recent:[],recentF:[],used:new Set(),start:Date.now(),ab0:{...S.ability},done:false};}
window.startAdaptive=()=>{SESS=newSess('adaptive',{endless:true});nextQ();};
window.startQuick=()=>{if(!qsCfg.cats.length){toast('Pick at least one category');return;}SESS=newSess('quick',{n:qsCfg.n,cats:qsCfg.cats.slice(),level:qsCfg.level});nextQ();};
window.startCat=(c,level,n)=>{SESS=newSess('cat',{cat:c,level:level||0,n:n===undefined?20:n,endless:n===0});nextQ();};
window.startAssess=()=>{const full=asCfg.len==='full';SESS=newSess('assess',{n:full?50:25,limit:(full?20:10)*60000,adaptive:asCfg.kind==='adapt'});
  SESS.qs=E.buildAssessment(I,S,{n:SESS.opt.n,adaptive:SESS.opt.adaptive});SESS.qs.forEach(q=>SESS.ans.push(mkAns(q)));SESS.deadline=Date.now()+SESS.opt.limit;SESS.i=0;SESS.enter=Date.now();VIEW='session';renderQ();tick();};
function mkAns(q){const n=q.o.length;let perm=[...Array(n).keys()];if(!q.fo){for(let i=n-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[perm[i],perm[j]]=[perm[j],perm[i]];}}return {perm,choice:null,ms:0,flag:false,ok:null};}
function nextQ(){const s=SESS;if(!s)return;const o=s.opt;
  if(!o.endless&&s.qs.length>=o.n)return finishImmediate();
  let q=null;if(s.mode==='adaptive')q=E.nextAdaptive(I,S,{recent:s.recent,recentF:s.recentF,used:s.used});
  else if(s.mode==='quick')q=E.nextAdaptive(I,S,{recent:s.recent,recentF:s.recentF,used:s.used,cats:o.cats,level:o.level||null});
  else q=E.nextAdaptive(I,S,{cat:o.cat,recentF:s.recentF,used:s.used,level:o.level||null});
  if(!q){toast('No more questions available for this selection');return finishImmediate();}
  s.qs.push(q);s.ans.push(mkAns(q));s.used.add(q.id);s.recent.push(q.c);s.recentF.push(q.f);s.i=s.qs.length-1;s.enter=Date.now();VIEW='session';renderQ();tick();}
function tick(){clearInterval(tick._t);tick._t=setInterval(()=>{const s=SESS;if(!s||s.done||VIEW!=='session'){clearInterval(tick._t);return;}const el=$('#tmr');if(!el)return;
  if(s.mode==='assess'){const left=s.deadline-Date.now();el.textContent=mmss(left);el.classList.toggle('low',left<60000);if(left<=0){submitAssess(true);}}
  else{const a=s.ans[s.i];if(a.choice===null)el.textContent=secs(Date.now()-s.enter);}},250);}

function figHTML(p,cls){const w=p.w||100,h=p.h||100;let sv=G.svg(p,'fig');if(cls==='one')sv=sv.replace('class="fig"',`class="fig" style="width:${Math.min(420,w*2.3)}px"`);return sv;}
function stemVis(v){if(!v)return '';const ps=v.ps;if(v.lay==='ana')return `<div class="vis">${figHTML(ps[0])}<span class="sep">is to</span>${figHTML(ps[1])}<span class="sep">as</span>${figHTML(ps[2])}<span class="sep">is to</span>${figHTML(ps[3])}</div>`;
  if(v.lay==='grid3')return `<div class="vis grid3">${ps.map(p=>figHTML(p)).join('')}</div>`;
  if(v.lay==='one'||v.lay==='one1')return `<div class="vis ${v.lay}">${ps.map(p=>figHTML(p,v.lay)).join('')}</div>`;
  return `<div class="vis">${ps.map(p=>figHTML(p)).join('')}</div>`;}
function renderQ(){const s=SESS,q=s.qs[s.i],a=s.ans[s.i];const fig=q.ot==='f';const K='ABCDEFGH';const answered=a.choice!==null;const imm=s.mode!=='assess';
  const total=s.mode==='assess'?s.qs.length:(s.opt.endless?null:s.opt.n);
  const prog=total?`<div class="prog"><i style="width:${Math.round(100*(s.i+(answered&&imm?1:0))/total)}%"></i></div>`:'';
  const head=`<div class="qbar"><span class="qn">${total?(s.i+1)+' / '+total:'#'+(s.i+1)}</span><span class="qc">${E.CATNAME[q.c]}<span class="qf"> · ${E.FMT[q.f]||q.f}</span></span>${imm?`<span class="chip">${E.LEVELS[q.d]}</span>`:''}<span class="sp"></span>${s.mode==='assess'||S.settings.qtimer?`<span class="timer" id="tmr"></span>`:'<span id="tmr" style="display:none"></span>'}<button class="btn sec sm" onclick="${s.mode==='assess'?'askSubmit()':'finishImmediate()'}">${s.mode==='assess'?'Submit':'End'}</button></div>`;
  const opts=a.perm.map((oi,k)=>{const o=q.o[oi];let cls='opt'+(q.mono||(!fig&&/[★●▲■◆♥]/.test(o))?' mono':'');
    if(answered&&imm){if(oi===q.a)cls+=' ok';else if(oi===a.choice)cls+=' bad';}else if(answered&&oi===a.choice)cls+=' sel';
    return `<button class="${cls}" onclick="choose(${k})" ${answered&&imm?'disabled':''}><span class="k">${K[k]}</span>${fig?figHTML(o):`<span>${esc(o)}</span>`}</button>`;}).join('');
  let fb='';if(answered&&imm){fb=`<div class="fb"><b class="${a.ok?'ok':'bad'}">${a.ok?'Correct':'Incorrect'}</b> <span class="muted small">· ${secs(a.ms)}${q.tt?' (target '+q.tt+'s)':''}</span><div style="margin-top:6px">${fig?'':(!a.ok?'Answer: <b>'+esc(q.o[q.a])+'</b>. ':'')}${esc(q.e)}</div>
    <div class="tiny muted" style="margin-top:8px">${q.id} · <a href="#" onclick="reportQ();return false" style="color:inherit">Report a problem with this question</a></div><div id="rep"></div></div>`;}
  const foot=imm?(answered?`<div class="foot"><button class="btn" id="nextb" onclick="nextQ()">Next</button><span class="kbd">Enter ↵</span></div>`:`<div class="foot"><span class="kbd">Keys 1–${q.o.length} or A–${K[q.o.length-1]} to answer</span></div>`)
    :`<div class="foot"><button class="btn sec" onclick="navQ(-1)" ${s.i===0?'disabled':''}>← Prev</button><button class="btn" onclick="navQ(1)">${s.i===s.qs.length-1?'Finish':'Next →'}</button><button class="btn sec sm" onclick="flagQ()">${a.flag?'Unflag':'Flag'}</button><span class="sp"></span><span class="kbd">1–${q.o.length} answer · ←/→ move · F flag</span></div>
      <div class="navgrid">${s.qs.map((_,k)=>`<button class="${s.ans[k].choice!==null?'ans':''} ${k===s.i?'cur':''} ${s.ans[k].flag?'flag':''}" onclick="jumpQ(${k})">${k+1}</button>`).join('')}</div>`;
  $('#app').innerHTML=`<div class="card">${head}${prog}<div class="qtext">${esc(q.p)}</div>${q.s?`<div class="stem ${q.pr?'prose':q.s.includes('\n')||q.s.length>40?'multi':''}">${esc(q.s)}</div>`:''}${stemVis(q.v)}<div class="opts ${fig?'f':''} ${q.o.length>6?'o8':''}">${opts}</div>${fb}${foot}</div>`;
  const t=$('#tmr');if(t){if(s.mode==='assess')t.textContent=mmss(s.deadline-Date.now());else t.textContent=answered?'':secs(Date.now()-s.enter);}
  if(answered&&imm){const nb=$('#nextb');if(nb)nb.focus();}}
window.choose=k=>{const s=SESS;if(!s||s.done)return;const q=s.qs[s.i],a=s.ans[s.i];const imm=s.mode!=='assess';if(imm&&a.choice!==null)return;
  const oi=a.perm[k];if(oi===undefined)return;
  if(imm){a.choice=oi;a.ms=Date.now()-s.enter;a.ok=oi===q.a;const u=E.update(S,q,a.ok,a.ms);a.th=u;Store.touch(q);renderQ();}
  else{a.choice=a.choice===oi?null:oi;renderQ();}};
function leaveCur(){const s=SESS;const a=s.ans[s.i];a.ms+=Date.now()-s.enter;s.enter=Date.now();}
window.navQ=d=>{const s=SESS;leaveCur();if(s.i+d>=s.qs.length){askSubmit();return;}s.i=Math.max(0,s.i+d);renderQ();};
window.jumpQ=k=>{leaveCur();SESS.i=k;renderQ();};
window.flagQ=()=>{const a=SESS.ans[SESS.i];a.flag=!a.flag;renderQ();};
window.askSubmit=()=>{const s=SESS;const un=s.ans.filter(a=>a.choice===null).length;const el=document.createElement('div');el.className='fb';
  el.innerHTML=`${un?`<b>${un} unanswered.</b> `:''}Submit the assessment now? <button class="btn sm" onclick="submitAssess()">Submit</button> <button class="btn sec sm" onclick="this.parentNode.remove()">Keep going</button>`;$('#app .card').appendChild(el);el.scrollIntoView({behavior:'smooth',block:'nearest'});};
window.submitAssess=(timeUp)=>{const s=SESS;if(!s||s.done)return;leaveCur();s.done=true;clearInterval(tick._t);
  s.qs.forEach((q,k)=>{const a=s.ans[k];if(a.choice===null)return;a.ok=a.choice===q.a;E.update(S,q,a.ok,a.ms);});
  recordSession(s);Store.flush();if(timeUp)toast('Time is up');renderAssessResults();};
window.finishImmediate=()=>{const s=SESS;if(!s)return;const answered=s.ans.filter(a=>a.choice!==null).length;if(!answered){SESS=null;go('home');return;}s.done=true;clearInterval(tick._t);
  // drop the unanswered trailing question
  if(s.ans[s.ans.length-1].choice===null){s.qs.pop();s.ans.pop();}recordSession(s);Store.flush();renderImmResults();};
function endSession(silent){const s=SESS;if(!s)return;if(s.mode!=='assess'&&s.ans.some(a=>a.choice!==null)){if(s.ans[s.ans.length-1].choice===null){s.qs.pop();s.ans.pop();}recordSession(s);Store.flush();}clearInterval(tick._t);SESS=null;}
function recordSession(s){const n=s.qs.length,ans=s.ans.filter(a=>a.choice!==null);const c=s.ans.filter(a=>a.ok).length;const ms=ans.reduce((t,a)=>t+a.ms,0);const cats={};
  s.qs.forEach((q,k)=>{const a=s.ans[k];const x=cats[q.c]||(cats[q.c]=[0,0]);x[0]++;if(a.ok)x[1]++;});
  S.sessions.push({ts:Date.now(),mode:s.mode,n,a:ans.length,c,ms,dur:Date.now()-s.start,cats,avgD:+(s.qs.reduce((t,q)=>t+q.d,0)/Math.max(1,n)).toFixed(2)});if(S.sessions.length>300)S.sessions.splice(0,S.sessions.length-300);
  S.hist.push({ts:Date.now(),ab:Object.fromEntries(E.CATS.map(([k])=>[k,+S.ability[k].toFixed(3)]))});if(S.hist.length>400)S.hist.splice(0,S.hist.length-400);Store.touch();}
function catBreak(s){const rows={};s.qs.forEach((q,k)=>{const a=s.ans[k];const r=rows[q.c]||(rows[q.c]={n:0,c:0,ms:0,a:0});r.n++;if(a.ok)r.c++;if(a.choice!==null){r.a++;r.ms+=a.ms;}});
  return `<table><tr><th>Category</th><th>Score</th><th>Avg time</th><th>Level now</th></tr>${Object.entries(rows).map(([c,r])=>{const d=S.ability[c]-s.ab0[c];return `<tr><td>${E.CATNAME[c]}</td><td>${r.c}/${r.n}</td><td>${r.a?secs(r.ms/r.a):'–'}</td><td>${S.ability[c].toFixed(2)} <span class="tiny" style="color:${d>=0?'var(--ok)':'var(--bad)'}">${d>=0?'▲':'▼'}${Math.abs(d).toFixed(2)}</span></td></tr>`;}).join('')}</table>`;}
function reviewList(s,filter){const K='ABCDEFGH';return s.qs.map((q,k)=>({q,a:s.ans[k],k})).filter(({a})=>filter==='all'||(filter==='wrong'&&!a.ok)||(filter==='flag'&&a.flag)).map(({q,a,k})=>{const fig=q.ot==='f';
  const optsH=q.o.map((o,oi)=>{const pos=a.perm.indexOf(oi);let cls='opt'+(q.mono?' mono':'');if(oi===q.a)cls+=' ok';else if(oi===a.choice)cls+=' bad';return {pos,h:`<div class="${cls}" style="cursor:default"><span class="k">${K[pos]}</span>${fig?figHTML(o):`<span>${esc(o)}</span>`}</div>`};}).sort((x,y)=>x.pos-y.pos).map(x=>x.h).join('');
  return `<div class="rev"><div class="small muted">Q${k+1} · ${E.CATNAME[q.c]} · ${E.FMT[q.f]||q.f} · ${E.LEVELS[q.d]} · ${a.choice===null?'<b style="color:var(--warn)">Not answered</b>':a.ok?'<b style="color:var(--ok)">Correct</b>':'<b style="color:var(--bad)">Incorrect</b>'}${a.ms?' · '+secs(a.ms):''}</div>
   <div class="qtext" style="font-size:15px;margin-top:6px">${esc(q.p)}</div>${q.s?`<div class="stem ${q.pr?'prose':'multi'}">${esc(q.s)}</div>`:''}${stemVis(q.v)}<div class="opts ${fig?'f':''} ${q.o.length>6?'o8':''}">${optsH}</div><div class="fb">${esc(q.e)}<div class="tiny muted" style="margin-top:6px">${q.id}</div></div></div>`;}).join('')||'<p class="muted small">Nothing to show.</p>';}
let RF='wrong';
function renderAssessResults(){const s=SESS;const n=s.qs.length,c=s.ans.filter(a=>a.ok).length,an=s.ans.filter(a=>a.choice!==null).length;const used=Math.min(s.opt.limit,Date.now()-s.start);
  $('#app').innerHTML=`<div class="card"><h3>Assessment complete</h3><div class="grid g4" style="margin:10px 0">
   <div class="kpi"><div class="v">${c}/${n}</div><div class="l">Score (${pct(c,n)})</div></div><div class="kpi"><div class="v">${an}</div><div class="l">Answered</div></div>
   <div class="kpi"><div class="v">${mmss(used)}</div><div class="l">Time used of ${mmss(s.opt.limit)}</div></div><div class="kpi"><div class="v">${an?secs(s.ans.reduce((t,a)=>t+(a.choice!==null?a.ms:0),0)/an):'–'}</div><div class="l">Avg per answered</div></div></div>
   ${catBreak(s)}<div class="row" style="margin-top:14px"><button class="btn" onclick="SESS=null;go('home')">Done</button><button class="btn sec" onclick="SESS=null;startAssessAgain()">New assessment</button></div></div>
   <h2>Review</h2><div class="row" style="margin-bottom:8px">${segBtns('rf',[['wrong','Incorrect & unanswered'],['flag','Flagged'],['all','All']],RF,'setRF')}</div><div class="card" id="revlist">${reviewList(s,RF)}</div>`;}
window.setRF=v=>{RF=v;renderAssessResults();};window.startAssessAgain=()=>go('assess');
function renderImmResults(){const s=SESS;const n=s.qs.length,c=s.ans.filter(a=>a.ok).length;const ms=s.ans.reduce((t,a)=>t+a.ms,0);
  $('#app').innerHTML=`<div class="card"><h3>Session complete</h3><div class="grid g4" style="margin:10px 0"><div class="kpi"><div class="v">${c}/${n}</div><div class="l">Correct (${pct(c,n)})</div></div><div class="kpi"><div class="v">${n?secs(ms/n):'–'}</div><div class="l">Average time</div></div><div class="kpi"><div class="v">${(s.qs.reduce((t,q)=>t+q.d,0)/Math.max(1,n)).toFixed(1)}</div><div class="l">Average difficulty</div></div><div class="kpi"><div class="v">${E.overall(S).toFixed(2)}</div><div class="l">Overall level now</div></div></div>
   ${catBreak(s)}<div class="row" style="margin-top:14px"><button class="btn" onclick="SESS=null;go('home')">Done</button></div></div>
   <h2>Mistakes</h2><div class="card">${reviewList(s,'wrong')}</div>`;}
window.reportQ=()=>{const box=$('#rep');if(!box)return;box.innerHTML=`<div style="margin-top:8px"><textarea id="repn" style="min-height:60px" placeholder="What's wrong? (e.g. two answers seem correct, explanation is wrong, figure unclear)"></textarea><div class="row" style="margin-top:6px"><button class="btn sm" onclick="sendReport()">Send report</button><span class="tiny muted">The question will also be removed from your rotation.</span></div></div>`;};
window.sendReport=async()=>{const s=SESS;const q=s.qs[s.i];const note=$('#repn').value;S.flags[q.id]={ts:Date.now(),note:note.slice(0,300)};Store.touch();const ok=await Store.report(q,note);$('#rep').innerHTML=`<div class="tiny" style="margin-top:6px">${ok?'Reported — thanks. This question is now excluded.':'Saved locally and excluded from your rotation.'}</div>`;};
document.addEventListener('keydown',e=>{if(VIEW!=='session'||!SESS||SESS.done)return;if(e.target&&(e.target.tagName==='TEXTAREA'||e.target.tagName==='INPUT'))return;const s=SESS,q=s.qs[s.i],a=s.ans[s.i];const imm=s.mode!=='assess';
  const k=e.key.toLowerCase();let idx=-1;if(/^[1-8]$/.test(k))idx=+k-1;else if(/^[a-h]$/.test(k)&&!(k==='f'&&!imm))idx=k.charCodeAt(0)-97;
  if(idx>=0&&idx<q.o.length){e.preventDefault();window.choose(idx);return;}
  if(imm&&e.key==='Enter'&&a.choice!==null){e.preventDefault();nextQ();return;}
  if(!imm){if(e.key==='ArrowRight'){e.preventDefault();navQ(1);}else if(e.key==='ArrowLeft'){e.preventDefault();navQ(-1);}else if(k==='f'){e.preventDefault();flagQ();}}});

// ---------------- progress ----------------
let STATCAT='all';
function spark(vals,w,h){if(vals.length<2)return '<span class="tiny muted">–</span>';const mn=1,mx=6.5;const pts=vals.map((v,i)=>`${(i/(vals.length-1)*w).toFixed(1)},${(h-(v-mn)/(mx-mn)*h).toFixed(1)}`).join(' ');return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><polyline points="${pts}" fill="none" stroke="var(--acc)" stroke-width="1.6"/></svg>`;}
function chart(){const H=S.hist;if(H.length<2)return '<p class="small muted">Complete a couple of sessions to see your progression.</p>';const W=820,Ht=220,pl=34,pb=22;const xs=i=>pl+i/(H.length-1)*(W-pl-10),ys=v=>10+(6.5-v)/5.5*(Ht-pb-10);
  const series=STATCAT==='all'?H.map(h=>E.CATS.reduce((a,[c])=>a+(h.ab[c]||1.6),0)/E.CATS.length):H.map(h=>h.ab[STATCAT]||1.6);
  let g='';for(let l=1;l<=6;l++)g+=`<line x1="${pl}" x2="${W-10}" y1="${ys(l)}" y2="${ys(l)}" stroke="var(--line)"/><text x="4" y="${ys(l)+4}" font-size="11" fill="var(--mute)">L${l}</text>`;
  const pts=series.map((v,i)=>`${xs(i).toFixed(1)},${ys(v).toFixed(1)}`).join(' ');
  return `<svg viewBox="0 0 ${W} ${Ht}" style="width:100%;height:auto">${g}<polyline points="${pts}" fill="none" stroke="var(--acc)" stroke-width="2.2"/>${series.map((v,i)=>`<circle cx="${xs(i)}" cy="${ys(v)}" r="2.4" fill="var(--acc)"><title>${new Date(H[i].ts).toLocaleDateString()} · ${v.toFixed(2)}</title></circle>`).join('')}<text x="${pl}" y="${Ht-4}" font-size="11" fill="var(--mute)">First session</text><text x="${W-10}" y="${Ht-4}" font-size="11" fill="var(--mute)" text-anchor="end">Latest</text></svg>`;}
function viewStats(){const tot=E.CATS.reduce((a,[c])=>a+S.stats[c].n,0),cor=E.CATS.reduce((a,[c])=>a+S.stats[c].c,0),tms=E.CATS.reduce((a,[c])=>a+S.stats[c].t,0);
  const fmts=[];for(const [c] of E.CATS)for(const [f,v] of Object.entries(S.stats[c].f))if(v[0]>=5)fmts.push({c,f,n:v[0],acc:v[1]/v[0],t:v[2]/v[0]});fmts.sort((a,b)=>a.acc-b.acc);
  $('#app').innerHTML=`<div class="toprow">${levelTile(E.overall(S))}<div class="stat"><div class="v">${tot.toLocaleString()}</div><div class="l">Answered · ${S.sessions.length} sessions</div></div><div class="stat"><div class="v">${pct(cor,tot)}</div><div class="l">Accuracy</div></div><div class="stat"><div class="v">${tot?secs(tms/tot):'–'}</div><div class="l">Average time</div></div></div>
  <h2>Difficulty progression</h2><div class="card"><div class="row" style="margin-bottom:8px"><select onchange="STATCAT=this.value;viewStats()" style="font:inherit;padding:4px 8px;border-radius:8px;border:1px solid var(--line);background:var(--card);color:var(--ink)"><option value="all">Overall</option>${E.CATS.map(([c,n])=>`<option value="${c}" ${STATCAT===c?'selected':''}>${n}</option>`).join('')}</select><span class="tiny muted">Estimated ability after each session (L1 Basic → L6 Legendary)</span></div>${chart()}</div>
  <h2>Categories</h2><div class="card" style="overflow-x:auto"><table><tr><th>Category</th><th>Level</th><th>Trend</th><th>Accuracy</th><th>Avg time</th><th>Answered</th><th>Bank seen</th></tr>
   ${E.CATS.map(([c,n])=>{const st=S.stats[c],p=E.poolInfo(I,S,c);return `<tr><td>${n}</td><td><div class="row" style="gap:8px;flex-wrap:nowrap"><div class="bar" style="width:70px"><i style="width:${Math.round(100*(S.ability[c]-1)/5.5)}%;background:${lvColor(S.ability[c])}"></i></div><span>${S.ability[c].toFixed(2)}</span><span class="lvl" style="color:${lvColor(S.ability[c])}">${E.levelName(S.ability[c])}</span></div></td><td>${spark(S.hist.slice(-30).map(h=>h.ab[c]||1.6),80,22)}</td><td>${pct(st.c,st.n)}</td><td>${st.n?secs(st.t/st.n):'–'}</td><td>${st.n}</td><td>${p.seen}/${p.tot}</td></tr>`;}).join('')}</table></div>
  <h2>Accuracy by difficulty</h2><div class="card" style="overflow-x:auto"><table><tr><th>Category</th>${[1,2,3,4,5,6].map(l=>`<th>L${l} ${E.LEVELS[l]}</th>`).join('')}</tr>${E.CATS.map(([c,n])=>`<tr><td>${n}</td>${[1,2,3,4,5,6].map(l=>{const v=S.stats[c].d[l];return `<td>${v?pct(v[1],v[0])+' <span class="tiny muted">('+v[0]+')</span>':'<span class="muted">–</span>'}</td>`;}).join('')}</tr>`).join('')}</table></div>
  <h2>Weakest question types</h2><div class="card">${fmts.length?`<table><tr><th>Type</th><th>Category</th><th>Accuracy</th><th>Avg time</th><th>Attempts</th><th></th></tr>${fmts.slice(0,8).map(x=>`<tr><td>${E.FMT[x.f]||x.f}</td><td>${E.CATNAME[x.c]}</td><td>${Math.round(x.acc*100)}%</td><td>${secs(x.t)}</td><td>${x.n}</td><td><button class="btn sec sm" onclick="startCat('${x.c}',0)">Practise</button></td></tr>`).join('')}</table>`:'<p class="small muted">Shown once you have 5+ attempts at a question type.</p>'}</div>
  <h2>Recent sessions</h2><div class="card">${S.sessions.length?`<table><tr><th>Date</th><th>Mode</th><th>Score</th><th>Avg difficulty</th><th>Duration</th></tr>${S.sessions.slice(-15).reverse().map(x=>`<tr><td>${new Date(x.ts).toLocaleString([], {dateStyle:'medium',timeStyle:'short'})}</td><td>${{assess:'Timed assessment',quick:'Quick practice',cat:'Category practice',adaptive:'Adaptive practice'}[x.mode]}</td><td>${x.c}/${x.n} (${pct(x.c,x.n)})</td><td>${x.avgD||'–'}</td><td>${mmss(x.dur)}</td></tr>`).join('')}</table>`:'<p class="small muted">No sessions yet.</p>'}</div>`;}

// ---------------- settings ----------------
function viewSettings(){const by={};for(const q of BANK){by[q.c]=by[q.c]||[0,0,0,0,0,0,0];by[q.c][q.d]++;by[q.c][0]++;}const nflag=Object.keys(S.flags).length;
  $('#app').innerHTML=`<div class="card"><h3>Preferences</h3><label class="chk"><input type="checkbox" ${S.settings.qtimer?'checked':''} onchange="S.settings.qtimer=this.checked;Store.touch()"> Show a per-question timer in practice modes</label></div>
  <h2>Your data</h2><div class="card"><p class="small">${Store.cloud?'Progress syncs to your private store for this app, so it follows you across devices.':'Progress is saved in this browser only (cloud sync unavailable in this view).'} ${nflag?`${nflag} question${nflag>1?'s':''} reported and excluded. <button class="btn sec sm" onclick="S.flags={};Store.touch();viewSettings()">Restore</button>`:''}</p>
   <div class="row"><button class="btn sec sm" onclick="exportData()">Export backup</button><button class="btn sec sm" onclick="importData()">Import backup</button><span class="sp"></span><button class="btn sec sm" id="rst" onclick="resetData()" style="color:var(--bad)">Reset all progress</button></div><div id="io"></div></div>
  ${IS_PWA&&!IS_APP?`<h2>Install on your phone</h2><div class="card small"><p><b>iPhone (Safari):</b> tap the Share button, then <b>Add to Home Screen</b>.</p><p><b>Android (Chrome):</b> tap the ⋮ menu, then <b>Install app</b> (or Add to Home screen).</p><p class="muted tiny">Once installed it opens full-screen and works offline. Progress is stored on the phone — use Export backup occasionally.</p></div>`:''}
  <h2>Question bank</h2><div class="card" style="overflow-x:auto"><p class="tiny muted">Version ${esc(window.BANK_VERSION)} · ${BANK.length.toLocaleString()} questions, each machine-checked for a single defensible answer.</p><table><tr><th>Category</th><th>Total</th>${[1,2,3,4,5,6].map(l=>`<th>L${l}</th>`).join('')}</tr>${E.CATS.map(([c,n])=>`<tr><td>${n}</td><td>${by[c][0]}</td>${[1,2,3,4,5,6].map(l=>`<td>${by[c][l]}</td>`).join('')}</tr>`).join('')}</table></div>`;}
window.exportData=()=>{$('#io').innerHTML=`<p class="tiny muted" style="margin-top:10px">Copy this text somewhere safe.</p><textarea id="iot" readonly>${esc(JSON.stringify(S))}</textarea><button class="btn sm" onclick="navigator.clipboard.writeText($('#iot').value).then(()=>toast('Copied'),()=>{$('#iot').select();toast('Select and copy manually');})">Copy</button>`;};
window.importData=()=>{$('#io').innerHTML=`<p class="tiny muted" style="margin-top:10px">Paste a backup. This replaces your current progress.</p><textarea id="iot"></textarea><button class="btn sm" onclick="doImport()">Import</button>`;};
window.doImport=()=>{try{const d=JSON.parse($('#iot').value);if(!d||!d.ability||!d.stats)throw new Error('not a backup');S=E.normState(d);S.updated=Date.now();Store.markAll();Store.flush();toast('Backup imported');viewSettings();}catch(e){toast('Could not read that backup');}};
window.resetData=()=>{const b=$('#rst');if(b.dataset.c){S=E.newState();Store.markAll();Store.flush();toast('Progress reset');viewSettings();}else{b.dataset.c=1;b.textContent='Click again to confirm reset';setTimeout(()=>{if(b){b.dataset.c='';b.textContent='Reset all progress';}},4000);}};
Object.assign(window,{go,nextQ,Store});
boot();
