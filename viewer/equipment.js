import * as T from 'three';
export async function attachEquipment({base,canvas,host,onView,render}){
 const data=await fetch('../model/equipment-catalog.json',{cache:'no-store'}).then(r=>r.json());
 const select=document.querySelector('#equipmentSelect'),title=document.querySelector('#equipmentTitle'),purpose=document.querySelector('#equipmentPurpose'),use=document.querySelector('#equipmentUse'),care=document.querySelector('#equipmentCare'),badge=document.querySelector('#equipmentBadge');
 const state={item:null,helper:null},ray=new T.Raycaster(),mouse=new T.Vector2();let start=null;
 for(const category of [...new Set(data.items.map(i=>i.category))]){
  const group=document.createElement('optgroup');group.label=category;
  for(const item of data.items.filter(i=>i.category===category)){const o=document.createElement('option');o.value=item.id;o.textContent=item.id+' · '+item.name;group.append(o)}select.append(group)
 }
 function clear(){if(state.helper){base.scene.remove(state.helper);state.helper.geometry.dispose();state.helper.material.dispose();state.helper=null}state.item=null;select.value='';badge.hidden=true;title.textContent='先选一个物品';purpose.textContent='点模型里的物品，或从清单选择名称。';use.textContent='';care.textContent='';render()}
 function choose(id,move=true){
  const item=data.items.find(i=>i.id===id);if(!item)return;
  if(move)onView(item.view);clear();state.item=item;select.value=id;
  title.textContent=item.id+' · '+item.name;purpose.textContent=item.purpose;use.textContent='怎么用：'+item.use;care.textContent=item.care;
  const box=new T.Box3(new T.Vector3(...item.bounds.min),new T.Vector3(...item.bounds.max));state.helper=new T.Box3Helper(box,0xc46f35);state.helper.material.depthTest=false;state.helper.material.transparent=true;state.helper.material.opacity=.95;state.helper.renderOrder=9;base.scene.add(state.helper);
  badge.textContent=item.id+' · '+item.name+' — '+item.purpose;badge.hidden=false;render();
  if(move&&innerWidth<1000)host.scrollIntoView({block:'start',behavior:'smooth'});
  if(innerWidth>=1000)requestAnimationFrame(()=>document.querySelector('#equipmentPanel').scrollIntoView({block:'center',behavior:'instant'}));
 }
 select.onchange=()=>select.value?choose(select.value):clear();
 document.querySelector('#clearEquipment').onclick=clear;
 canvas.addEventListener('pointerdown',e=>start={x:e.clientX,y:e.clientY});
 canvas.addEventListener('pointerup',e=>{
  if(!start||Math.hypot(e.clientX-start.x,e.clientY-start.y)>5)return;start=null;
  const rect=canvas.getBoundingClientRect();mouse.set((e.clientX-rect.left)/rect.width*2-1,-(e.clientY-rect.top)/rect.height*2+1);ray.setFromCamera(mouse,base.camera);
  const hit=ray.intersectObjects(base.meshes.filter(m=>m.visible&&!m.userData.layers.label&&!m.userData.layers.route&&!m.userData.layers.useOverlay),false)[0];if(!hit)return;
  const p=hit.point,candidates=[];
  for(const item of data.items){
   for(const b of item.pick_boxes){
    if(p.x>=b.min[0]-.025&&p.x<=b.max[0]+.025&&p.y>=b.min[1]-.025&&p.y<=b.max[1]+.025&&p.z>=b.min[2]-.025&&p.z<=b.max[2]+.025){const volume=b.max.reduce((v,n,i)=>v*Math.max(.001,n-b.min[i]),1);candidates.push({item,volume});break}
   }
  }
  candidates.sort((a,b)=>a.volume-b.volume);if(candidates.length)choose(candidates[0].item.id,false);
 });
 document.querySelector('#identify').onclick=()=>document.querySelector('#equipmentPanel').scrollIntoView({block:'center',behavior:'smooth'});
 return {data,state,choose,clear};
}
