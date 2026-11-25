/**
 * 섬과 다리 — Google Apps Script 서버
 * 스프레드시트 하나를 DB로 씁니다. 설치 방법은 README.md를 보세요.
 */
const EVENT_CODE = '';          // config.js의 EVENT_CODE와 같은 값. 비워 두면 검사하지 않음
const SHEET_ID = '';          // 스프레드시트 주소의 /d/와 /edit 사이 값. 비워 두면 스크립트가 붙은 시트를 씀
const MAX_ISLANDS = 20;
const COLS = 5, ROWS = 4;
const HEAD = ['id','kind','type','slot','title','body','from','to','owner','sunk','created','updated'];

function sheet_(){
  const ss = SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName('rows');
  if (!sh){ sh = ss.insertSheet('rows'); sh.appendRow(HEAD); sh.setFrozenRows(1); }
  return sh;
}
function all_(){
  const values = sheet_().getDataRange().getValues(); values.shift();
  return values.map((v, n) => ({...Object.fromEntries(HEAD.map((h, i) => [h, v[i]])), _row: n + 2})).filter(r => r.id);
}
function owner_(key){
  const props = PropertiesService.getScriptProperties();
  let salt = props.getProperty('SALT'); if (!salt){ salt = Utilities.getUuid(); props.setProperty('SALT', salt); }
  return Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + String(key))).slice(0, 22);
}
function view_(rows, me){
  return rows.map(r => ({id: r.id, kind: r.kind, type: r.type, slot: r.slot === '' ? undefined : Number(r.slot), title: r.title, body: r.body,
    from: r.from || undefined, to: r.to || undefined, sunk: r.sunk === true || r.sunk === 'TRUE', mine: r.owner === me}));
}
const json_ = o => ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
const clean_ = (s, max) => String(s || '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max);
// 가운데부터 채우는 순서 (app.js의 FILL과 같음)
const FILL_ = Array.from({length: COLS * ROWS}, (_, i) => i).sort((a, b) => {
  const d = s => Math.abs(s % COLS - 2) + Math.abs(Math.floor(s / COLS) - 1.5) * 1.1;
  return d(a) - d(b) || a - b;
});

function doGet(){ return json_({ok: true, hint: 'POST로 요청하세요.'}); }

function doPost(e){
  let p; try { p = JSON.parse(e.postData.contents); } catch(err){ return json_({error: '요청을 읽지 못했어요.'}); }
  if (EVENT_CODE && p.code !== EVENT_CODE) return json_({error: '행사 코드가 맞지 않아요.'});
  if (!p.key || String(p.key).length < 16) return json_({error: '기기 정보를 확인할 수 없어요.'});
  const me = owner_(p.key);
  if (p.action === 'read') return json_({rows: view_(all_(), me)});

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return json_({error: '잠시 후 다시 시도해 주세요.'});
  try {
    const sh = sheet_(), rows = all_(), now = new Date();
    const mineIsland = rows.find(r => r.owner === me && r.kind === '섬' && !(r.sunk === true || r.sunk === 'TRUE'));
    const title = clean_(p.title, 24), body = clean_(p.body, 240);

    if (p.action === 'create'){
      if (!title || !body) return json_({error: '제목과 내용을 적어 주세요.'});
      if (p.kind === '섬'){
        if (mineIsland) return json_({error: '이 기기에서는 이미 섬을 만들었어요.'});
        const used = new Set(rows.filter(r => r.kind === '섬').map(r => Number(r.slot)));
        if (used.size >= MAX_ISLANDS) return json_({error: '바다가 가득 찼어요.'});
        let slot = Number(p.slot); if (!(slot >= 0 && slot < MAX_ISLANDS) || used.has(slot)) slot = FILL_.find(s => !used.has(s));
        sh.appendRow([Utilities.getUuid(), '섬', p.type === '장벽' ? '장벽' : '생각', slot, title, body, '', '', me, false, now, now]);
      } else if (p.kind === '다리'){
        if (!mineIsland) return json_({error: '내 섬을 먼저 만들어 주세요.'});
        const target = rows.find(r => r.id === p.to && r.kind === '섬' && !(r.sunk === true || r.sunk === 'TRUE'));
        if (!target || target.owner === me) return json_({error: '다리를 놓을 섬을 찾지 못했어요.'});
        if (rows.some(r => r.kind === '다리' && r.from === mineIsland.id && r.to === target.id)) return json_({error: '이미 이 섬에 다리를 놓았어요.'});
        sh.appendRow([Utilities.getUuid(), '다리', '', '', title, body, mineIsland.id, target.id, me, false, now, now]);
      } else return json_({error: '알 수 없는 요청이에요.'});
    }
    else if (p.action === 'edit' || p.action === 'delete'){
      const i = rows.findIndex(r => r.id === p.id);
      if (i < 0 || rows[i].owner !== me) return json_({error: '내가 쓴 글만 고칠 수 있어요.'});
      const rowNo = rows[i]._row, col = h => HEAD.indexOf(h) + 1;
      if (p.action === 'edit'){
        if (!title || !body) return json_({error: '제목과 내용을 적어 주세요.'});
        sh.getRange(rowNo, col('title'), 1, 2).setValues([[title, body]]);
        sh.getRange(rowNo, col('updated')).setValue(now);
      } else if (rows[i].kind === '섬'){
        // 섬은 지우지 않고 가라앉힌다: 다른 사람이 놓은 다리를 지키기 위해
        sh.getRange(rowNo, col('title'), 1, 2).setValues([['가라앉은 섬', '']]);
        sh.getRange(rowNo, col('sunk')).setValue(true);
        sh.getRange(rowNo, col('updated')).setValue(now);
      } else sh.deleteRow(rowNo);
    }
    else return json_({error: '알 수 없는 요청이에요.'});
    return json_({rows: view_(all_(), me)});
  } finally { lock.releaseLock(); }
}
