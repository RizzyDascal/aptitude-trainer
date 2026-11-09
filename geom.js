// Geometry: shape library, primitives, canonical keys, SVG rendering.
// Shared by the build (validation) and the browser app (rendering) - single source of truth.
(function(root){
const D2R=Math.PI/180;
function reg(n,start){const p=[];for(let i=0;i<n;i++){const a=(start+360*i/n)*D2R;p.push([Math.cos(a),Math.sin(a)]);}return p;}
function star(){const p=[];for(let i=0;i<10;i++){const a=(-90+36*i)*D2R,r=i%2?0.42:1;p.push([r*Math.cos(a),r*Math.sin(a)]);}return p;}
function semi(){const p=[];for(let i=0;i<=12;i++){const a=(180+15*i)*D2R;p.push([Math.cos(a),Math.sin(a)*1+0.45]);}return p;}
const SHAPES={
  tri:reg(3,-90), sq:reg(4,-45), pent:reg(5,-90), hex:reg(6,0), hept:reg(7,-90), oct:reg(8,-67.5), star:star(),
  cross:[[-.3,-1],[.3,-1],[.3,-.3],[1,-.3],[1,.3],[.3,.3],[.3,1],[-.3,1],[-.3,.3],[-1,.3],[-1,-.3],[-.3,-.3]],
  arrow:[[0,-1],[.65,-.15],[.25,-.15],[.25,1],[-.25,1],[-.25,-.15],[-.65,-.15]],
  flag:[[-.55,1],[-.55,-1],[.7,-.55],[-.35,-.1],[-.35,1]],
  L:[[-.6,-1],[-.15,-1],[-.15,.55],[.65,.55],[.65,1],[-.6,1]],
  T:[[-.85,-1],[.85,-1],[.85,-.55],[.22,-.55],[.22,1],[-.22,1],[-.22,-.55],[-.85,-.55]],
  semi:semi(),
  para:[[-.95,.55],[.35,.55],[.95,-.55],[-.35,-.55]],
  trap:[[-1,.6],[1,.6],[.5,-.6],[-.5,-.6]],
  rtri:[[-.8,.8],[.8,.8],[-.8,-.8]],
  rect:[[-1,-.55],[1,-.55],[1,.55],[-1,.55]],
  diam:[[0,-1],[.62,0],[0,1],[-.62,0]],
  chev:[[-1,-.2],[0,-1],[1,-.2],[1,.35],[0,-.45],[-1,.35]],
};
const SIDES={tri:3,sq:4,pent:5,hex:6,hept:7,oct:8,rect:4,diam:4,trap:4,para:4,rtri:3,circ:0};
const SHAPE_NAMES={tri:'triangle',sq:'square',pent:'pentagon',hex:'hexagon',hept:'heptagon',oct:'octagon',circ:'circle',star:'star',cross:'cross',arrow:'arrow',flag:'flag',L:'L-shape',T:'T-shape',semi:'semicircle',para:'parallelogram',trap:'trapezium',rtri:'right triangle',rect:'rectangle',diam:'diamond',chev:'chevron'};
function r2(v){return Math.round(v*100)/100;}
function tp(x,y,rot,mir){ // mirror (left-right) then rotate clockwise (screen coords)
  if(mir)x=-x; const a=rot*D2R,c=Math.cos(a),s=Math.sin(a); return [x*c-y*s, x*s+y*c];}
// shape element -> primitive
function shp(type,cx,cy,size,rot,mir,fill){
  fill=fill||'n'; rot=rot||0;
  if(type==='circ') return ['c',fill,r2(cx),r2(cy),r2(size)];
  const pts=[]; for(const [x,y] of SHAPES[type]){const [X,Y]=tp(x,y,rot,mir);pts.push(r2(cx+X*size),r2(cy+Y*size));}
  return ['p',fill,1,pts];
}
function dot(cx,cy,r,fill){return ['c',fill||'b',r2(cx),r2(cy),r2(r||3.2)];}
function line(x1,y1,x2,y2,dash){return ['l',r2(x1),r2(y1),r2(x2),r2(y2),dash?1:0];}
function rect(x,y,w,h,fill){return ['p',fill||'n',1,[r2(x),r2(y),r2(x+w),r2(y),r2(x+w),r2(y+h),r2(x),r2(y+h)]];}
function text(x,y,t,sz){return ['t',r2(x),r2(y),String(t),sz||14];}
// canonical keys
function q(v){return Math.round(Math.round(v*1e4)/100);} // hundredths, jitter-safe
function pk(x,y){return q(x)+','+q(y);}
function primKey(p){
  switch(p[0]){
    case 'c': return 'c'+p[1]+':'+pk(p[2],p[3])+':'+q(p[4]);
    case 'l': {const a=pk(p[1],p[2]),b=pk(p[3],p[4]);return 'l'+p[5]+':'+(a<b?a+'|'+b:b+'|'+a);}
    case 't': return 't:'+pk(p[1],p[2])+':'+p[3]+':'+p[4];
    case 'p': {const pts=p[3],n=pts.length/2,edges=[];
      const lim=p[2]?n:n-1;
      for(let i=0;i<lim;i++){const j=(i+1)%n;const a=pk(pts[2*i],pts[2*i+1]),b=pk(pts[2*j],pts[2*j+1]);edges.push(a<b?a+'|'+b:b+'|'+a);}
      edges.sort(); return 'p'+p[1]+p[2]+':'+edges.join('/');}
  }
  return JSON.stringify(p);
}
function panelKey(panel){return panel.e.map(primKey).sort().join(';');}
// whole-panel transforms about centre
function xfPanel(panel,fn){const cx=(panel.w||100)/2,cy=(panel.h||100)/2;
  const tf=(x,y)=>{const [X,Y]=fn(x-cx,y-cy);return [r2(X+cx),r2(Y+cy)];};
  const e=panel.e.map(p=>{switch(p[0]){
    case 'c':{const [x,y]=tf(p[2],p[3]);return ['c',p[1],x,y,p[4]];}
    case 'l':{const [a,b]=tf(p[1],p[2]),[c,d]=tf(p[3],p[4]);return ['l',a,b,c,d,p[5]];}
    case 't':{const [x,y]=tf(p[1],p[2]);return ['t',x,y,p[3],p[4]];}
    case 'p':{const pts=[];for(let i=0;i<p[3].length;i+=2){const [x,y]=tf(p[3][i],p[3][i+1]);pts.push(x,y);}return ['p',p[1],p[2],pts];}
  }});
  return Object.assign({},panel,{e});}
function rotPanel(panel,deg){const a=deg*D2R,c=Math.cos(a),s=Math.sin(a);return xfPanel(panel,(x,y)=>[x*c-y*s,x*s+y*c]);}
function mirPanel(panel,axis){return xfPanel(panel,axis==='h'?(x,y)=>[x,-y]:(x,y)=>[-x,y]);}
// SVG rendering
let HID=0;
const FILL={n:'#fff',b:'#151515',g:'#9b9b9b',o:'none'};
function fillAttr(f,hid){return f==='h'?'url(#'+hid+')':(FILL[f]||'#fff');}
function svg(panel,cls){
  const w=panel.w||100,h=panel.h||100,hid='hp'+(HID++);let s='<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+w+' '+h+'" class="'+(cls||'fig')+'">';
  s+='<defs><pattern id="'+hid+'" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="6" height="6" fill="#fff"/><line x1="0" y1="0" x2="0" y2="6" stroke="#151515" stroke-width="2"/></pattern></defs>';
  if(!panel.nobg) s+='<rect x="0" y="0" width="'+w+'" height="'+h+'" fill="#fff"/>';
  const sw=panel.sw||2.4;
  for(const p of panel.e){
    if(p[0]==='c') s+='<circle cx="'+p[2]+'" cy="'+p[3]+'" r="'+p[4]+'" fill="'+fillAttr(p[1],hid)+'" stroke="#151515" stroke-width="'+(p[4]<4?1:sw)+'"/>';
    else if(p[0]==='l') s+='<line x1="'+p[1]+'" y1="'+p[2]+'" x2="'+p[3]+'" y2="'+p[4]+'" stroke="#151515" stroke-width="'+sw+'" stroke-linecap="round"'+(p[5]?' stroke-dasharray="4 3"':'')+'/>';
    else if(p[0]==='t') s+='<text x="'+p[1]+'" y="'+p[2]+'" font-size="'+p[4]+'" text-anchor="middle" dominant-baseline="central" font-family="Helvetica,Arial,sans-serif" font-weight="600" fill="#151515">'+String(p[3]).replace(/&/g,'&amp;').replace(/</g,'&lt;')+'</text>';
    else if(p[0]==='p'){const pts=[];for(let i=0;i<p[3].length;i+=2)pts.push(p[3][i]+','+p[3][i+1]);
      s+=(p[2]?'<polygon':'<polyline')+' points="'+pts.join(' ')+'" fill="'+(p[2]?fillAttr(p[1],hid):'none')+'" stroke="#151515" stroke-width="'+sw+'" stroke-linejoin="round"/>';}
  }
  if(panel.frame!==false) s+='<rect x="0.75" y="0.75" width="'+(w-1.5)+'" height="'+(h-1.5)+'" fill="none" stroke="#c9c9c9" stroke-width="1.5"/>';
  if(panel.q) s+='<text x="'+w/2+'" y="'+h/2+'" font-size="'+Math.min(w,h)*0.5+'" text-anchor="middle" dominant-baseline="central" font-family="Helvetica,Arial,sans-serif" fill="#888">?</text>';
  return s+'</svg>';
}
const G={SHAPES,SIDES,SHAPE_NAMES,shp,dot,line,rect,text,primKey,panelKey,rotPanel,mirPanel,xfPanel,svg,r2};
if(typeof module!=='undefined'&&module.exports) module.exports=G; else root.Geom=G;
})(typeof window!=='undefined'?window:globalThis);
