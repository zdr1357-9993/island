const $ = id => document.getElementById(id);
// 오래된 브라우저(iOS 15.3 이하 등)에는 crypto.randomUUID가 없다
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = crypto.getRandomValues(new Uint8Array(1))[0] & 15; return (c === 'x' ? r : (r & 3) | 8).toString(16); });
const store = (() => { try { localStorage.setItem('_t', '1'); localStorage.removeItem('_t'); return localStorage; } catch(e){ return {}; } })();
const key = store.islandOwner || (store.islandOwner = uuid());
const HOST = new URLSearchParams(location.search).get('view') === 'host'; // 진행자용 큰 화면: ?view=host

/* ---------- 바다 격자: 5칸 × 4줄 = 20자리, 상하좌우가 이웃 ---------- */
const COLS = 5, ROWS = 4, MAX = COLS * ROWS;
const PER = 4; // 한 사람(기기)이 만들 수 있는 섬 수
const cellOf = s => [s % COLS, Math.floor(s / COLS)];
const slotAt = (c, r) => (c < 0 || r < 0 || c >= COLS || r >= ROWS) ? -1 : r * COLS + c;
// 상하좌우 이웃(점선 표시용)과 대각선까지 포함한 이웃(길 찾기용)
const neighbors = s => { const [c, r] = cellOf(s); return [slotAt(c, r - 1), slotAt(c + 1, r), slotAt(c, r + 1), slotAt(c - 1, r)].filter(n => n >= 0); };
const around = s => { const [c, r] = cellOf(s), out = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy){ const n = slotAt(c + dx, r + dy); if (n >= 0) out.push(n); } return out; };
const stepCost = (a, b) => { const [ac, ar] = cellOf(a), [bc, br] = cellOf(b); return ac !== bc && ar !== br ? 1.4 : 1; };
// 가운데부터 바깥으로 채워서 섬이 적을 때도 서로 가깝게 모이도록
const FILL = [...Array(MAX).keys()].sort((a, b) => {
  const d = s => { const [c, r] = cellOf(s); return Math.abs(c - 2) + Math.abs(r - 1.5) * 1.1; };
  return d(a) - d(b) || a - b;
});

const sampleRows = [
  {id:'a',kind:'섬',title:'망설임섬',body:'도움을 묻고 싶었지만 말을 걸기 망설였어요.'},
  {id:'b',kind:'섬',title:'편견섬',body:'상대의 말을 듣기 전에 내 기준으로 판단했어요.'},
  {id:'c',kind:'섬',title:'거리감섬',body:'낯설다는 이유로 멀찍이 서 있었어요.'},
  {id:'e',kind:'섬',title:'침묵섬',body:'불편한 말을 들어도 그냥 넘겼어요.'},
  {id:'d',kind:'다리',title:'기다림의 다리',body:'상대가 말을 마칠 때까지 기다리기.',from:'a',to:'b'},
  {id:'f',kind:'다리',title:'먼저 묻는 다리',body:'불편하다고 단정하기 전에 어떤 도움이 필요한지 먼저 묻기.',from:'e',to:'c'}
];

let rows = [], demo = false, busy = false, loading = false, revision = 0, avatar = Number(store.islandAvatar || 0), focusId = null;
let layout = {slots: new Map(), bySlot: new Map()}, walking = null;
const live = Boolean(window.BOARD_API);
const data = () => demo ? sampleRows : rows;
const myIsles = () => rows.filter(r => r.mine && r.kind === '섬');
const hasBridge = (a, b) => rows.some(v => v.kind === '다리' && v.from === a && v.to === b);
// 이 섬으로 다리를 놓을 수 있는 내 섬들 (내 섬끼리도 가능, 같은 방향 다리는 한 번만)
const startsFor = r => myIsles().filter(m => m.id !== r.id && !hasBridge(m.id, r.id));
const el = (tag, text) => Object.assign(document.createElement(tag), {textContent: text ?? ''});
function button(text, fn, cls){ const b = el('button', text); b.type = 'button'; b.onclick = fn; if (cls) b.className = cls; return b; }
function view(id){
  for (const page of ['intro','board','mine']) $(page).hidden = page !== id;
  if (walking){ walking.onfinish = null; walking.cancel(); walking = null; document.querySelector('.walker')?.remove(); }
  $('introback').hidden = !myIsles().length;
  if (id === 'board') draw(); if (id === 'mine') list(); scrollTo(0, 0);
}
let statusTimer; function tell(s, ms = 2400){ $('status').textContent = s; clearTimeout(statusTimer); if (s) statusTimer = setTimeout(() => $('status').textContent = '', ms); }
// 같은 종류의 섬도 두 가지 그림 중 하나로 (id로 정해져서 모든 기기에서 같음)
const pick = (id, list) => list[[...String(id)].reduce((a, ch) => a + ch.charCodeAt(0), 0) % list.length];
// 섬 그림: 섬마다 id로 하나가 정해져서 모든 기기에서 같은 그림이 보인다. 같은 바다 안에서는 되도록 겹치지 않게 고른다
const ISLES = ['reflection-cottage.png', 'isle-waterfall.webp', 'barrier-stonewall.png', 'isle-maple.webp', 'reflection-well.png', 'isle-pavilion.webp', 'barrier-cliff-fence.png', 'isle-lighthouse.webp', 'isle-bell.webp'];
let isleArt = new Map();
function assignArt(items){
  isleArt = new Map(); const used = new Map();
  for (const r of items.filter(v => v.kind === '섬')){
    const start = [...String(r.id)].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7) % ISLES.length;
    let best = start; for (let k = 0; k < ISLES.length; k++){ const i = (start + k) % ISLES.length; if ((used.get(i) || 0) < (used.get(best) || 0)) best = i; }
    used.set(best, (used.get(best) || 0) + 1); isleArt.set(r.id, ISLES[best]);
  }
}
const isleImage = r => 'assets/islands/' + (isleArt.get(r.id) || ISLES[0]);

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
  // 바로 옆(대각선 포함)이면 한 걸음에. 같은 길이면 빈 바다보다 섬을 지나가는 길을 고른다
  const cost = (u, n) => stepCost(u, n) + (bySlot.has(n) || n === b ? 0 : 0.05);
  const dist = new Map([[a, 0]]), prev = new Map(), todo = new Set([a]);
  while (todo.size){
    let u = null; for (const t of todo) if (u === null || dist.get(t) < dist.get(u)) u = t;
    todo.delete(u); if (u === b) break;
    for (const n of around(u)){ const nd = dist.get(u) + cost(u, n); if (!dist.has(n) || nd < dist.get(n) - 1e-9){ dist.set(n, nd); prev.set(n, u); todo.add(n); } }
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
  let saved = JSON.parse(store.islandPreview || 'null') || sampleRows.map(r => ({...r, mine:false}));
  const own = id => saved.find(r => r.id === id && r.mine);
  if (p.action === 'create'){
    if (p.kind === '섬' && saved.filter(r => r.kind === '섬').length >= MAX) throw Error('바다가 가득 찼어요.');
    if (p.kind === '섬' && saved.filter(r => r.kind === '섬' && r.mine).length >= PER) throw Error('섬은 한 사람당 ' + PER + '개까지 만들 수 있어요.');
    const {action, req, ...row} = p;
    saved.push({...row, id: uuid(), mine: true, from: p.kind === '다리' ? p.from : ''});
  }
  if (p.action === 'reset'){ store.islandPreview = '[]'; return []; }
  if (p.action === 'adminDelete'){ const t = saved.find(r => r.id === p.id); saved = saved.filter(r => t?.kind === '섬' ? ![r.id, r.from, r.to].includes(p.id) : r.id !== p.id); }
  if (p.action === 'edit' && own(p.id)) Object.assign(own(p.id), {title: p.title, body: p.body});
  if (p.action === 'delete' && own(p.id)){
    // 섬을 지우면 그 섬에 닿은 다리도 함께 사라진다
    saved = own(p.id).kind === '섬' ? saved.filter(r => ![r.id, r.from, r.to].includes(p.id)) : saved.filter(r => r.id !== p.id);
  }
  store.islandPreview = JSON.stringify(saved); return saved;
}
async function request(p){
  if (!live) return local(p);
    // Apps Script는 처음 깨어날 때 느릴 수 있어 넉넉히 기다린다. AbortSignal.timeout이 없는 브라우저도 있다
  const ctl = new AbortController(), timer = setTimeout(() => ctl.abort(), 45000);
  let res; try { res = await fetch(window.BOARD_API, {method:'POST', body: JSON.stringify({...p, key, code: window.EVENT_CODE || ''}), signal: ctl.signal}); }
  catch(e){ throw Error(e.name === 'AbortError' ? '응답이 늦어요. 잠시 후 바다를 확인해 주세요.' : '연결을 확인해 주세요.'); }
  finally { clearTimeout(timer); }
  const result = await res.json();
  if (!res.ok || result.error) throw Error(result.error || '연결을 확인해 주세요.');
  return result.rows;
}
async function sync(first = false){
  if (loading || busy) return; loading = true; const seq = revision;
  try {
    const got = await request({action:'read'}); if (seq !== revision) return;
    const old = rows; rows = got;
    if (first){ tell(''); view(myIsles().length || HOST ? 'board' : 'intro'); }
    else if (!$('board').hidden && !demo && !walking && !$('modal').open) draw(old);
    else if (!$('mine').hidden && !$('modal').open) list();
  } catch(e){ tell('보드를 불러오지 못했어요. ' + e.message, 4000); if (first) view(HOST ? 'board' : 'intro'); }
  finally { loading = false; }
}
async function save(p, destination){
  if (busy) return; busy = true; revision++;
  if (p.action === 'create') p = {...p, req: uuid()}; // 다시 눌러도 두 번 만들어지지 않도록
  const btns = [...document.querySelectorAll('button:not(:disabled)')]; btns.forEach(b => b.disabled = true);
  // 저장이 끝날 때까지 화면을 막고 기다리게 한다 (Apps Script는 몇 초에서 길게는 수십 초 걸린다)
  const wait = $('saving'), msg = p.action === 'create' ? (p.kind === '섬' ? '섬을 바다에 띄우는 중이에요' : '다리를 놓는 중이에요') : p.action === 'reset' ? '바다를 비우는 중이에요' : '저장하는 중이에요';
  $('saving-text').textContent = msg + '…'; $('saving-sub').textContent = '잠시만 기다려 주세요.';
  const slow = setTimeout(() => { $('saving-sub').textContent = '사람이 많아 조금 오래 걸리고 있어요. 화면을 닫지 말고 기다려 주세요.'; }, 8000);
  if (live && !wait.open) wait.showModal();
  try {
    const old = rows;
    try { rows = await request(p); }
    catch(e){
      // 응답만 늦고 서버에는 저장됐을 수 있다. 다시 읽어서 같은 요청(req)이 들어갔는지 확인
      if (p.action !== 'create' || !live) throw e;
      const got = await request({action:'read'}).catch(() => null);
      if (!got || !got.some(r => r.mine && r.req === p.req)) throw e;
      rows = got;
    }
    if (p.action !== 'adminDelete') $('modal').close(); demo = false;
    if (p.action === 'create' && p.kind === '섬'){ const born = myIsles().find(r => !old.some(o => o.id === r.id)); focusId = born?.id || null; $('entry').reset(); }
    view(destination);
    if (destination === 'board') draw(old);
    if (focusId) showFocus();
    if (p.action === 'reset' || p.action === 'adminDelete') return true;
    tell(p.action === 'create' ? (p.kind === '다리' ? '다리가 놓였어요.' : '바다 위에 섬이 떠올랐어요.') : p.action === 'delete' ? '정리했어요.' : '저장했어요.');
    return true;
  } catch(e){ tell(e.message, 4000); return false; }
  finally { clearTimeout(slow); if (wait.open) wait.close(); busy = false; btns.forEach(b => b.disabled = false); }
}

/* ---------- 바다 그리기 ---------- */
function geometry(){
  const world = $('world'), avail = Math.max(300, world.parentElement.clientWidth);
  const portrait = avail < 640; // 휴대폰 세로: 격자를 돌려서 4칸 × 5줄로
  // 큰 화면(진행자 화면)에서는 바다 전체가 한 화면에 들어오도록 높이 기준으로도 맞춘다
  const w = portrait ? avail : Math.min(avail, Math.max(640, (innerHeight - (HOST ? 90 : 200)) / 0.624));
  const cols = portrait ? ROWS : COLS, rws = portrait ? COLS : ROWS;
  const cw = w / cols, ch = portrait ? Math.max(96, cw * 1.15) : cw * 0.78;
  const top = ch * .12; // 맨 윗줄 섬의 나무가 잘리지 않도록 위쪽 여백
  const pos = s => { const [c, r] = cellOf(s); const [x, y] = portrait ? [r, c] : [c, r]; return [cw * (x + .5), top + ch * (y + .5)]; };
  return {w, h: ch * rws + top, cw, ch, pos, portrait, k: Math.min(1.8, Math.max(.8, cw / 100))};
}
function draw(old = data()){
  const items = data(), world = $('world'), g = geometry();
  layout = assignSlots(items); assignArt(items);
  const oldLay = assignSlots(old), oldSegs = bridgeSegments(old, oldLay), segs = bridgeSegments(items, layout);
  world.style.width = g.w + 'px'; world.style.height = g.h + 'px';
  world.classList.toggle('tall', g.portrait);
  world.style.setProperty('--cell', Math.min(g.cw, g.ch / .8) + 'px');
  const svg = $('lines'); svg.setAttribute('viewBox', `0 0 ${g.w} ${g.h}`); svg.replaceChildren();
  $('nodes').replaceChildren();
  const isles = items.filter(r => r.kind === '섬'), bridges = items.filter(r => r.kind === '다리');
  $('caption').textContent = (demo ? '예시 바다' : live ? '우리의 바다' : '이 기기 체험 바다') + ' · 섬 ' + isles.length + ' · 다리 ' + bridges.length;
  $('newbtn').hidden = HOST || (!demo && myIsles().length > 0); $('newbtn').textContent = demo ? '참여 화면으로' : '섬 만들기';
  $('listbtn').hidden = $('csv').hidden = demo || HOST;
  $('hint').textContent = HOST ? '' : demo ? '예시예요. 실제 기록과 섞이지 않아요.' : myIsles().length ? '섬을 눌러 이야기를 읽고, 다리를 놓아 보세요.' : '섬을 눌러 이야기를 읽을 수 있어요.';

  const ns = 'http://www.w3.org/2000/svg', line = (a, b, cls, width) => {
    const [x1, y1] = g.pos(a), [x2, y2] = g.pos(b), l = document.createElementNS(ns, 'line');
    Object.entries({x1, y1, x2, y2, class: cls}).forEach(([k, v]) => l.setAttribute(k, v));
    if (width) l.style.strokeWidth = width; svg.append(l); return l;
  };
  const defs = document.createElementNS(ns, 'defs'); svg.append(defs);
  // 아직 아무도 놓지 않은 다리 자리(이웃한 두 섬 사이)
  for (const [s, r] of layout.bySlot) for (const n of neighbors(s)) if (n > s && layout.bySlot.has(n) && !segs.has(segKey(s, n))) line(s, n, 'maybe');
  // 놓인 다리: 같은 구간을 지나는 다리가 많을수록 굵게
  const passing = new Map();
  for (const [k, seg] of segs){
    const n = seg.bridges.length, fresh = !oldSegs.has(k) || oldSegs.get(k).bridges.length < n, wd = Math.min(n - 1, 4) * 2.5;
    const rw = (11 + wd) * g.k, pw = (8 + wd) * g.k, [x1, y1] = g.pos(seg.a), [x2, y2] = g.pos(seg.b);
    line(seg.a, seg.b, 'rope', rw);
    // 나무 판자 무늬를 다리 방향으로 돌려서 입힌다
    const pat = document.createElementNS(ns, 'pattern'), img = document.createElementNS(ns, 'image'), tw = pw * 64 / 24;
    Object.entries({id: 'plank-' + k, patternUnits: 'userSpaceOnUse', width: tw, height: pw, patternTransform: `translate(${x1} ${y1}) rotate(${Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI}) translate(0 ${-pw / 2})`}).forEach(([a, v]) => pat.setAttribute(a, v));
    Object.entries({href: 'assets/bridges/wood-planks-tile.png', width: tw, height: pw, preserveAspectRatio: 'none'}).forEach(([a, v]) => img.setAttribute(a, v));
    pat.append(img); defs.append(pat);
    const plank = line(seg.a, seg.b, 'plank' + (fresh ? ' built' : ''), pw); plank.style.stroke = `url(#plank-${k})`;
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
    b.className = 'isle' + (!oldLay.slots.has(r.id) ? ' born' : '') + (r.mine ? ' mine' : '') + (r.id === focusId ? ' focus' : '') + (!passing.has(s) ? ' waiting' : '');
    b.style.left = x + 'px'; b.style.top = y + 'px';
    const img = el('img'); img.src = isleImage(r); img.alt = '';
    b.append(img, el('span', r.title));
    if (!oldLay.slots.has(r.id)) for (const k of [0, 1]){ const w = el('i'); w.className = 'wave w' + k; b.append(w); setTimeout(() => w.remove(), 1800); }
    if (r.mine){ const me = el('i', '내 섬'); me.className = 'me'; b.append(me); }
    $('nodes').append(b);
  }
}

// 방금 만든 섬: 화면 밖에 있으면 그 자리로 스크롤하고 잠시 빛나게
function showFocus(){
  const id = focusId, b = document.querySelector(`.isle[data-id="${id}"]`);
  if (!b) return;
  const r = b.getBoundingClientRect();
  if (r.top < 60 || r.bottom > innerHeight - 20) b.scrollIntoView({block: 'center', behavior: 'smooth'});
  setTimeout(() => { if (focusId === id){ focusId = null; document.querySelector(`.isle[data-id="${id}"]`)?.classList.remove('focus'); } }, 4000);
}

/* ---------- 캐릭터가 다리 길을 따라 걷기 (누르면 건너뛰기) ---------- */
function walkTo(target){
  if (!target) return;
  document.querySelector('.walker')?.remove(); walking?.cancel();
  const g = geometry(), end = layout.slots.get(target.id);
  // 내 섬 가운데 가장 가까운 섬에서 출발 (내 섬을 눌렀으면 그 섬으로 바로)
  const near = myIsles().filter(m => m.id !== target.id).map(m => route(layout.slots.get(m.id), end)).filter(p => p.length).sort((a, b) => a.length - b.length)[0];
  const start = near?.[0];
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
function dialog(title){ const d = $('modal'); d.classList.remove('wide'); d.replaceChildren(el('h2', title)); if (!d.open) d.showModal(); return d; }
const titleOf = id => data().find(r => r.id === id)?.title || '사라진 섬';
function bridgeItem(v, note){ const box = el('div'); box.className = 'bridge-item'; box.append(el('small', note), el('b', v.title), el('p', v.body)); return box; }
function detail(r){
  const d = dialog(r.title);
  d.append(el('p', r.body));
  const all = data().filter(v => v.kind === '다리'), s = layout.slots.get(r.id);
  const incoming = all.filter(v => v.to === r.id), outgoing = all.filter(v => v.from === r.id);
  const through = all.filter(v => v.from !== r.id && v.to !== r.id && route(layout.slots.get(v.from), layout.slots.get(v.to)).slice(1, -1).includes(s));
  if (incoming.length || outgoing.length || through.length) d.append(el('h3', '이 섬에 닿은 다리'));
  incoming.forEach(v => d.append(bridgeItem(v, titleOf(v.from) + '에서 건너온 다리')));
  outgoing.forEach(v => d.append(bridgeItem(v, titleOf(v.to) + '(으)로 놓은 다리')));
  through.forEach(v => d.append(bridgeItem(v, titleOf(v.from) + ' → ' + titleOf(v.to) + ' 다리가 이 섬을 지나가요')));
  if (!incoming.length && !through.length){ const p = el('p', '아직 이 섬에 닿은 다리가 없어요.'); p.className = 'muted'; d.append(p); }
  const row = el('div'); row.className = 'actions';
  const starts = demo || HOST ? [] : startsFor(r);
  if (starts.length) row.append(button('다리 놓기', () => editor(null, r, starts), 'primary'));
  else if (!demo && !HOST && !myIsles().length) row.append(button('내 섬 먼저 만들기', () => { d.close(); view('intro'); }, 'primary'));
  row.append(button('닫기', () => d.close())); d.append(row);
}
function editor(r, target, starts = []){
  const d = dialog(r ? (r.kind === '섬' ? '섬 수정' : '다리 수정') : '다리 놓기'), form = el('form'), fields = {};
  let from = starts[0]?.id;
  if (!r && target && starts.length){
    const p = el('p'); p.className = 'route';
    const show = () => { p.textContent = route(layout.slots.get(from), layout.slots.get(target.id)).map(s => layout.bySlot.get(s)?.title || '징검돌').join(' → ') + ' 으로 이어져요.'; };
    // 내 섬이 여럿이면 어느 섬에서 출발할지 고른다
    if (starts.length > 1){
      const l = el('label', '어느 내 섬에서 출발할까요?'), pick = el('div'); pick.className = 'choices';
      for (const m of starts){
        const b = button(m.title, () => { from = m.id; pick.querySelectorAll('button').forEach(x => x.classList.toggle('selected', x === b)); show(); });
        if (m.id === from) b.classList.add('selected'); pick.append(b);
      }
      l.append(pick); form.append(l);
    }
    show(); d.append(p);
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
    save({action: r ? 'edit' : 'create', kind: r?.kind || '다리', id: r?.id, from: r ? undefined : from, to: target?.id, title: fields.title.value.trim(), body: fields.body.value.trim()}, r ? 'mine' : 'board'); };
  d.append(form);
}

/* ---------- 내 이야기 수정 ---------- */
function list(){
  const box = $('mylist'); box.replaceChildren();
  const n = myIsles().length; $('addisle').disabled = n >= PER; $('addisle').textContent = `섬 만들기 ${n}/${PER}`;
  // 섬마다 그 섬에서 놓은 내 다리를 바로 아래에
  const order = [];
  for (const i of myIsles()){ order.push(i); order.push(...rows.filter(v => v.mine && v.kind === '다리' && v.from === i.id)); }
  order.push(...rows.filter(v => v.mine && !order.includes(v)));
  for (const r of order){
    const card = el('article'); card.className = 'story';
    const head = el('div'); head.className = 'story-head';
    const kind = el('span', r.kind); kind.className = 'tag';
    head.append(kind, el('b', r.title)); card.append(head);
    if (r.kind === '다리'){ card.classList.add('sub'); const s = el('small', titleOf(r.from) + ' → ' + titleOf(r.to)); card.append(s); }
    card.append(el('p', r.body));
    const row = el('div'); row.className = 'actions';
    row.append(button('수정', () => editor(r)), button('삭제', async () => {
      const msg = r.kind === '섬' ? '정말 삭제하시겠습니까? 섬이 사라지고, 이 섬에 닿은 다리도 모두 함께 사라져요.' : '정말 이 다리를 삭제하시겠습니까?';
      if (await ask(msg, '삭제하기')) save({action:'delete', id:r.id}, 'mine');
    }, 'danger'));
    card.append(row); box.append(card);
  }
  if (!box.children.length){ const p = el('p', '아직 만든 섬이 없어요.'); p.className = 'muted'; box.append(p); }
}
function setupAvatars(){
  const box = $('avatars'); box.replaceChildren();
  for (let i = 0; i < 20; i++){
    const b = button('', () => { avatar = i; store.islandAvatar = i; box.querySelectorAll('.avatar').forEach((x, j) => { x.classList.toggle('selected', j === i); x.setAttribute('aria-pressed', j === i); }); });
    b.className = 'avatar' + (i === avatar ? ' selected' : ''); b.setAttribute('aria-label', '캐릭터 ' + (i + 1)); b.setAttribute('aria-pressed', i === avatar);
    const img = el('img'); img.src = 'assets/characters/' + String(i + 1).padStart(2, '0') + '.png'; img.alt = ''; b.append(img); box.append(b);
  }
}

/* ---------- 연결 ---------- */
$('entry').onsubmit = e => {
  e.preventDefault(); const f = e.target, slot = freeSlot();
  if (myIsles().length >= PER){ tell('섬은 한 사람당 ' + PER + '개까지 만들 수 있어요.', 4000); return; }
  if (slot === undefined){ tell('바다가 가득 찼어요. 섬은 ' + MAX + '개까지 만들 수 있어요.', 4000); return; }
  save({action:'create', kind:'섬', slot, title: f.elements.title.value.trim(), body: f.elements.body.value.trim()}, 'board');
};
$('mapbtn').onclick = () => { demo = false; view('board'); };
$('sample').onclick = () => { demo = true; view('board'); };
$('newbtn').onclick = () => { demo = false; view(myIsles().length ? 'board' : 'intro'); };
$('addisle').onclick = () => view('intro');
$('introback').onclick = () => view('board');
$('listbtn').onclick = () => view('mine');
$('backbtn').onclick = () => view('board');
$('csv').onclick = () => {
  const field = v => { let s = String(v ?? ''); if (/^[=+@\-\t\r]/.test(s)) s = "'" + s; return '"' + s.replaceAll('"', '""') + '"'; };
  const lay = assignSlots(rows), name = id => rows.find(r => r.id === id)?.title || '';
  const via = r => r.kind === '다리' ? route(lay.slots.get(r.from), lay.slots.get(r.to), lay.bySlot).map(s => lay.bySlot.get(s)?.title || '징검돌').join(' → ') : '';
  const lines = [['속성','제목','내용','출발 섬','도착 섬','지나가는 길'], ...rows.map(r => [r.kind, r.title, r.body, name(r.from), name(r.to), via(r)])];
  const url = URL.createObjectURL(new Blob(['﻿' + lines.map(row => row.map(field).join(',')).join('\r\n')], {type:'text/csv;charset=utf-8'}));
  const a = el('a'); a.href = url; a.download = '섬과다리.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(url), 2000);
};
if (HOST){ document.body.classList.add('host'); $('hostbar').hidden = false; }
$('hostcsv').onclick = () => $('csv').click();
// 진행자 코드: 한 번 맞게 넣으면 이 기기가 기억한다
function askAdmin(title, action){
  const d = dialog(title), form = el('form'), input = el('input');
  input.type = 'password'; input.inputMode = 'numeric'; input.autocomplete = 'off'; input.required = true;
  const l = el('label', '진행자 코드를 입력해 주세요'); l.append(input); form.append(l);
  const row = el('div'); row.className = 'actions'; const go = el('button', '확인'); go.className = 'primary';
  row.append(go, button('취소', () => d.close())); form.append(row); d.append(form); input.focus();
  form.onsubmit = async e => { e.preventDefault(); const admin = input.value.trim(); if (await action(admin)) store.islandAdmin = admin; };
}
async function adminRun(p, then){
  const run = async admin => { const ok = await save({...p, admin}, 'board'); if (ok) then?.(); return ok; };
  if (store.islandAdmin && await run(store.islandAdmin)) return;
  if (store.islandAdmin) store.removeItem('islandAdmin');
  askAdmin('진행자 코드', run);
}
// 진행자: 기록 확인하기 (표로 보고 한 줄씩 지우기)
function records(){
  const d = dialog('기록 확인하기'); d.classList.add('wide');
  const list = rows;
  if (!list.length){ const p = el('p', '아직 기록이 없어요.'); p.className = 'muted'; d.append(p); }
  else {
    const wrap = el('div'); wrap.className = 'table-wrap'; const t = el('table'), head = el('tr');
    ['', '속성', '제목', '내용', '연결'].forEach(h => head.append(el('th', h))); t.append(head);
    for (const r of list){
      const tr = el('tr');
      const td = el('td'); tr.append(td);
      tr.append(el('td', r.kind), el('td', r.title), el('td', r.body), el('td', r.kind === '섬' ? '' : titleOf(r.from) + ' → ' + titleOf(r.to)));
      td.append(button('삭제', async () => {
        const msg = r.kind === '섬' ? `「${r.title}」을 지울까요? 이 섬에 닿은 다리도 함께 지워져요.` : `「${r.title}」을 지울까요?`;
        if (await ask(msg, '삭제하기')) adminRun({action: 'adminDelete', id: r.id}, () => { tell('지웠어요.'); records(); });
      }, 'danger')); t.append(tr);
    }
    wrap.append(t); d.append(wrap);
  }
  const row = el('div'); row.className = 'actions'; row.append(button('닫기', () => { d.close(); d.classList.remove('wide'); })); d.append(row);
}
$('records').onclick = records;
// 진행자: 전체 리셋 (진행자 코드 필요, 지운 기록은 시트의 보관 탭에 남는다)
$('reset').onclick = async () => {
  if (!(await ask('정말 전체 리셋할까요? 바다의 모든 섬과 다리가 사라져요. 지금까지의 기록은 시트의 보관 탭과 내려받기시트에 남아요.', '리셋하기'))) return;
  adminRun({action: 'reset'}, () => tell('바다를 새로 열었어요.'));
};
if (!live){ const note = el('p', '체험판 · 이 기기에만 저장됩니다.'); note.className = 'note'; $('intro').prepend(note); }
setupAvatars();
if (live){ $('intro').hidden = true; tell('바다를 불러오는 중…', 8000); }
sync(true);
if (live) setInterval(() => { if (!document.hidden) sync(); }, HOST ? 4000 : 6000);
// 다른 앱에 갔다 돌아오면(휴대폰) 기다리지 않고 바로 새로 읽는다
if (live) document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
$('saving').oncancel = e => e.preventDefault(); // 저장 중에는 뒤로가기/ESC로 닫히지 않게
let resizeTimer; window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { if (!$('board').hidden && !walking) draw(); }, 150); });
