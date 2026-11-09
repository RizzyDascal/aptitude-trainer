// Aptitude Trainer engine: ability model, question selection, session building. Pure logic (no DOM) so it can be tested in Node.
(function(root){
const CATS=[['seq','Number sequences'],['odd','Odd one out'],['verb','Verbal reasoning'],['logic','Logical deduction'],['abstract','Abstract reasoning'],['spatial','Spatial reasoning'],['compare','Picture comparison'],['math','Maths & arithmetic'],['code','Coding & symbols']];
const CATNAME=Object.fromEntries(CATS);
const LEVELS=['','Basic','Intermediate','Advanced','Hard','Elite'];
const FMT={next:'What comes next',missing:'Missing number',wrong:'Find the wrong number',rows:'Row rules',pyramid:'Number pyramids',num:'Numbers',pairs:'Number pairs',words:'Word categories',anagram:'Anagram sets',alpha:'Letter order',letters:'Letter groups',symbols:'Symbol patterns',shapes:'Shapes',analogy:'Analogies',isa:'Category analogies',synonym:'Synonyms',antonym:'Antonyms',oppanalogy:'Opposite analogies',compound:'Compound words',makeword:'Word building',anagcat:'Anagrams',alphaorder:'Alphabetical order',rank:'Ordering',seat:'Seating',syllogism:'Syllogisms',conditional:'If–then logic',calendar:'Calendar',liars:'Truth-tellers & liars',matching:'Matching puzzles',series:'Figure series',matrix:'Matrices',overlay:'Overlay matrices',rotate:'Rotation',mirror:'Reflection',gridrot:'Grid rotation',netfold:'Cube nets',netopp:'Cube faces',punch:'Paper folding',compass:'Directions',clock:'Clocks',oddimg:'Spot the difference',match:'Exact match',rotmatch:'Rotated match',strings:'Clerical checking',griddiff:'Grid differences',arith:'Mental arithmetic',operators:'Missing operators',word:'Word problems',cipher:'Letter codes',numcode:'Number codes',letterseq:'Letter series',symmath:'Symbol equations',codelang:'Code language',symseq:'Symbol transformations',groupfit:'Best fit with group',relation:'Similar / opposite / unrelated',meaning:'Meaning odd one out',twomissing:'Two missing numbers',grid:'Number grids',algebra:'Algebraic reasoning',marked:'Marked figure series'};
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
function newState(){const ab={},st={};for(const [c] of CATS){ab[c]=1.4;st[c]={n:0,c:0,t:0,d:{},f:{}};}
  return {v:1,created:Date.now(),updated:Date.now(),ability:ab,stats:st,seen:{},sessions:[],hist:[],flags:{},settings:{qtimer:true}};}
function normState(s){const b=newState();if(!s||typeof s!=='object')return b;for(const k of Object.keys(b))if(s[k]===undefined)s[k]=b[k];for(const [c] of CATS){if(s.ability[c]===undefined)s.ability[c]=1.4;if(!s.stats[c])s.stats[c]={n:0,c:0,t:0,d:{},f:{}};}return s;}
// probability of success; target ~70% when ability == difficulty
const pCorrect=(th,d)=>1/(1+Math.exp(-(1.5*(th-d)+0.85)));
function score(correct,ms,tt){if(!correct)return 0;const r=ms/1000/(tt||40);return r<=1?1:clamp(1-0.25*(r-1),0.75,1);}
function update(S,q,correct,ms,choice){const c=q.c,st=S.stats[c];const th=S.ability[c];const P=pCorrect(th,q.d);const s=score(correct,ms,q.tt);
  const K=Math.max(0.1,0.55/Math.sqrt(1+st.n/10));S.ability[c]=clamp(th+K*(s-P),1,5.5);
  st.n++;if(correct)st.c++;st.t+=ms;const dd=st.d[q.d]||(st.d[q.d]=[0,0,0]);dd[0]++;if(correct)dd[1]++;dd[2]+=ms;const ff=st.f[q.f]||(st.f[q.f]=[0,0,0]);ff[0]++;if(correct)ff[1]++;ff[2]+=ms;
  const sn=S.seen[q.id]||[0,0,0,0];sn[0]++;if(correct)sn[1]++;sn[2]=Math.floor(Date.now()/1000);sn[3]=correct?1:0;S.seen[q.id]=sn;S.updated=Date.now();
  return {before:th,after:S.ability[c],P};}
// index: cat -> level -> [questions]
function buildIndex(bank){const ix={},byId={};for(const [c] of CATS){ix[c]={1:[],2:[],3:[],4:[],5:[]};}for(const q of bank){if(ix[q.c])ix[q.c][q.d].push(q);byId[q.id]=q;}return {ix,byId,bank};}
function rnd(a){return a[Math.floor(Math.random()*a.length)];}
// Pick one question: unseen first (target level, then nearest levels), then spaced review of seen ones (wrong + oldest first).
function pick(I,S,c,d,ctx){ctx=ctx||{};const used=ctx.used||new Set(),avoidF=ctx.avoidF||[];const order=[d,d+1,d-1,d+2,d-2].filter(x=>x>=1&&x<=5);
  for(const lv of order){const pool=I.ix[c][lv].filter(q=>!S.seen[q.id]&&!used.has(q.id)&&!S.flags[q.id]);if(pool.length){const fresh=pool.filter(q=>!avoidF.includes(q.f));return rnd(fresh.length?fresh:pool);}}
  // pool exhausted at nearby levels: review seen questions, prioritising previous mistakes and the longest-unseen
  for(const lv of order){const pool=I.ix[c][lv].filter(q=>!used.has(q.id)&&!S.flags[q.id]);if(!pool.length)continue;
    pool.sort((a,b)=>{const sa=S.seen[a.id]||[0,0,0,1],sb=S.seen[b.id]||[0,0,0,1];return (sa[3]-sb[3])||(sa[2]-sb[2]);});return rnd(pool.slice(0,Math.max(1,Math.ceil(pool.length*0.15))));}
  return null;}
function targetLevel(th){const u=Math.random();const off=u<0.15?-1:u<0.68?0:1;return clamp(Math.round(th-0.25+off),1,5);}
// adaptive category choice: weaker and less-practised categories weighted up; avoid long runs of one category
function chooseCat(S,recent,allowed){const cs=(allowed&&allowed.length?allowed:CATS.map(x=>x[0]));if(cs.length===1)return cs[0];const ths=cs.map(c=>S.ability[c]);const mx=Math.max(...ths),mn=Math.min(...ths);
  const w=cs.map(c=>{let x=1+1.6*(mx-S.ability[c])/(mx-mn+0.6)+0.8/Math.sqrt(1+S.stats[c].n/15);const last=recent.slice(-6);if(!last.includes(c))x+=0.6;if(recent.slice(-2).every(y=>y===c))x*=0.15;return x;});
  let t=Math.random()*w.reduce((a,b)=>a+b,0);for(let i=0;i<cs.length;i++){t-=w[i];if(t<=0)return cs[i];}return cs[cs.length-1];}
function nextAdaptive(I,S,opt){opt=opt||{};const recent=opt.recent||[];const c=opt.cat||chooseCat(S,recent,opt.cats);const d=opt.level||targetLevel(S.ability[c]);
  const lastF=(opt.recentF||[]).slice(-3);return pick(I,S,c,d,{used:opt.used,avoidF:lastF});}
// timed assessment: 50 questions spread over all categories; difficulty either a standard recruitment-style mix or centred on ability
function buildAssessment(I,S,opt){opt=opt||{};const N=opt.n||50;const cs=CATS.map(x=>x[0]);const per={};cs.forEach(c=>per[c]=Math.floor(N/cs.length));let rem=N-cs.length*Math.floor(N/cs.length);
  const order=cs.slice().sort(()=>Math.random()-0.5);for(let i=0;i<rem;i++)per[order[i]]++;
  const mix=[1,1,2,2,2,3,3,3,4,4,5];const used=new Set(),qs=[];
  for(const c of cs){const lastF=[];for(let k=0;k<per[c];k++){const d=opt.adaptive?targetLevel(S.ability[c]):rnd(mix);const q=pick(I,S,c,d,{used,avoidF:lastF.slice(-2)});if(q){used.add(q.id);qs.push(q);lastF.push(q.f);}}}
  // interleave so categories are mixed, roughly easier-first like real tests
  qs.sort((a,b)=>(a.d+Math.random()*2.2)-(b.d+Math.random()*2.2));return qs;}
function overall(S){const v=CATS.map(([c])=>S.ability[c]);return v.reduce((a,b)=>a+b,0)/v.length;}
function levelName(th){return LEVELS[clamp(Math.round(th),1,5)];}
function poolInfo(I,S,c){let tot=0,seen=0;for(let d=1;d<=5;d++)for(const q of I.ix[c][d]){tot++;if(S.seen[q.id])seen++;}return {tot,seen};}
const API={CATS,CATNAME,LEVELS,FMT,newState,normState,pCorrect,score,update,buildIndex,pick,targetLevel,chooseCat,nextAdaptive,buildAssessment,overall,levelName,poolInfo,clamp};
if(typeof module!=='undefined'&&module.exports)module.exports=API;else root.Engine=API;
})(typeof window!=='undefined'?window:globalThis);
