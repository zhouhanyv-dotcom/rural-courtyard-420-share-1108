import * as T from 'three';
import {Octree} from 'three/addons/math/Octree.js';
import {Capsule} from 'three/addons/math/Capsule.js';

// A conservative walking envelope, derived from the imported model in world metres.
// The viewer is not a building-clearance or accessibility certification tool.
export function createWalkAssets(scene){
 const sources=[],gates=[],doorParks=[];
 for(const y of [.11,2.70]){const group=new T.Group();group.position.set(7.825,0,-y);scene.add(group);group.updateMatrixWorld(true);gates.push(group)}
 const storageDoor=new T.Group();storageDoor.position.set(7.7,0,-14.5);scene.add(storageDoor);storageDoor.updateMatrixWorld(true);doorParks.push({group:storageDoor,angle:-155*Math.PI/180});
 const roofDoor=new T.Group();roofDoor.position.set(5.26,0,-14.255);scene.add(roofDoor);roofDoor.updateMatrixWorld(true);doorParks.push({group:roofDoor,angle:-Math.PI/2});
 const gatePart=n=>/^R33_Gate_(leaf|inside_stile|inside_rail|hand_release)/i.test(n);
 function keepGate(mesh,layers){
  if(mesh.name==='Upper_right_storage_open_leaf'){storageDoor.attach(mesh);mesh.userData.layers=layers;mesh.castShadow=true;mesh.receiveShadow=true;return true}
  if(/^R3_Roof_(access_door|door_release)$/.test(mesh.name)){roofDoor.attach(mesh);mesh.userData.layers=layers;mesh.castShadow=true;mesh.receiveShadow=true;return true}
  if(!gatePart(mesh.name))return false;
  const center=new T.Box3().setFromObject(mesh).getCenter(new T.Vector3()),group=gates[center.z> -1.5?0:1];group.attach(mesh);mesh.userData.layers=layers;mesh.castShadow=true;mesh.receiveShadow=true;return true;
 }
 function collect(mesh,layers){
  const n=mesh.name.replaceAll('_',' '),b=layers;
  if(b.label||b.route||b.useOverlay||b.closedLeaf||b.rainShow||b.shadeShow||b.privacy)return;
  if(/(paving joint|PV cell|PV rail|PV leg|cell line|label|ID plate|monitor screen|Book\b|book spine|R3 Bed\d+ (leaf|stem)|seedling|Plant\b|Stem\b|Fruit\b|power cable|wire|pipe|collector|gutter|overflow|vent|drain|shade roof)/i.test(n))return;
  mesh.geometry.computeBoundingBox();const local=mesh.geometry.boundingBox.clone(),size=local.getSize(new T.Vector3());
  if(Math.max(size.x,size.y,size.z)<.085)return;
  const floor=/^(SITE|Ground floor slab|Living rug|Upper slab with stair opening|Entry step|Second exit step|Stair [AB] tread|Stair mid landing|Dry energy slab|Clean water slab|Cold room insulated floor|Combined service roof|R34 Garage floor|R34 Social paving|R34 East walk paving|R3 Porch (roof|landing|stair tread)|R3 House roof ring|R3 Roof walk|R3 Roof stair [AB] \d|R3 Roof stair half landing|R3 Service roof step)/i.test(n);
  const actual=floor||/rail|guard|stringer|landing return|open leaf|Roof access door/i.test(n);
  sources.push({mesh,local,floor,actual});
 }
 function build(){
  for(const g of gates)g.rotation.y=Math.PI/2;
  for(const d of doorParks)d.group.rotation.y=d.angle;
  scene.updateMatrixWorld(true);const group=new T.Group(),floors=new T.Group(),material=new T.MeshBasicMaterial();let triangles=0;
  for(const s of sources){
   const center=s.local.getCenter(new T.Vector3()),d=s.local.getSize(new T.Vector3());
   if(Math.min(d.x,d.y,d.z)<1e-5)continue;
   const geo=s.actual?s.mesh.geometry.clone():new T.BoxGeometry(d.x,d.y,d.z);if(!s.actual)geo.translate(center.x,center.y,center.z);geo.applyMatrix4(s.mesh.matrixWorld);const m=new T.Mesh(geo,material);group.add(m);triangles+=geo.index?geo.index.count/3:geo.attributes.position.count/3;
   if(s.floor)floors.add(new T.Mesh(geo,material));
  }
  const world=new Octree().fromGraphNode(group),ground=new Octree().fromGraphNode(floors);
  group.traverse(o=>{if(o.isMesh)o.geometry.dispose()});material.dispose();
  return {world,ground,triangles,sourceCount:sources.length,floorCount:sources.filter(s=>s.floor).length};
 }
 return {collect,keepGate,build,gates,sources,open(){for(const g of gates)g.rotation.y=Math.PI/2;for(const d of doorParks)d.group.rotation.y=d.angle},close(){for(const g of gates)g.rotation.y=0;for(const d of doorParks)d.group.rotation.y=0}};
}

export function attachWalk({scene,renderer,host,canvas,assets,setCamera,resize,render,prepare,restore}){
 const R=.24,EYE=1.62,HEIGHT=1.72,STEP=.23,DROP=.34;
 const camera=new T.PerspectiveCamera(70,1,.055,180);camera.rotation.order='YXZ';
 const state={active:false,ready:false,position:new T.Vector3(),yaw:0,pitch:0,locked:false,blocked:false,world:null};
 const keys=new Set(),down=new T.Vector3(0,-1,0),ray=new T.Ray(),normal=new T.Vector3();let world,ground,last=0,raf=0,dirty=false,drag=null,snapshot,shadowAuto=true,auto=null,planning=false,blockedTime=0;
 const hud=document.createElement('div');hud.id='walkHud';hud.hidden=true;hud.innerHTML=`<div class="walk-top"><strong>第一视角漫游</strong><span id="walkWhere">院门</span><button id="walkLock">锁定鼠标</button><button id="walkHome">回到院门</button><button id="walkExit">退出漫游</button></div><div class="walk-help"><span id="walkHint">W A S D / 方向键移动 · 拖动转头 · Shift加速 · Esc释放鼠标</span><label>快速到达 <select id="walkVisit"><option value="gate">院门</option><option value="yard">庭院</option><option value="living">一层客厅</option><option value="stairs">楼梯口</option><option value="suite">二层套房</option><option value="roof">住宅屋顶</option><option value="energy">能源房</option><option value="water">净水房</option></select></label><button id="walkTour">自动逛院子</button></div><div class="walk-reticle" aria-hidden="true">＋</div><div class="walk-bottom"><canvas id="walkMap" width="170" height="160" aria-label="院落位置小地图"></canvas><span>院内步行 · 门扇已开启<br>视线高约1.62米</span></div>`;host.append(hud);
 const $=s=>hud.querySelector(s),hint=$('#walkHint'),where=$('#walkWhere'),map=$('#walkMap'),ctx=map.getContext('2d');
 canvas.tabIndex=0;const focusCanvas=()=>canvas.focus({preventScroll:true});
 const visits={
  gate:{pos:[8.3,.03,-5.3],look:[8.3,.03,-9],label:'院门内侧'},yard:{pos:[14,.03,-12],look:[5.5,1,-13],label:'庭院'},
  living:{pos:[4.25,.45,-11],look:[2.5,1,-11.8],label:'一层客厅'},stairs:{pos:[6,.40,-14.7],look:[6,1,-16.2],label:'一层楼梯口'},
  suite:{pos:[3.6,3.62,-11.6],look:[2,4.4,-12.4],label:'二层套房'},roof:{pos:[4.7,7,-12.1],look:[7,7.8,-14.5],label:'住宅屋顶'},
  energy:{pos:[11.6,.24,-16.1],look:[11.5,1.3,-18.3],label:'能源房'},water:{pos:[14.15,.24,-16.0],look:[14.7,1,-18.2],label:'净水房'}
 };
 function capsuleAt(x,y,z){return new Capsule(new T.Vector3(x,y+R+.007,z),new T.Vector3(x,y+HEIGHT-R,z),R)}
 function probeSupport(x,z,y,drop=DROP){
  const top=y+STEP+.012;ray.origin.set(x,top,z);ray.direction.copy(down);
  for(let i=0;i<8;i++){const hit=ground.rayIntersect(ray);if(!hit||top-hit.position.y>STEP+drop+.025)return null;hit.triangle.getNormal(normal);if(normal.y>=.6)return hit.position.y;ray.origin.y=hit.position.y-.001}
  return null;
 }
 function support(x,z,y,drop=DROP){
  let best=null;
  for(const [dx,dz] of [[0,0],[.09,0],[-.09,0],[0,.09],[0,-.09]]){const h=probeSupport(x+dx,z+dz,y,drop);if(h!==null&&(best===null||h>best))best=h}
  return best;
 }
 function clearAt(x,y,z){const hit=world.capsuleIntersect(capsuleAt(x,y,z));return !hit||(hit.normal.y>.7&&hit.depth<.025)}
 function move(dx,dz){
  if(!state.active||!state.ready)return false;
  const old=state.position.clone(),distance=Math.hypot(dx,dz);if(!distance)return false;
  const steps=Math.max(1,Math.ceil(distance/.055)),sx=dx/steps,sz=dz/steps;
  for(let i=0;i<steps;i++){
   const prior=state.position.clone();let x=T.MathUtils.clamp(prior.x+sx,.245,20.755),z=T.MathUtils.clamp(prior.z+sz,-19.755,-.245),y=support(x,z,prior.y);
   state.lastMove={prior:prior.toArray(),candidate:[x,y,z]};if(y===null){state.lastMove.reason='no center support';continue}
   // Look ahead within the rounded foot to step onto a real tread/threshold.
   const len=Math.hypot(sx,sz),ahead=support(x+sx/len*(R+.025),z+sz/len*(R+.025),prior.y);
   if(ahead!==null&&ahead>y&&ahead>=prior.y-.015){const centerY=y;y=Math.max(y,prior.y);if(ahead-prior.y<=STEP+.015&&ahead-centerY<=STEP+.015)y=Math.max(y,ahead)}
   state.lastMove.ahead=ahead;state.lastMove.stepY=y;state.lastMove.hits=[];let cap=capsuleAt(x,y,z);
   for(let j=0;j<4;j++){
    const hit=world.capsuleIntersect(cap);if(!hit||hit.depth<.0015)break;
    state.lastMove.hits.push({normal:hit.normal.toArray(),depth:hit.depth});cap.translate(hit.normal.clone().multiplyScalar(hit.depth+.001));
   }
   x=cap.start.x;z=cap.start.z;const resolvedY=cap.start.y-R-.007;
   state.lastMove.resolved=[x,resolvedY,z];if(resolvedY-prior.y>STEP+.02||Math.hypot(x-prior.x,z-prior.z)>.25){state.lastMove.reason='large resolution';continue}
   const finalSupport=support(x,z,resolvedY);state.lastMove.finalSupport=finalSupport;if(finalSupport===null){state.lastMove.reason='no final support';continue}
   // Keep the foot supported; a capsule can briefly bridge the edge of a tread.
   if(resolvedY-finalSupport>.255){state.lastMove.reason='unsupported bridge';continue}
   state.position.set(x,Math.max(y,resolvedY),z);
  }
  const travelled=Math.hypot(state.position.x-old.x,state.position.z-old.z);state.blocked=travelled<distance*.12;dirty=true;return travelled>.001;
 }
 function locate(key){
  const target=visits[key];if(!target)return false;
  stopTour();let found=null;
  for(let radius=0;radius<=.9&&!found;radius+=.15){
   const count=radius?16:1;
   for(let i=0;i<count;i++){const a=i/count*Math.PI*2,x=target.pos[0]+Math.cos(a)*radius,z=target.pos[2]+Math.sin(a)*radius,y=support(x,z,target.pos[1],.40);if(y!==null&&clearAt(x,y,z)){found=new T.Vector3(x,y,z);break}}
  }
  if(!found){hint.textContent='这个位置暂时无法站立，请沿通道走近。';return false}
  state.position.copy(found);const dx=target.look[0]-found.x,dz=target.look[2]-found.z;state.yaw=Math.atan2(-dx,-dz);state.pitch=0;camera.position.set(found.x,found.y+EYE,found.z);dirty=true;$('#walkVisit').value=key;hint.textContent='W A S D / 方向键移动 · 拖动转头 · Shift加速 · Esc释放鼠标';focusCanvas();return true;
 }
 function area(){const p=state.position,x=p.x,y=-p.z;if(p.y>6.5)return'住宅屋顶';if(p.y>3.35&&x<10.2)return'二层';if(p.y>2.7)return'屋顶平台';if(x>10&&y>15)return x<13?'能源房':'净水房';if(x<10&&y>9)return'一层';if(y<2.8&&x>7.7&&x<10.3)return'院门缓冲';return'庭院'}
 function minimap(){
  ctx.clearRect(0,0,170,160);ctx.fillStyle='#f7f8ef';ctx.fillRect(0,0,170,160);ctx.strokeStyle='#76877b';ctx.lineWidth=2;ctx.strokeRect(10,8,147,140);
  const rect=(x,y,w,h,c)=>{ctx.fillStyle=c;ctx.fillRect(10+x*7,148-(y+h)*7,w*7,h*7)};
  rect(1,9,9,10,'#b5c5bc');rect(10,15,6,4,'#d1d9cf');rect(17.5,.2,3.3,6.3,'#c6ccb8');rect(18.87,6.72,1.8,2.4,'#d9d1bc');rect(10.5,1.1,5.4,3.8,'#b8c8a5');
  const x=10+state.position.x*7,y=148+state.position.z*7;ctx.fillStyle='#b96935';ctx.beginPath();ctx.arc(x,y,4,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#b96935';ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x-Math.sin(state.yaw)*13,y-Math.cos(state.yaw)*13);ctx.stroke();
 }
 function look(mx,my){state.yaw-=mx*.0022;state.pitch=T.MathUtils.clamp(state.pitch-my*.0022,-1.35,1.35);dirty=true}
 async function lock(){try{await canvas.requestPointerLock?.()}catch{hint.textContent='当前浏览器未锁定鼠标，按住画面拖动转头即可。'}}
 document.addEventListener('pointerlockchange',()=>{state.locked=document.pointerLockElement===canvas;keys.clear();$('#walkLock').textContent=state.locked?'鼠标已锁定':'锁定鼠标';if(!state.locked)drag=null});
 document.addEventListener('pointerlockerror',()=>{hint.textContent='按住画面拖动转头即可。'});
 canvas.addEventListener('pointerdown',e=>{if(!state.active||e.button!==0)return;focusCanvas();drag={x:e.clientX,y:e.clientY};canvas.setPointerCapture?.(e.pointerId)});
 canvas.addEventListener('pointermove',e=>{if(state.active&&drag&&!state.locked){look(e.clientX-drag.x,e.clientY-drag.y);drag={x:e.clientX,y:e.clientY}}});
 canvas.addEventListener('pointerup',()=>drag=null);canvas.addEventListener('pointercancel',()=>drag=null);
 document.addEventListener('mousemove',e=>{if(state.active&&state.locked)look(e.movementX,e.movementY)});
 document.addEventListener('keydown',e=>{if(!state.active||/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;if(['KeyW','KeyA','KeyS','KeyD','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','ShiftLeft','ShiftRight'].includes(e.code)){e.preventDefault();keys.add(e.code);stopTour()}if(e.code==='KeyR'){e.preventDefault();locate('gate')}if(e.code==='Escape'){keys.clear();stopTour()}});
 document.addEventListener('keyup',e=>keys.delete(e.code));window.addEventListener('blur',()=>{keys.clear();drag=null;stopTour()});document.addEventListener('visibilitychange',()=>{if(document.hidden){keys.clear();stopTour()}});
 function stopTour(){const wasRunning=!!auto||planning;auto=null;planning=false;$('#walkTour').textContent='自动逛院子';if(wasRunning)hint.textContent='导览已停止，可自由走动 · 拖动转头 · R回到院门'}
 // Outdoor guidance uses the same capsule and support tests as manual walking.
 async function planPath(start,end){
  const cell=.30,key=(i,j)=>i+','+j,cache=new Map(),nodes=new Map(),closed=new Set(),open=[];
  const toCell=p=>[Math.round(p.x/cell),Math.round(-p.z/cell)],a=toCell(start),goal=toCell(end);
  function valid(i,j){const k=key(i,j);if(cache.has(k))return cache.get(k);const x=i*cell,z=-j*cell;
   const allowed=x>.45&&x<20.5&&z<-.3&&z> -19.5&&!(x<10.2&&-z>8.9);const h=allowed?support(x,z,.24,.5):null;const ok=h!==null&&h<.60&&clearAt(x,h,z);cache.set(k,ok);return ok}
  function heuristic(i,j){return Math.hypot(i-goal[0],j-goal[1])}
  const first={i:a[0],j:a[1],g:0,f:heuristic(...a),parent:null};open.push(first);nodes.set(key(...a),first);let iterations=0;
  while(open.length&&planning&&state.active){
   open.sort((a,b)=>a.f-b.f);const n=open.shift(),k=key(n.i,n.j);if(closed.has(k))continue;closed.add(k);
   if(Math.hypot(n.i-goal[0],n.j-goal[1])<=1){const out=[];for(let q=n;q;q=q.parent)out.push(new T.Vector3(q.i*cell,0,-q.j*cell));return out.reverse()}
   for(const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]){
    const i=n.i+di,j=n.j+dj,k=key(i,j);if(closed.has(k)||!valid(i,j)||(di&&dj&&(!valid(n.i+di,n.j)||!valid(n.i,n.j+dj))))continue;
    const g=n.g+Math.hypot(di,dj),old=nodes.get(k);if(old&&old.g<=g)continue;const next={i,j,g,f:g+heuristic(i,j),parent:n};nodes.set(k,next);open.push(next);
   }
   if(++iterations%160===0)await new Promise(requestAnimationFrame);
   if(iterations>8000)break;
  }
  return null;
 }
 async function tour(){
  if(auto||planning){stopTour();return}
  if(state.position.y>.6||state.position.x<10&&-state.position.z>9)locate('gate');
  planning=true;$('#walkTour').textContent='正在规划…';hint.textContent='正在规划院内通道，稍候…';
  const stops=[{x:14,z:-12,look:[5.5,-13],name:'庭院活动区'},{x:18.9,z:-15.1,look:[16.6,-16.9],name:'储水与净水'},{x:17.5,z:-7.5,look:[19.7,-7.9],name:'小冷库'},{x:16.7,z:-4,look:[13.2,-3],name:'菜床与电车库'},{x:8.3,z:-5.3,look:[8.3,-9],name:'院门内侧'}];
  const route=[];let from=state.position.clone();
  for(const stop of stops){const path=await planPath(from,new T.Vector3(stop.x,0,stop.z));if(!planning||!state.active)return;if(!path){stopTour();hint.textContent='这段通道未找到可靠路线，可用键盘自由逛或快速到达。';return}route.push(...path.slice(1).map(p=>({p})),{p:path.at(-1),stop});from=path.at(-1)}
  auto={route,index:0,pause:0,stuck:0};planning=false;$('#walkTour').textContent='停止导览';hint.textContent='自动逛院子中 · 按移动键或Esc可停止';last=performance.now();
 }
 function follow(dt){
  if(!auto)return;const item=auto.route[auto.index];if(!item){stopTour();hint.textContent='院内导览结束，可继续自由走动。';return}
  const dx=item.p.x-state.position.x,dz=item.p.z-state.position.z,dist=Math.hypot(dx,dz);
  if(dist<.12){if(item.stop){const [x,z]=item.stop.look;const yaw=Math.atan2(-(x-state.position.x),-(z-state.position.z));state.yaw+=Math.atan2(Math.sin(yaw-state.yaw),Math.cos(yaw-state.yaw))*Math.min(1,dt*3);auto.pause+=dt;hint.textContent='正在看：'+item.stop.name+' · 按移动键停止';dirty=true;if(auto.pause<2.0)return;auto.pause=0}auto.index++;return}
  const yaw=Math.atan2(-dx,-dz);state.yaw+=Math.atan2(Math.sin(yaw-state.yaw),Math.cos(yaw-state.yaw))*Math.min(1,dt*5);state.pitch*=Math.max(0,1-dt*4);
  if(move(dx/dist*Math.min(dist,dt*1.25),dz/dist*Math.min(dist,dt*1.25)))auto.stuck=0;else auto.stuck+=dt;
  if(auto.stuck>2){stopTour();hint.textContent='前方受到阻挡，已停下；可手动调整方向。'}
 }
 function frame(now){
  if(!state.active)return;const dt=Math.min(.05,Math.max(.001,(now-last)/1000));last=now;follow(dt);
  let f=(keys.has('KeyW')||keys.has('ArrowUp')?1:0)-(keys.has('KeyS')||keys.has('ArrowDown')?1:0),s=(keys.has('KeyD')||keys.has('ArrowRight')?1:0)-(keys.has('KeyA')||keys.has('ArrowLeft')?1:0);
  if(f||s){const n=Math.hypot(f,s),speed=keys.has('ShiftLeft')||keys.has('ShiftRight')?2.65:1.55;f/=n;s/=n;move((-Math.sin(state.yaw)*f+Math.cos(state.yaw)*s)*speed*dt,(-Math.cos(state.yaw)*f-Math.sin(state.yaw)*s)*speed*dt);blockedTime=state.blocked?blockedTime+dt:0}else blockedTime=0;
  const walkingStatus=blockedTime>.45?'前方受阻，请转向或后退':'院内步行 · 主通行门已开启';if($('.walk-bottom span').firstChild.textContent!==walkingStatus)$('.walk-bottom span').firstChild.textContent=walkingStatus;
  if(dirty){camera.position.x=state.position.x;camera.position.z=state.position.z;camera.position.y=T.MathUtils.lerp(camera.position.y,state.position.y+EYE,Math.min(1,dt*15));camera.rotation.set(state.pitch,state.yaw,0,'YXZ');where.textContent=area();minimap();render();dirty=Math.abs(camera.position.y-state.position.y-EYE)>.001}
  raf=requestAnimationFrame(frame);
 }
 function enter(){
  if(state.active)return;state.active=true;snapshot=prepare();assets.open();hud.hidden=false;document.body.classList.add('walk-mode');setCamera(camera);resize();shadowAuto=renderer.shadowMap.autoUpdate;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.needsUpdate=true;
  try{if(!state.ready){const result=assets.build();world=result.world;ground=result.ground;state.world=result;state.ready=true}locate('gate');dirty=true;last=performance.now();raf=requestAnimationFrame(frame)}catch(error){exit();throw error}
 }
 function exit(restoreView=true){
  if(!state.active)return;state.active=false;stopTour();keys.clear();drag=null;cancelAnimationFrame(raf);if(document.pointerLockElement===canvas)document.exitPointerLock();hud.hidden=true;document.body.classList.remove('walk-mode');assets.close();renderer.shadowMap.autoUpdate=shadowAuto;renderer.shadowMap.needsUpdate=true;restore(snapshot,restoreView);resize();render();
 }
 $('#walkExit').onclick=()=>exit();$('#walkHome').onclick=()=>locate('gate');$('#walkLock').onclick=lock;$('#walkVisit').onchange=e=>locate(e.target.value);$('#walkTour').onclick=tour;
 window.addEventListener('hashchange',()=>{if(location.hash==='#walk'&&!state.active)enter()});
 function nearby(padding=0){const p=state.position,body=new T.Box3(new T.Vector3(p.x-R,p.y+.02,p.z-R),new T.Vector3(p.x+R,p.y+HEIGHT,p.z+R)).expandByScalar(padding);return assets.sources.filter(s=>s.local.clone().applyMatrix4(s.mesh.matrixWorld).intersectsBox(body)).map(s=>({name:s.mesh.name,b:s.local.clone().applyMatrix4(s.mesh.matrixWorld)}))}
 return {get active(){return state.active},get tourProgress(){return auto?{index:auto.index,total:auto.route.length}:null},state,camera,enter,exit,move,visit:locate,tour,stopTour,support,clearAt,nearby};
}
