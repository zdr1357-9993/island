const $ = id => document.getElementById(id);
const key = localStorage.islandOwner || (localStorage.islandOwner = crypto.randomUUID());
const HOST = new URLSearchParams(location.search).get('view') === 'host'; // 진행자용 큰 화면: ?view=host

/* ---------- 바다 격자: 5칸 × 4줄 = 20자리, 상하좌우가 이웃 ---------- */
const COLS = 5, ROWS = 4, MAX = COLS * ROWS;
const cellOf = s => [s % COLS, Math.floor(s / COLS)];
const slotAt = (c, r) => (c < 0 || r < 0 || c >= COLS || r >= ROWS) ? -1 : r * COLS + c;
const neighbors = s => { const [c, r] = cellOf(s); return [slotAt(c, r - 1), slotAt(c + 1, r), slotAt(c, r + 1), slotAt(c - 1, r)].filter(n => n >= 0); };
// 가운데부터 바깥으로 채워서 섬이 적을 때도 서로 가깝게 모이도록
const FILL = [...Array(MAX).keys()].sort((a, b) => {
  const d = s => { const [c, r] = cellOf(s); return Math.abs(c - 2) + Math.abs(r - 1.5) * 1.1; };
  return d(a) - d(b) || a - b;
});

const sampleRows = [
  {id:'a',kind:'섬',type:'생각',title:'망설임섬',body:'도움을 묻고 싶었지만 말을 걸기 망설였어요.'},
  {id:'b',kind:'섬',type:'생각',title:'편견섬',body:'상대의 말을 듣기 전에 내 기준으로 판단했어요.'},
  {id:'c',kind:'섬',type:'장벽',title:'거리감섬',body:'낯설다는 이유로 멀찍이 서 있었어요.'},
  {id:'e',kind:'섬',type:'장벽',title:'침묵섬',body:'불편한 말을 들어도 그냥 넘겼어요.'},
  {id:'d',kind:'다리',title:'기다림의 다리',body:'상대가 말을 마칠 때까지 기다리기.',from:'a',to:'b'},
  {id:'f',kind:'다리',title:'먼저 묻는 다리',body:'불편하다고 단정하기 전에 어떤 도움이 필요한지 먼저 묻기.',from:'e',to:'c'}
];

let rows = [], demo = false, busy = false, loading = false, revision = 0, avatar = Number(localStorage.islandAvatar || 0);
let layout = {slots: new Map(), bySlot: new Map()}, walking = null;
const live = Boolean(window.BOARD_API);
const data = () => demo ? sampleRows : rows;
const island = () => rows.find(r => r.mine && r.kind === '섬' && !r.sunk);
const el = (tag, text) => Object.assign(document.createElement(tag), {textContent: text ?? ''});
function button(text, fn, cls){ const b = el('button', text); b.type = 'button'; b.onclick = fn; if (cls) b.className = cls; return b; }
function view(id){ for (const page of ['intro','board','mine']) $(page).hidden = page !== id; if (id === 'board') draw(); if (id === 'mine') list(); scrollTo(0, 0); }
let statusTimer; function tell(s, ms = 2400){ $('status').textContent = s; clearTimeout(statusTimer); if (s) statusTimer = setTimeout(() => $('status').textContent = '', ms); }
// 같은 종류의 섬도 두 가지 그림 중 하나로 (id로 정해져서 모든 기기에서 같음)
const variant = id => [...String(id)].reduce((a, ch) => a + ch.charCodeAt(0), 0) % 2 ? '-2' : '';
const isleImage = r => r.sunk ? 'isle-sunk.webp' : (r.type === '장벽' ? 'isle-wall' : 'isle-think') + variant(r.id) + '.webp';

/* ---------- 확인 팝업 (브라우저 기본 confirm 대신) ---------- */
function ask(text, ok = '확인'){
  const d = $('confirm'); $('confirm-text').textContent = text; $('confirm-ok').textContent = ok;
  return new Promise(res => {
    const done = v => { d.close(); res(v); };
    $('confirm-ok').onclick = () => done(true); $('confirm-no').onclick = () => done(false); d.oncancel = () => res(false);
    d.showModal();
  });
}

/* ---------- 섬 → 자리 배정 ---------- */
// 서버가 slot을 저장하면 그 값을 쓰고, 없거나 겹치면 FILL 순서대로 빈자리를 채운다(모든 기기에서 같은 결과).
function assignSlots(items){
  const slots = new Map(), bySlot = new Map();
  const isles = items.filter(r => r.kind === '섬');
  for (const r of isles){ const s = Number(r.slot); if (r.slot !== undefined && r.slot !== '' && s >= 0 && s < MAX && !bySlot.has(s)){ slots.set(r.id, s); bySlot.set(s, r); } }
  for (const r of isles){ if (slots.has(r.id)) continue; const s = FILL.find(f => !bySlot.has(f)); if (s === undefined) break; slots.set(r.id, s); bySlot.set(s, r); }
  return {slots, bySlot};
}
const freeSlot = () => { const {bySlot} = assignSlots(rows); return FILL.find(f => !bySlot.has(f)); };

/* ---------- 경로: 최단 경로, 같은 길이면 섬이 있는 자리를 지나가도록 ---------- */
function route(a, b, bySlot = layout.bySlot){
  if (a === undefined || b === undefined) return [];
  const cost = s => bySlot.has(s) ? 1 : 1.01;
  const dist = new Map([[a, 0]]), prev = new Map(), todo = new Set([a]);
  while (todo.size){
    let u = null; for (const t of todo) if (u === null || dist.get(t) < dist.get(u)) u = t;
    todo.delete(u); if (u === b) break;
    for (const n of neighbors(u)){ const nd = dist.get(u) + cost(n); if (!dist.has(n) || nd < dist.get(n) - 1e-9){ dist.set(n, nd); prev.set(n, u); todo.add(n); } }
  }
  if (!dist.has(b)) return [];
  const path = [b]; while (path[0] !== a) path.unshift(prev.get(path[0]));
  return path;
}
const segKey = (a, b) => a < b ? a + '-' + b : b + '-' + a;
function bridgeSegments(items, lay){
  const segs = new Map();
  for (const v of items.filter(r => r.kind === '다리')){
    const path = route(lay.slots.get(v.from), lay.slots.get(v.to), lay.bySlot);
    for (let i = 1; i < path.length; i++){
      const k = segKey(path[i - 1], path[i]);
      if (!segs.has(k)) segs.set(k, {a: path[i - 1], b: path[i], bridges: []});
      segs.get(k).bridges.push(v);
    }
  }
  return segs;
}

/* ---------- 저장소 (BOARD_API가 없으면 이 기기에만 저장하는 체험판) ---------- */
function local(p){
  let saved = JSON.parse(localStorage.islandPreview || 'null') || sampleRows.map(r => ({...r, mine:false}));
  const own = id => saved.find(r => r.id === id && r.mine);
  if (p.action === 'create'){
    if (p.kind === '섬' && saved.filter(r => r.kind === '섬').length >= MAX) throw Error('바다가 가득 찼어요.');
    const {action, ...row} = p;
    saved.push({...row, id: crypto.randomUUID(), mine: true, from: p.kind === '다리' ? island()?.id : ''});
  }
  if (p.action === 'edit' && own(p.id)) Object.assign(own(p.id), {title: p.title, body: p.body});
  if (p.action === 'delete' && own(p.id)){
    // 섬은 지우지 않고 가라앉힌다: 남이 놓은 다리는 그대로 남는다
    if (own(p.id).kind === '섬') Object.assign(own(p.id), {sunk: true, title: '가라앉은 섬', body: ''});
    else saved = saved.filter(r => r.id !== p.id);
  }
  localStorage.islandPreview = JSON.stringify(saved); return saved;
}
async function request(p){
  if (!live) return local(p);
  const res = await fetch(window.BOARD_API, {method:'POST', body: JSON.stringify({...p, key, code: window.EVENT_CODE || ''}), signal: AbortSignal.timeout(30000)});
  const result = await res.json();
  if (!res.ok || result.error) throw Error(result.error || '연결을 확인해 주세요.');
  return result.rows;
}
async function sync(first = false){
  if (loading || busy) return; loading = true; const seq = revision;
  try {
    const got = await request({action:'read'}); if (seq !== revision) return;
    const old = rows; rows = got;
    if (first){ tell(''); view(island() || HOST ? 'board' : 'intro'); }
    else if (!$('board').hidden && !demo && !walking && !$('modal').open) draw(old);
    else if (!$('mine').hidden && !$('modal').open) list();
  } catch(e){ tell('보드를 불러오지 못했어요. ' + e.message, 4000); if (first) view(HOST ? 'board' : 'intro'); }
  finally { loading = false; }
}
async function save(p, destination){
  if (busy) return; busy = true; revision++;
  const btns = [...document.querySelectorAll('button:not(:disabled)')]; btns.forEach(b => b.disabled = true);
  try {
    const old = rows; rows = await request(p);
    $('modal').close(); demo = false; view(destination);
    if (destination === 'board') draw(old);
    tell(p.action === 'create' ? (p.kind === '다리' ? '다리가 놓였어요.' : '바다 위에 섬이 떠올랐어요.') : p.action === 'delete' ? '정리했어요.' : '저장했어요.');
  } catch(e){ tell(e.message, 4000); }
  finally { busy = false; btns.forEach(b => b.disabled = false); }
}

/* ---------- 바다 그리기 ---------- */
function geometry(){
  const world = $('world'), avail = Math.max(300, world.parentElement.clientWidth);
  const portrait = avail < 640; // 휴대폰 세로: 격자를 돌려서 4칸 × 5줄로
  // 큰 화면(진행자 화면)에서는 바다 전체가 한 화면에 들어오도록 높이 기준으로도 맞춘다
  const w = portrait ? avail : Math.min(avail, Math.max(640, (innerHeight - (HOST ? 90 : 200)) / 0.624));
  const cols = portrait ? ROWS : COLS, rws = portrait ? COLS : ROWS;
  const cw = w / cols, ch = portrait ? Math.max(96, cw * 1.15) : cw * 0.78;
  const pos = s => { const [c, r] = cellOf(s); const [x, y] = portrait ? [r, c] : [c, r]; return [cw * (x + .5), ch * (y + .5)]; };
  return {w, h: ch * rws, cw, ch, pos, portrait, k: Math.min(1.8, Math.max(.8, cw / 100))};
}
function draw(old = data()){
  const items = data(), world = $('world'), g = geometry();
  layout = assignSlots(items);
  const oldLay = assignSlots(old), oldSegs = bridgeSegments(old, oldLay), segs = bridgeSegments(items, layout);
  world.style.width = g.w + 'px'; world.style.height = g.h + 'px';
  world.classList.toggle('tall', g.portrait);
  world.style.setProperty('--cell', Math.min(g.cw, g.ch / .8) + 'px');
  const svg = $('lines'); svg.setAttribute('viewBox', `0 0 ${g.w} ${g.h}`); svg.replaceChildren();
  $('nodes').replaceChildren();
  const isles = items.filter(r => r.kind === '섬'), bridges = items.filter(r => r.kind === '다리');
  $('caption').textContent = (demo ? '예시 바다' : live ? '우리의 바다' : '이 기기 체험 바다') + ' · 섬 ' + isles.filter(r => !r.sunk).length + ' · 다리 ' + bridges.length;
  $('newbtn').hidden = HOST || (!demo && !!island()); $('newbtn').textContent = demo ? '참여 화면으로' : '섬 만들기';
  $('listbtn').hidden = $('csv').hidden = demo || HOST;
  $('hint').textContent = HOST ? '' : demo ? '예시예요. 실제 기록과 섞이지 않아요.' : island() ? '다른 섬을 눌러 이야기를 읽고, 다리를 놓아 보세요.' : '섬을 눌러 이야기를 읽을 수 있어요.';

  const ns = 'http://www.w3.org/2000/svg', line = (a, b, cls, width) => {
    const [x1, y1] = g.pos(a), [x2, y2] = g.pos(b), l = document.createElementNS(ns, 'line');
    Object.entries({x1, y1, x2, y2, class: cls}).forEach(([k, v]) => l.setAttribute(k, v));
    if (width) l.style.strokeWidth = width; svg.append(l); return l;
  };
  // 아직 아무도 놓지 않은 다리 자리(이웃한 두 섬 사이)
  for (const [s, r] of layout.bySlot) for (const n of neighbors(s)) if (n > s && layout.bySlot.has(n) && !r.sunk && !layout.bySlot.get(n).sunk && !segs.has(segKey(s, n))) line(s, n, 'maybe');
  // 놓인 다리: 같은 구간을 지나는 다리가 많을수록 굵게
  const passing = new Map();
  for (const [k, seg] of segs){
    const n = seg.bridges.length, fresh = !oldSegs.has(k) || oldSegs.get(k).bridges.length < n, wd = Math.min(n - 1, 4) * 2.5;
    line(seg.a, seg.b, 'rope', (9 + wd) * g.k);
    const plank = line(seg.a, seg.b, 'plank' + (fresh ? ' built' : ''), (5.5 + wd) * g.k);
    if (fresh) plank.style.setProperty('--len', Math.hypot(...[0, 1].map(i => g.pos(seg.a)[i] - g.pos(seg.b)[i])));
    if (n > 1){
      const [x1, y1] = g.pos(seg.a), [x2, y2] = g.pos(seg.b), t = el('span', n);
      t.className = 'count'; t.style.left = (x1 + x2) / 2 + 'px'; t.style.top = (y1 + y2) / 2 + 'px'; $('nodes').append(t);
    }
    for (const s of [seg.a, seg.b]){ if (!passing.has(s)) passing.set(s, new Set()); seg.bridges.forEach(v => passing.get(s).add(v.id)); }
  }
  // 빈자리: 다리가 지나가면 징검돌, 아니면 잔물결만
  for (let s = 0; s < MAX; s++){
    if (layout.bySlot.has(s)) continue;
    const [x, y] = g.pos(s), d = el('span');
    d.className = passing.has(s) ? 'stone' : 'empty'; d.style.left = x + 'px'; d.style.top = y + 'px'; $('nodes').append(d);
  }
  for (const r of isles){
    const s = layout.slots.get(r.id), [x, y] = g.pos(s);
    const b = button('', () => (demo || HOST) ? detail(r) : walkTo(r));
    b.dataset.id = r.id; b.setAttribute('aria-label', r.title + ' 섬 보기');
    b.className = 'isle' + (!oldLay.slots.has(r.id) ? ' born' : '') + (r.mine && !r.sunk ? ' mine' : '') + (r.sunk ? ' sunk' : !passing.has(s) ? ' waiting' : '');
    b.style.left = x + 'px'; b.style.top = y + 'px';
    const img = el('img'); img.src = isleImage(r); img.alt = '';
    b.append(img, el('span', r.title));
    if (r.mine && !r.sunk){ const me = el('i', '내 섬'); me.className = 'me'; b.append(me); }
    $('nodes').append(b);
  }
}

/* ---------- 캐릭터가 다리 길을 따라 걷기 (누르면 건너뛰기) ---------- */
function walkTo(target){
  if (!target) return;
  document.querySelector('.walker')?.remove(); walking?.cancel();
  const g = geometry(), end = layout.slots.get(target.id), mine = island(), start = mine ? layout.slots.get(mine.id) : undefined;
  let pts = start === undefined ? [] : route(start, end).map(g.pos);
  if (pts.length < 2){ const [x, y] = g.pos(end); pts = [[Math.max(30, x - g.cw * .6), Math.max(30, y - g.ch * .4)], [x, y]]; }
  const person = el('img'); person.src = 'assets/characters/' + String(avatar + 1).padStart(2, '0') + '.png';
  person.className = 'walker'; person.alt = ''; $('world').append(person);
  walking = person.animate(pts.map(([x, y]) => ({left: x + 'px', top: y + 'px'})), {duration: Math.min(3200, 350 + (pts.length - 1) * 520), easing: 'linear', fill: 'forwards'});
  const finish = () => { tell(''); $('world').removeEventListener('pointerdown', skip, true); person.remove(); walking = null; detail(target); };
  const skip = e => { e.stopPropagation(); e.preventDefault(); walking.onfinish = null; walking.cancel(); finish(); };
  $('world').addEventListener('pointerdown', skip, true);
  walking.onfinish = finish;
  if (pts.length > 2) tell('다리를 건너는 중… 누르면 바로 도착해요.', 1800);
}

/* ---------- 섬 상세 / 다리 놓기 ---------- */
function dialog(title){ const d = $('modal'); d.replaceChildren(el('h2', title)); if (!d.open) d.showModal(); return d; }
const titleOf = id => data().find(r => r.id === id)?.title || '사라진 섬';
function bridgeItem(v, note){ const box = el('div'); box.className = 'bridge-item'; box.append(el('small', note), el('b', v.title), el('p', v.body)); return box; }
function detail(r){
  const d = dialog(r.title);
  const tag = el('span', r.sunk ? '가라앉은 섬' : r.type === '장벽' ? '우리 주변의 장벽' : '돌아보게 된 생각'); tag.className = 'tag'; d.append(tag);
  d.append(el('p', r.sunk ? '이 섬의 이야기는 내려놓았어요. 이 섬에 닿았던 다리는 남아 있어요.' : r.body));
  const all = data().filter(v => v.kind === '다리'), s = layout.slots.get(r.id);
  const incoming = all.filter(v => v.to === r.id), outgoing = all.filter(v => v.from === r.id);
  const through = all.filter(v => v.from !== r.id && v.to !== r.id && route(layout.slots.get(v.from), layout.slots.get(v.to)).slice(1, -1).includes(s));
  if (incoming.length || outgoing.length || through.length) d.append(el('h3', '이 섬에 닿은 다리'));
  incoming.forEach(v => d.append(bridgeItem(v, titleOf(v.from) + '에서 건너온 다리')));
  outgoing.forEach(v => d.append(bridgeItem(v, titleOf(v.to) + '(으)로 놓은 다리')));
  through.forEach(v => d.append(bridgeItem(v, titleOf(v.from) + ' → ' + titleOf(v.to) + ' 다리가 이 섬을 지나가요')));
  if (!incoming.length && !through.length && !r.sunk){ const p = el('p', '아직 이 섬에 닿은 다리가 없어요.'); p.className = 'muted'; d.append(p); }
  const row = el('div'); row.className = 'actions';
  if (!demo && !HOST && !r.mine && !r.sunk && island() && !rows.some(v => v.kind === '다리' && v.from === island().id && v.to === r.id)) row.append(button('다리 놓기', () => editor(null, r), 'primary'));
  else if (!demo && !HOST && !island() && !r.mine) row.append(button('내 섬 먼저 만들기', () => { d.close(); view('intro'); }, 'primary'));
  row.append(button('닫기', () => d.close())); d.append(row);
}
function editor(r, target){
  const d = dialog(r ? (r.kind === '섬' ? '섬 수정' : '다리 수정') : '다리 놓기'), form = el('form'), fields = {};
  if (!r && target && island()){
    const path = route(layout.slots.get(island().id), layout.slots.get(target.id)).map(s => layout.bySlot.get(s)?.title || '징검돌');
    const p = el('p', path.join(' → ') + ' 으로 이어져요.'); p.className = 'route'; d.append(p);
  }
  const labels = r?.kind === '섬' ? ['섬 이름', '이 섬에 있는 넘기 어려운 무언가'] : r ? ['다리 이름', '내가 해볼 작은 행동 하나'] : ['다리 이름', '그 장벽을 낮추기 위해 내가 해볼 작은 행동 하나'];
  for (const [i, [k, tag, max]] of [['title', 'input', 24], ['body', 'textarea', 240]].entries()){
    const l = el('label', labels[i]), input = el(tag); input.required = true; input.maxLength = max; input.value = r?.[k] || '';
    if (k === 'title' && !r) input.placeholder = '예: 도움의 다리, 요청의 다리';
    l.append(input); form.append(l); fields[k] = input;
  }
  const row = el('div'); row.className = 'actions';
  const submit = el('button', r ? '완료' : '다리 연결하기'); submit.className = 'primary';
  row.append(submit, button('취소', () => d.close())); form.append(row);
  form.onsubmit = async e => { e.preventDefault();
    if (r && !(await ask('정말 수정하시겠습니까?', '수정하기'))) return;
    save({action: r ? 'edit' : 'create', kind: r?.kind || '다리', id: r?.id, to: target?.id, title: fields.title.value.trim(), body: fields.body.value.trim()}, r ? 'mine' : 'board'); };
  d.append(form);
}

/* ---------- 내 이야기 수정 ---------- */
function list(){
  const box = $('mylist'); box.replaceChildren();
  for (const r of rows.filter(v => v.mine && !v.sunk)){
    const card = el('article'); card.className = 'story';
    const head = el('div'); head.className = 'story-head';
    const kind = el('span', r.kind); kind.className = 'tag';
    head.append(kind, el('b', r.title)); card.append(head);
    if (r.kind === '다리'){ const s = el('small', titleOf(r.from) + ' → ' + titleOf(r.to)); card.append(s); }
    card.append(el('p', r.body));
    const row = el('div'); row.className = 'actions';
    row.append(button('수정', () => editor(r)), button('삭제', async () => {
      const msg = r.kind === '섬' ? '정말 삭제하시겠습니까? 섬은 가라앉고, 다른 사람이 놓아 준 다리는 남아요.' : '정말 이 다리를 삭제하시겠습니까?';
      if (await ask(msg, '삭제하기')) save({action:'delete', id:r.id}, 'mine');
    }, 'danger'));
    card.append(row); box.append(card);
  }
  if (!box.children.length){ const p = el('p', '아직 작성한 이야기가 없어요.'); p.className = 'muted'; box.append(p); }
}
function setupAvatars(){
  const box = $('avatars'); box.replaceChildren();
  for (let i = 0; i < 20; i++){
    const b = button('', () => { avatar = i; localStorage.islandAvatar = i; box.querySelectorAll('.avatar').forEach((x, j) => { x.classList.toggle('selected', j === i); x.setAttribute('aria-pressed', j === i); }); });
    b.className = 'avatar' + (i === avatar ? ' selected' : ''); b.setAttribute('aria-label', '캐릭터 ' + (i + 1)); b.setAttribute('aria-pressed', i === avatar);
    const img = el('img'); img.src = 'assets/characters/' + String(i + 1).padStart(2, '0') + '.png'; img.alt = ''; b.append(img); box.append(b);
  }
}

/* ---------- 연결 ---------- */
$('entry').onsubmit = e => {
  e.preventDefault(); const f = e.target, slot = freeSlot();
  if (slot === undefined){ tell('바다가 가득 찼어요. 섬은 ' + MAX + '개까지 만들 수 있어요.', 4000); return; }
  save({action:'create', kind:'섬', slot, type: f.elements.type.value, title: f.elements.title.value.trim(), body: f.elements.body.value.trim()}, 'board');
};
$('mapbtn').onclick = () => { demo = false; view('board'); };
$('sample').onclick = () => { demo = true; view('board'); };
$('newbtn').onclick = () => { demo = false; view(island() ? 'board' : 'intro'); };
$('listbtn').onclick = () => view('mine');
$('backbtn').onclick = () => view('board');
$('csv').onclick = () => {
  const field = v => { let s = String(v ?? ''); if (/^[=+@\-\t\r]/.test(s)) s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; };
  const lay = assignSlots(rows), name = id => rows.find(r => r.id === id)?.title || '';
  const via = r => r.kind === '다리' ? route(lay.slots.get(r.from), lay.slots.get(r.to), lay.bySlot).map(s => lay.bySlot.get(s)?.title || '징검돌').join(' → ') : '';
  const lines = [['속성','종류','제목','내용','출발 섬','도착 섬','지나가는 길'], ...rows.map(r => [r.kind, r.kind === '섬' ? (r.sunk ? '가라앉음' : r.type || '') : '', r.title, r.body, name(r.from), name(r.to), via(r)])];
  const url = URL.createObjectURL(new Blob(['﻿' + lines.map(row => row.map(field).join(',')).join('\r\n')], {type:'text/csv;charset=utf-8'}));
  const a = el('a'); a.href = url; a.download = '섬과다리.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
};
if (HOST) document.body.classList.add('host');
if (!live){ const note = el('p', '체험판 · 이 기기에만 저장됩니다.'); note.className = 'note'; $('intro').prepend(note); }
setupAvatars();
if (live){ $('intro').hidden = true; tell('바다를 불러오는 중…', 8000); }
sync(true);
if (live) setInterval(() => { if (!document.hidden) sync(); }, HOST ? 4000 : 6000);
let resizeTimer; window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (!$('board').hidden && !walking) draw(); }, 150); });
