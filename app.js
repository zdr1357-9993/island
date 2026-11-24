const $ = id => document.getElementById(id);
const key = localStorage.islandOwner || (localStorage.islandOwner = crypto.randomUUID());
const sampleRows = [
  {id:'a',kind:'섬',title:'망설임섬',body:'도움을 묻고 싶었지만 말을 걸기 망설였어요.'},
  {id:'b',kind:'섬',title:'편견섬',body:'상대의 말을 듣기 전에 내 기준으로 판단했어요.'},
  {id:'c',kind:'섬',title:'거리감섬',body:'낯설다는 이유로 멀찍이 서 있었어요.'},
  {id:'d',kind:'다리',title:'기다림의 다리',body:'상대가 말을 마칠 때까지 기다리기.',from:'a',to:'b'}
];
let rows=[], demo=false, busy=false, loading=false, revision=0;
const live=Boolean(window.BOARD_API);
const data=()=>demo?sampleRows:rows;
const island=()=>rows.find(r=>r.mine && r.kind==='섬');
const el=(tag,text)=>Object.assign(document.createElement(tag),{textContent:text??''});
function button(text,fn){const b=el('button',text);b.type='button';b.onclick=fn;return b}
function view(id){for(const page of ['intro','board','mine']) $(page).hidden=page!==id; if(id==='board') draw(); if(id==='mine') list()}
function tell(s){$('status').textContent=s}
function local(p){
  let saved=JSON.parse(localStorage.islandPreview||'null')||sampleRows.map(r=>({...r,mine:false}));
  if(p.action==='create')saved.push({...p,id:crypto.randomUUID(),mine:true,from:p.kind==='다리'?island()?.id:''});
  if(p.action==='edit')Object.assign(saved.find(r=>r.id===p.id),{title:p.title,body:p.body});
  if(p.action==='delete')saved=saved.filter(r=>![r.id,r.from,r.to].includes(p.id));
  localStorage.islandPreview=JSON.stringify(saved);return saved
}
async function request(p){if(!live)return local(p);const res=await fetch(window.BOARD_API,{method:'POST',body:JSON.stringify({...p,key}),signal:AbortSignal.timeout(30000)});const result=await res.json();if(!res.ok||result.error)throw Error(result.error||'연결을 확인해 주세요.');return result.rows}
async function sync(first=false){if(loading||busy)return;loading=true;const seq=revision;try{const got=await request({action:'read'});if(seq!==revision)return;const old=rows;rows=got;if(first&&island())view('board');else if(!$('board').hidden&&!demo)draw(old);else if(!$('mine').hidden)list()}catch(e){tell('보드를 불러오지 못했어요. '+e.message)}finally{loading=false}}
async function save(p,destination){if(busy)return;busy=true;revision++;const btns=[...document.querySelectorAll('button:not(:disabled)')];btns.forEach(b=>b.disabled=true);try{const old=rows;rows=await request(p);$('modal').close();demo=false;view(destination);if(destination==='board')draw(old);tell('저장했어요.');setTimeout(()=>tell(''),2200)}catch(e){alert(e.message)}finally{busy=false;btns.forEach(b=>b.disabled=false)}}
function draw(old=data()){
 const items=data(),isles=items.filter(r=>r.kind==='섬'),world=$('world'),w=Math.max(290,world.clientWidth),cols=Math.max(2,Math.min(4,Math.floor(w/165))),h=Math.max(420,Math.ceil(isles.length/cols)*155+70);
 world.style.height=h+'px';$('nodes').replaceChildren();$('lines').replaceChildren();const points=new Map();
 $('caption').textContent=(demo?'예시 보드':live?'우리의 바다':'이 기기 체험 보드')+' · 섬 '+isles.length+'개';
 $('newbtn').hidden=!demo&&!!island();$('newbtn').textContent=demo?'참여 화면으로':'섬 만들기';$('listbtn').hidden=$('csv').hidden=demo;
 isles.forEach((r,i)=>{const col=i%cols,row=Math.floor(i/cols),x=w*(col+.5)/cols,y=95+row*155+(col%2)*48;points.set(r.id,[x,y]);const b=button('',()=>detail(r));b.className='isle'+(!old.some(o=>o.id===r.id)?' born':'');b.style.left=x+'px';b.style.top=y+'px';const img=el('img');img.src='isle.webp';img.alt='';b.append(img,el('span',r.title));$('nodes').append(b)});
 for(const r of items.filter(r=>r.kind==='다리')){const a=points.get(r.from),b=points.get(r.to);if(!a||!b)continue;for(const [color,width,dash] of [['#634734',12,''],['#caa473',9,'4 2']]){const l=document.createElementNS('http://www.w3.org/2000/svg','line');for(const [k,v] of Object.entries({x1:a[0],y1:a[1]+18,x2:b[0],y2:b[1]+18,stroke:color,'stroke-width':width,'stroke-dasharray':dash}))l.setAttribute(k,v);if(!old.some(o=>o.id===r.id))l.classList.add('built');$('lines').append(l)}}
}
function dialog(title){const d=$('modal');d.replaceChildren(el('h2',title));if(!d.open)d.showModal();return d}
function detail(r){const d=dialog(r.title);d.append(el('p',r.body));const linked=data().filter(v=>v.kind==='다리'&&(v.from===r.id||v.to===r.id));for(const v of linked)d.append(el('b',v.title),el('p',v.body));if(!demo&&!r.mine&&island()&&!rows.some(v=>v.from===island().id&&v.to===r.id))d.append(button('다리 놓기',()=>editor(null,r)));else if(!demo&&!island())d.append(button('내 섬 먼저 만들기',()=>{d.close();view('intro')}));d.append(button('닫기',()=>d.close()))}
function editor(r,target){const d=dialog(r?r.kind+' 수정':'다리 놓기'),form=el('form');const fields={};for(const [k,label,tag,max] of [['title',r?'제목':'다리 이름','input',24],['body',r?'내용':'내가 해볼 작은 행동 하나','textarea',240]]){const l=el('label',label),input=el(tag);input.required=true;input.maxLength=max;input.value=r?.[k]||'';if(k==='title'&&!r)input.placeholder='예: 도움의 다리, 요청의 다리';l.append(input);form.append(l);fields[k]=input}form.append(button('취소',()=>d.close()),el('button',r?'완료':'다리 연결하기'));form.onsubmit=e=>{e.preventDefault();if(r&&!confirm('정말 수정하시겠습니까?'))return;save({action:r?'edit':'create',kind:r?.kind||'다리',id:r?.id,to:target?.id,title:fields.title.value.trim(),body:fields.body.value.trim()},r?'mine':'board')};d.append(form)}
function list(){const body=document.querySelector('tbody');body.replaceChildren();for(const r of rows.filter(v=>v.mine)){const tr=el('tr'),title=el('td');title.append(button(r.title,()=>{const d=dialog(r.title);d.append(el('p',r.body),button('수정',()=>editor(r)),button('삭제',()=>{if(confirm('정말 삭제하시겠습니까?'+(r.kind==='섬'?' 이 섬과 연결된 다리도 삭제됩니다.':'')))save({action:'delete',id:r.id},'mine')}),button('닫기',()=>d.close()))}));tr.append(el('td',r.kind),title,el('td',r.body));body.append(tr)}if(!body.children.length){const cell=el('td','아직 작성한 이야기가 없어요.');cell.colSpan=3;const tr=el('tr');tr.append(cell);body.append(tr)}}
$('entry').onsubmit=e=>{e.preventDefault();const f=e.target;save({action:'create',kind:'섬',title:f.elements.title.value.trim(),body:f.elements.body.value.trim(),tags:[...f.querySelectorAll(':checked')].map(c=>c.value)},'board')};
$('mapbtn').onclick=()=>{demo=false;view('board')};$('sample').onclick=()=>{demo=true;view('board')};$('newbtn').onclick=()=>{demo=false;view(island()?'board':'intro')};$('listbtn').onclick=()=>view('mine');
$('csv').onclick=()=>{const field=v=>{let s=String(v??'');if(/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'};const name=id=>rows.find(r=>r.id===id)?.title||'';const lines=[['속성','제목','내용','출발 섬','도착 섬'],...rows.map(r=>[r.kind,r.title,r.body,name(r.from),name(r.to)])];const url=URL.createObjectURL(new Blob(['\uFEFF'+lines.map(row=>row.map(field).join(',')).join('\r\n')],{type:'text/csv;charset=utf-8'}));const a=el('a');a.href=url;a.download='섬과다리.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000)};
if(!live){const note=el('p','체험판 · 이 기기에만 저장됩니다.');$('intro').prepend(note)}
sync(true);if(live)setInterval(()=>{if(!document.hidden)sync()},7000);window.addEventListener('resize',()=>{if(!$('board').hidden)draw()});
