// =====================================================================
// app.js : '나의 과제' 화면 동작
// ---------------------------------------------------------------------
// 순서
//   1. 작은 도구들 (날짜, 글자 다루기, 알림)
//   2. 저장 (폰 안의 localStorage)
//   3. 과제 상태 계산 (완료 / 미완료 / 늦게 완료)
//   4. 자정이 지나면 '미완료' 확정
//   5. 우편함 주고받기 (팀 → 앱, 앱 → 팀)
//   6. 붙여넣기·카톡 공유로 과제 넣기
//   7. 화면 그리기
//   8. 버튼 처리
//   9. 시작
// =====================================================================

// ---------------------------------------------------------------------
// 1. 작은 도구들
// ---------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// 날짜를 "2026-11-07" 모양으로 (폰의 시간대 기준이라 한국이면 한국 자정 기준이에요)
function ymd(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const today = () => ymd(new Date());
function shiftDate(s, days) {
  const [y, m, d] = s.split("-").map(Number);
  return ymd(new Date(y, m - 1, d + days));
}
function dateLabel(s) {
  const [y, m, d] = s.split("-").map(Number);
  const w = "일월화수목금토"[new Date(y, m - 1, d).getDay()];
  const t = today();
  const head = s === t ? "오늘 · " : s === shiftDate(t, -1) ? "어제 · " : "";
  return `${head}${m}월 ${d}일 (${w})`;
}

let toastTimer;
function toast(msg) {
  const el = $("toast");
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2400);
}

// 팀 목록. 우편함 파일의 "team" 칸에는 아래 영어 이름(civil, philo)을 써요.
const TEAMS = {
  brief: { name: "일정·브리핑팀", label: "아침 브리핑" },
  civil: { name: "공무원학습팀", label: "산업기사 문제" },
  philo: { name: "철학·서적팀", label: "습관 임무" },
  etc:   { name: "기타", label: "기타 과제" },
};
// 팀 이름이 한글로 와도 알아듣게 바꿔요
function teamKey(t) {
  const s = String(t || "").toLowerCase();
  if (s === "brief" || s.includes("브리핑") || s.includes("매니저") || s.includes("일정")) return "brief";
  if (s === "civil" || s.includes("공무원")) return "civil";
  if (s === "philo" || s.includes("철학") || s.includes("서적")) return "philo";
  return "etc";
}

// ---------------------------------------------------------------------
// 2. 저장 : 폰 브라우저 안의 저장 공간(localStorage)에 글자로 저장해요.
//    밥 앱과 같은 주소(github.io)를 쓰지만, 저장 칸 이름이 달라서 절대 섞이지 않아요.
//    저장 모양:
//    { tasks:   {과제id: {id, date, team, title, origin, items:[문항...]}},
//      reports: {보고id: {id, date, team, title, body, read}},
//      inboxSeen: {우편함 파일 이름: 지문(sha)},   ← 이미 받은 파일인지 확인용
//      dirty:   {날짜: true} }                       ← 우편함에 아직 못 보낸 날짜
//    우편함 설정(저장소 이름, 열쇠)은 따로 SETTINGS_KEY 칸에 둬요. 백업 파일에는 열쇠를 넣지 않아요.
// ---------------------------------------------------------------------
const STORE_KEY = "my-tasks.v1";
const SETTINGS_KEY = "my-tasks.settings";
const DEFAULT_REPO = "kimgimky-prog/my-tasks-data";
let data, cfg;

function loadData() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(STORE_KEY)); } catch {}
  data = {
    tasks: saved?.tasks || {},
    reports: saved?.reports || {},
    inboxSeen: saved?.inboxSeen || {},
    dirty: saved?.dirty || {},
    lastSync: saved?.lastSync || null,
  };
  let s = null;
  try { s = JSON.parse(localStorage.getItem(SETTINGS_KEY)); } catch {}
  cfg = { repo: s?.repo || DEFAULT_REPO, token: s?.token || "" };
}
function saveData() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(data)); }
  catch { toast("폰에 저장하지 못했어요. 저장 공간을 확인해 주세요."); }
}
function saveCfg() {
  try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(cfg)); } catch {}
}

// ---------------------------------------------------------------------
// 3. 과제 상태 계산
// ---------------------------------------------------------------------
// 문항 하나의 상태
//   done=true            → "완료" (자정이 지난 뒤에 했으면 "늦게 완료")
//   missed=true, 안 함    → "미완료" (자정까지 답이 없었음)
//   그 밖                 → "할 차례"
function status(it) {
  if (it.done) return it.late ? "늦게 완료" : "완료";
  if (it.missed) return "미완료";
  return "할 차례";
}
const STATUS_CLASS = { "완료": "ok", "늦게 완료": "late", "미완료": "miss", "할 차례": "todo" };

const tasksOn = (date) => Object.values(data.tasks).filter((t) => t.date === date);
function countOn(date) {
  const items = tasksOn(date).flatMap((t) => t.items);
  return {
    total: items.length,
    done: items.filter((i) => i.done).length,
    missed: items.filter((i) => i.missed && !i.done).length,
  };
}

// 연속 달성일: 과제가 있던 날마다 '자정 안에 전부 완료'했는지 거꾸로 세어요.
// 과제가 없던 날은 건너뛰고, 오늘은 아직 안 끝났으면 세지도 끊지도 않아요.
function streak() {
  const dates = [...new Set(Object.values(data.tasks).map((t) => t.date))].sort().reverse();
  const t = today();
  let n = 0;
  for (const d of dates) {
    if (d > t) continue;
    const items = tasksOn(d).flatMap((x) => x.items);
    if (!items.length) continue;
    const allOnTime = items.every((i) => i.done && !i.late);
    if (d === t && !allOnTime) continue;
    if (allOnTime) n++; else break;
  }
  return n;
}

// 정답 비교: "③", "3", "3번"을 모두 같은 답으로 봐요. 보기 번호가 아니면 비교하지 않고 KY가 직접 표시해요.
const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩";
function choiceNo(s) {
  const str = String(s || "").trim();
  const c = [...str].find((ch) => CIRCLED.includes(ch));
  if (c) return CIRCLED.indexOf(c) + 1;
  const m = str.match(/^\(?([1-9]|10)\)?\s*번?\.?$/);
  return m ? Number(m[1]) : null;
}
function judge(it) {
  const a = choiceNo(it.answer), b = choiceNo(it.my);
  return a && b ? a === b : null;
}

// ---------------------------------------------------------------------
// 4. 자정이 지나면 '미완료' 확정
// ---------------------------------------------------------------------
// 웹앱은 꺼져 있을 때 혼자 돌 수 없어서, 앱을 열 때와 1분마다 날짜를 확인해요.
// 오늘보다 이전 날짜인데 답이 없는 문항은 '미완료'로 바꾸고, 그 날짜를 우편함에 보낼 목록(dirty)에 넣어요.
function finalizePastDays() {
  const t = today();
  let changed = false;
  for (const task of Object.values(data.tasks)) {
    if (task.date >= t) continue;
    for (const it of task.items) {
      if (!it.done && !it.missed) { it.missed = true; data.dirty[task.date] = true; changed = true; }
    }
  }
  if (changed) saveData();
  return changed;
}

// ---------------------------------------------------------------------
// 5. 우편함 주고받기
// ---------------------------------------------------------------------
// 우편함 파일(팀이 쓴 JSON) 하나를 앱 안으로 넣어요.
// 같은 파일을 팀이 고쳐서 다시 올리면, 문항 내용은 새로 바꾸되 KY가 쓴 답은 그대로 둬요.
function importInbox(name, text) {
  const o = JSON.parse(text);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(o.date) ? o.date : name.slice(0, 10);
  const team = teamKey(o.team);
  const id = "in:" + name;
  if (o.type === "report") {
    const old = data.reports[id];
    data.reports[id] = { id, date, team, title: o.title || "보고", body: o.body || "", read: old ? old.read && old.body === o.body : false };
    return;
  }
  const old = data.tasks[id];
  const items = (Array.isArray(o.items) ? o.items : []).map((x, i) => {
    const itemId = String(x.id ?? i + 1);
    const prev = old?.items.find((p) => p.id === itemId);
    return {
      ...blankItem(),
      ...(prev || {}),
      id: itemId,
      q: x.question || x.q || "",
      choices: Array.isArray(x.choices) ? x.choices : [],
      answer: x.answer ?? "",
      explain: x.explain || "",
      kind: x.kind || (team === "philo" ? "habit" : "quiz"),
    };
  });
  data.tasks[id] = { id, date, team, title: o.title || TEAMS[team].label, origin: "우편함", items };
  if (date < today()) finalizePastDays();
}
function blankItem() {
  return { my: "", work: "", done: false, doneAt: null, missed: false, late: false, correct: null, reveal: false };
}

// 앱 → 팀: 그날의 결과를 outbox/날짜.json 으로 만들어요 (팀 Claude가 읽는 파일)
function outboxJson(date) {
  const summary = {};
  const items = [];
  for (const task of tasksOn(date)) {
    const tn = TEAMS[task.team].name;
    summary[tn] ||= { total: 0, done: 0, missed: 0 };
    for (const it of task.items) {
      const st = status(it);
      summary[tn].total++;
      if (it.done) summary[tn].done++;
      if (st === "미완료") summary[tn].missed++;
      items.push({
        team: task.team, teamName: tn, title: task.title, source: task.id.startsWith("in:") ? task.id.slice(3) : "붙여넣기",
        itemId: it.id, question: it.q.slice(0, 300), status: st,
        myAnswer: it.my, work: it.work, correctAnswer: it.answer || null, correct: it.correct, doneAt: it.doneAt,
      });
    }
  }
  return JSON.stringify({ date, app: "나의 과제", updatedAt: new Date().toISOString(), finalized: date < today(), summary, items }, null, 2);
}

let syncing = false, syncTimer = null;
function syncSoon() { clearTimeout(syncTimer); syncTimer = setTimeout(sync, 2500); }

async function sync(manual = false) {
  if (!cfg.token) { renderSyncLine(); if (manual) openSettings(); return; }
  if (syncing) return;
  syncing = true; renderSyncLine("우편함 확인 중…");
  try {
    // (1) 팀 → 앱 : 새 파일이나 고쳐진 파일만 받아요
    let got = 0;
    for (const f of await Mailbox.listInbox(cfg)) {
      if (data.inboxSeen[f.name] === f.sha) continue;
      const file = await Mailbox.readFile(cfg, "inbox/" + f.name);
      if (!file) continue;
      try { importInbox(f.name, file.text); got++; }
      catch { console.warn("우편함 파일 모양이 달라서 건너뜀:", f.name); }
      data.inboxSeen[f.name] = f.sha;
    }
    // (2) 앱 → 팀 : 바뀐 날짜의 결과를 보내요
    finalizePastDays();
    for (const date of Object.keys(data.dirty)) {
      await Mailbox.writeFile(cfg, `outbox/${date}.json`, outboxJson(date), `나의 과제: ${date} 결과`);
      delete data.dirty[date];
    }
    data.lastSync = new Date().toISOString();
    saveData();
    render();
    if (got) toast(`새 과제·보고 ${got}개를 받았어요.`);
    else if (manual) toast("우편함 확인 완료");
  } catch (e) {
    saveData();
    renderSyncLine("우편함 오류: " + e.message);
    if (manual) toast(e.message);
  } finally {
    syncing = false;
  }
}
// 내 답이 바뀐 날짜를 '보낼 목록'에 넣고 잠시 뒤 보내요
function markDirty(date) { data.dirty[date] = true; saveData(); syncSoon(); }

// ---------------------------------------------------------------------
// 6. 붙여넣기·카톡 공유로 과제 넣기
// ---------------------------------------------------------------------
// 폰에서 복사하면 줄바꿈이 사라지는 일이 있어서(밥 앱에서 겪은 문제), 줄바꿈 없이도 읽게 만들었어요.
//
// 산업기사 문제 예)  "문제 1. 키의 종류 중 … ① 묻힘 키 ② 안장 키 ③ 접선 키 ④ 원뿔 키  정답: ③  해설: …"
//   → "문제 N" 또는 "QN"으로 여러 문제를 나누고, ①~⑩으로 보기를, "정답:"으로 답을, "해설:"로 풀이를 찾아요.
// 습관 임무 예)      "습관 임무: 책 10쪽 읽고 한 줄 쓰기"  → 줄마다 임무 하나
function parsePaste(text, team) {
  const src = String(text || "").replace(/\r/g, "").trim();
  if (!src) return [];
  if (team === "philo") {
    return src.split(/\n+/)
      .map((l) => l.replace(/^\s*[-•·*]\s*/, "").replace(/^(습관\s*임무|임무)\s*[:：]?\s*/, "").trim())
      .filter(Boolean)
      .map((q, i) => ({ ...blankItem(), id: String(i + 1), q, choices: [], answer: "", explain: "", kind: "habit" }));
  }
  let parts = src.split(/(?=(?:^|\s)(?:\[?\s*문제\s*\d+|Q\s*\d+)\s*[.):\]번]?\s)/i).map((p) => p.trim()).filter(Boolean);
  // 맨 앞에 "[산업기사 매일 문제]" 같은 제목만 있는 조각은 문제가 아니라서 빼요
  if (parts.length > 1 && !/^(?:\[?\s*문제\s*\d+|Q\s*\d+)/i.test(parts[0]) && !/[①-⑩?？]|정답/.test(parts[0])) parts.shift();
  if (!parts.length) parts = [src];
  return parts.map((p, i) => {
    const ansAt = p.search(/(?:정답|답)\s*[:：]/);
    const expAt = p.search(/해설\s*[:：]?/);
    const cut = [ansAt, expAt].filter((x) => x >= 0);
    let stem = cut.length ? p.slice(0, Math.min(...cut)) : p;
    let answer = "";
    if (ansAt >= 0) {
      const m = p.slice(ansAt).match(/(?:정답|답)\s*[:：]\s*([①-⑩]|\(?\d{1,2}\)?\s*번?|[^\s,.]+)/);
      answer = m ? m[1].trim() : "";
    }
    const explain = expAt >= 0 ? p.slice(expAt).replace(/^해설\s*[:：]?\s*/, "").trim() : "";
    // 보기 ①②③④ 나누기
    const bits = stem.split(/(?=[①②③④⑤⑥⑦⑧⑨⑩])/);
    const choices = bits.length > 1 ? bits.slice(1).map((c) => c.trim()) : [];
    stem = bits[0].trim();
    return { ...blankItem(), id: String(i + 1), q: stem, choices, answer, explain, kind: "quiz" };
  });
}

// ---------------------------------------------------------------------
// 7. 화면 그리기
// ---------------------------------------------------------------------
let viewDate = today();

function render() {
  const t = today();
  $("dateLabel").textContent = dateLabel(viewDate);
  $("todayBtn").hidden = viewDate === t;
  $("nextDay").disabled = viewDate >= t;

  const c = countOn(viewDate);
  $("sumLabel").textContent = viewDate === t ? "오늘 과제" : "이날 과제";
  $("sumBig").innerHTML = `${c.done}<small>/${c.total}</small>`;
  $("meterBar").style.width = c.total ? `${Math.round((c.done / c.total) * 100)}%` : "0%";
  const s = streak();
  $("streak").innerHTML = s ? `<b>${s}</b>일 연속<br><span>자정 안에 다 함</span>` : `<span>연속 달성<br>아직 없음</span>`;
  renderSyncLine();
  renderReports();
  renderTasks();
}

function renderSyncLine(msg) {
  const el = $("syncLine");
  if (msg) { el.textContent = msg; return; }
  if (!cfg.token) { el.innerHTML = `우편함 연결 전이에요. <button class="link" data-act="settings">⚙ 연결하기</button>`; return; }
  const pend = Object.keys(data.dirty).length;
  const when = data.lastSync ? new Date(data.lastSync).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }) : "아직 안 함";
  // 지난날 미완료가 있으면 알려 줘요
  const missDates = [...new Set(Object.values(data.tasks).filter((x) => x.items.some((i) => i.missed && !i.done)).map((x) => x.date))].sort();
  const miss = missDates.length ? ` · <button class="link" data-goto="${missDates[missDates.length - 1]}">미완료 있는 날 ${missDates.length}일</button>` : "";
  el.innerHTML = `우편함 확인 ${esc(when)}${pend ? ` · 보낼 결과 ${pend}일치 대기` : ""}${miss}`;
}

function renderReports() {
  const list = Object.values(data.reports).filter((r) => r.date === viewDate);
  $("reportsBox").hidden = !list.length;
  $("reports").innerHTML = list.map((r) => `
    <details class="report${r.read ? "" : " unread"}" data-report="${esc(r.id)}">
      <summary><span class="team">${esc(TEAMS[r.team].name)}</span> ${esc(r.title)}${r.read ? "" : ` <span class="dot">새 보고</span>`}</summary>
      <div class="body">${esc(r.body)}</div>
    </details>`).join("");
}

function renderTasks() {
  const list = tasksOn(viewDate);
  if (!list.length) {
    $("tasks").innerHTML = `<div class="empty">이날 과제가 없어요.<br>${cfg.token ? "팀이 우편함에 올리면 여기 떠요. ⟳로 새로고침할 수 있어요." : "아래 ‘+ 과제 붙여넣기’로 넣거나, ⚙에서 우편함을 연결해 주세요."}</div>`;
    return;
  }
  // 팀 순서: 공무원학습팀 → 철학·서적팀 → 기타
  const order = Object.keys(TEAMS);
  list.sort((a, b) => order.indexOf(a.team) - order.indexOf(b.team));
  $("tasks").innerHTML = list.map((task) => `
    <section class="card" data-task="${esc(task.id)}">
      <div class="cardhead">
        <div><span class="team">${esc(TEAMS[task.team].name)}</span><h2>${esc(task.title)}</h2></div>
        <button class="link small" data-act="delTask">지우기</button>
      </div>
      ${task.items.map((it) => itemHtml(task, it)).join("")}
      <p class="origin">${esc(task.origin)}에서 받음</p>
    </section>`).join("");
}

function itemHtml(task, it) {
  const st = status(it);
  const head = `<div class="itemhead"><span class="chip ${STATUS_CLASS[st]}">${st}</span>${task.items.length > 1 ? `<span class="qno">${esc(it.id)}번</span>` : ""}</div>`;
  const q = `<p class="q">${esc(it.q)}</p>${it.choices.length ? `<ol class="choices">${it.choices.map((c) => `<li>${esc(c)}</li>`).join("")}</ol>` : ""}`;
  const key = `data-item="${esc(it.id)}"`;

  // 이미 답한 문항: 내 답 + (퀴즈면) 정답·해설
  if (it.done && !it.editing) {
    let result = "";
    if (it.kind === "quiz") {
      const mark = it.correct === true ? `<span class="chip ok">맞음</span>` : it.correct === false ? `<span class="chip miss">틀림</span>` : "";
      const self = it.correct === null ? `<div class="row"><button class="btn small" data-act="markRight">맞았어요</button><button class="btn small" data-act="markWrong">틀렸어요</button></div>` : "";
      result = it.answer || it.explain
        ? `<div class="answer">${mark}<div>정답: <b>${esc(it.answer || "-")}</b></div>${it.explain ? `<div class="explain">${esc(it.explain)}</div>` : ""}${self}</div>`
        : `<div class="answer muted">정답이 아직 없어요.${self}</div>`;
    }
    return `<div class="item" ${key}>${head}${q}
      <div class="mine"><div class="label">${it.kind === "quiz" ? "내 답" : "내 기록"}</div><div class="mytext">${esc(it.my) || "(빈칸)"}</div>
      ${it.work ? `<div class="label">풀이</div><div class="mytext">${esc(it.work)}</div>` : ""}</div>
      ${result}
      <button class="link small" data-act="edit">고치기</button></div>`;
  }

  // 아직 안 한 문항: 입력 칸
  const form = it.kind === "quiz"
    ? `<label class="label">내 답 <input class="in" data-field="my" value="${esc(it.my)}" placeholder="예: ③" enterkeyhint="done"></label>
       <label class="label">풀이 (선택)<textarea class="in" data-field="work" rows="3" placeholder="어떻게 풀었는지 적어 두면 복습할 때 좋아요">${esc(it.work)}</textarea></label>
       <button class="btn primary" data-act="submit">답 제출</button>`
    : `<label class="label">답변·기록<textarea class="in" data-field="my" rows="3" placeholder="오늘 한 것, 느낀 점">${esc(it.my)}</textarea></label>
       <button class="btn primary" data-act="submit">완료</button>`;
  return `<div class="item" ${key}>${head}${q}<div class="form">${form}</div>
    ${it.missed ? `<p class="hint">자정이 지나 미완료로 기록됐어요. 지금 해도 ‘늦게 완료’로 남아요.</p>` : ""}</div>`;
}

// 아래에서 올라오는 창
function openSheet(html) {
  $("sheet").innerHTML = html;
  $("scrim").hidden = false;
  document.body.classList.add("locked");
}
function closeSheet() {
  $("scrim").hidden = true;
  document.body.classList.remove("locked");
}

function openPaste(prefill = "") {
  const guess = /습관|임무/.test(prefill) ? "philo" : "civil";
  openSheet(`
    <h2>과제 붙여넣기</h2>
    <p class="muted">카톡이나 문서에서 복사한 글을 그대로 붙여넣으세요. 카톡 메시지를 꾹 눌러 ‘공유’ → ‘나의 과제’를 골라도 여기로 와요.</p>
    <div class="seg" id="pasteTeam">
      ${Object.entries(TEAMS).filter(([k]) => k !== "brief").map(([k, v]) => `<button class="${k === guess ? "on" : ""}" data-team="${k}">${v.label}</button>`).join("")}
    </div>
    <textarea class="in" id="pasteText" rows="8" placeholder="여기에 붙여넣기">${esc(prefill)}</textarea>
    <label class="label">날짜 <input class="in" type="date" id="pasteDate" value="${viewDate}" max="${today()}"></label>
    <div id="pastePreview" class="preview"></div>
    <div class="row end"><button class="btn" data-act="close">닫기</button><button class="btn primary" data-act="pasteSave">넣기</button></div>`);
  updatePastePreview();
}
function pasteTeam() { return $("pasteTeam")?.querySelector(".on")?.dataset.team || "civil"; }
function updatePastePreview() {
  const items = parsePaste($("pasteText").value, pasteTeam());
  $("pastePreview").innerHTML = items.length
    ? `<b>${items.length}개</b>로 나눠서 넣어요.` + items.map((it) => `<div class="pv">${esc(it.id)}. ${esc(it.q.slice(0, 60))}${it.q.length > 60 ? "…" : ""}${it.choices.length ? ` · 보기 ${it.choices.length}개` : ""}${it.answer ? ` · 정답 찾음(가려 둠)` : ""}</div>`).join("")
    : "";
}

function openSettings() {
  const has = !!cfg.token;
  openSheet(`
    <h2>설정</h2>
    <h3>우편함 연결</h3>
    <p class="muted">팀이 보낸 과제를 받고, 내 답과 미완료를 팀에 보내는 비공개 저장소예요. 열쇠(토큰)는 이 폰에만 저장돼요.</p>
    <label class="label">저장소 <input class="in" id="cfgRepo" value="${esc(cfg.repo)}" autocapitalize="off" autocomplete="off"></label>
    <label class="label">열쇠(토큰) <input class="in" id="cfgToken" type="password" value="${esc(cfg.token)}" placeholder="github_pat_로 시작" autocapitalize="off" autocomplete="off"></label>
    <div class="row"><button class="btn primary" data-act="cfgSave">${has ? "다시 연결" : "연결하기"}</button>${has ? `<button class="btn" data-act="cfgClear">연결 끊기</button>` : ""}</div>
    <p class="muted small">열쇠 만드는 곳: GitHub → Settings → Developer settings → Fine-grained tokens. 저장소는 my-tasks-data만, 권한은 Contents ‘Read and write’만 주세요.</p>
    <h3>알림</h3>
    <p class="muted">새 과제·보고·브리핑이 오면 폰으로 알려 주고, 밤 22:30에 안 한 과제가 남아 있으면 한 번 더 알려 줘요.</p>
    ${pushSectionHtml()}
    <h3>팀 보고 복사</h3>
    <p class="muted">우편함이 안 될 때, 보고 있는 날의 결과를 한 줄씩 복사해서 붙여넣을 수 있어요.</p>
    <button class="btn" data-act="copyReport">${esc(dateLabel(viewDate))} 결과 복사</button>
    <h3>백업</h3>
    <p class="muted">기록은 이 폰에만 있어요. 가끔 백업 파일을 저장해 두세요. (열쇠는 백업에 들어가지 않아요)</p>
    <div class="row"><button class="btn" data-act="export">백업 파일 저장</button><button class="btn" data-act="import">백업 불러오기</button></div>
    <div class="row end"><button class="btn" data-act="close">닫기</button></div>`);
}

// 팀 보고 한 줄: "2026-11-07 · 공무원학습팀 · 산업기사 문제 2개 중 1개 완료, 1개 미완료"
function reportLines(date) {
  return tasksOn(date).map((task) => {
    const n = task.items.length, d = task.items.filter((i) => i.done).length;
    const m = task.items.filter((i) => i.missed && !i.done).length;
    return `${date} · ${TEAMS[task.team].name} · ${task.title} ${n}개 중 ${d}개 완료${m ? `, ${m}개 미완료` : ""}`;
  }).join("\n");
}

// ---------------------------------------------------------------------
// 8. 버튼 처리 (화면 전체에서 한 곳으로 모아서 처리해요)
// ---------------------------------------------------------------------
function findItem(el) {
  const task = data.tasks[el.closest("[data-task]")?.dataset.task];
  const it = task?.items.find((x) => x.id === el.closest("[data-item]")?.dataset.item);
  return { task, it };
}

document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("button");
  if (!b) {
    // 보고를 펼치면 '읽음'으로
    const sum = ev.target.closest("summary");
    const rep = sum && data.reports[sum.parentElement.dataset.report];
    if (rep && !rep.read) { rep.read = true; saveData(); setTimeout(renderReports, 300); }
    return;
  }
  if (b.dataset.goto) { viewDate = b.dataset.goto; render(); return; }
  if (b.dataset.team) {
    b.parentElement.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    updatePastePreview(); return;
  }
  const act = b.dataset.act;
  const { task, it } = findItem(b);

  if (act === "submit" && it) {
    const box = b.closest(".item");
    it.my = box.querySelector('[data-field="my"]').value.trim();
    const w = box.querySelector('[data-field="work"]');
    if (w) it.work = w.value.trim();
    if (!it.my) { toast("답을 적어 주세요."); return; }
    it.done = true; it.editing = false;
    it.doneAt ||= new Date().toISOString();
    it.late = task.date < today() || it.missed;   // 자정이 지난 뒤에 했으면 '늦게 완료'
    if (it.kind === "quiz") it.correct = judge(it);
    saveData(); markDirty(task.date); render();
    if (it.kind === "quiz" && it.correct !== null) toast(it.correct ? "맞았어요!" : "틀렸어요. 해설을 확인해 보세요.");
  } else if (act === "edit" && it) {
    it.editing = true; it.done = false; render();
  } else if ((act === "markRight" || act === "markWrong") && it) {
    it.correct = act === "markRight"; saveData(); markDirty(task.date); render();
  } else if (act === "delTask" && task) {
    if (!confirm(`‘${task.title}’ 과제를 지울까요? 쓴 답도 함께 지워져요.`)) return;
    delete data.tasks[task.id]; markDirty(task.date); render();
  } else if (act === "pasteSave") {
    const team = pasteTeam();
    const items = parsePaste($("pasteText").value, team);
    if (!items.length) { toast("붙여넣은 글이 없어요."); return; }
    const date = $("pasteDate").value || today();
    const id = "p:" + newId();
    data.tasks[id] = { id, date, team, title: TEAMS[team].label, origin: "붙여넣기", items };
    finalizePastDays();
    viewDate = date; saveData(); markDirty(date); closeSheet(); render();
    toast(`${items.length}개를 넣었어요.`);
  } else if (act === "cfgSave") {
    cfg.repo = $("cfgRepo").value.trim() || DEFAULT_REPO;
    cfg.token = $("cfgToken").value.trim();
    if (!cfg.token) { toast("열쇠를 넣어 주세요."); return; }
    b.disabled = true; b.textContent = "확인 중…";
    try {
      await Mailbox.test(cfg);
      saveCfg(); closeSheet(); toast("우편함에 연결했어요.");
      // 연결 전에 한 기록도 보내도록 전부 '보낼 목록'에 넣어요
      for (const t of Object.values(data.tasks)) data.dirty[t.date] = true;
      saveData(); sync(true);
    } catch (e) {
      b.disabled = false; b.textContent = "연결하기"; toast(e.message);
    }
  } else if (act === "pushPrep") {
    if (!cfg.token) { toast("먼저 위에서 우편함을 연결해 주세요."); return; }
    await makePushKeys(); openSettings();
  } else if (act === "copyPriv") {
    try { await navigator.clipboard.writeText(cfg.vapidPriv); toast("복사했어요. GitHub 비밀값에 붙여넣으세요."); }
    catch { $("vapidPriv").select(); toast("칸을 길게 눌러 복사해 주세요."); }
  } else if (act === "pushOn") {
    b.disabled = true; b.textContent = "켜는 중…";
    try { await enablePush(); openSettings(); toast("알림을 켰어요. 1~2분 안에 시험 알림이 와요."); }
    catch (e) { b.disabled = false; b.textContent = "비밀값 넣었어요 → 알림 켜기"; toast(e.message); }
  } else if (act === "cfgClear") {
    cfg.token = ""; saveCfg(); closeSheet(); render(); toast("연결을 끊었어요. 열쇠를 폰에서 지웠어요.");
  } else if (act === "copyReport") {
    const text = reportLines(viewDate);
    if (!text) { toast("이날 과제가 없어요."); return; }
    try { await navigator.clipboard.writeText(text); toast("복사했어요. 원하는 곳에 붙여넣으세요."); }
    catch { prompt("아래 글을 길게 눌러 복사하세요", text); }
  } else if (act === "export") {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `나의과제-백업-${today()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } else if (act === "import") {
    $("importInput").click();
  } else if (act === "settings") {
    openSettings();
  } else if (act === "close") {
    closeSheet();
  }
});

document.addEventListener("input", (ev) => {
  if (ev.target.id === "pasteText") updatePastePreview();
});
$("scrim").addEventListener("click", (ev) => { if (ev.target === $("scrim")) closeSheet(); });
$("prevDay").onclick = () => { viewDate = shiftDate(viewDate, -1); render(); };
$("nextDay").onclick = () => { if (viewDate < today()) { viewDate = shiftDate(viewDate, 1); render(); } };
$("todayBtn").onclick = () => { viewDate = today(); render(); };
$("syncBtn").onclick = () => sync(true);
$("settingsBtn").onclick = openSettings;
$("fab").onclick = () => openPaste();

$("importInput").addEventListener("change", async (ev) => {
  const file = ev.target.files?.[0];
  ev.target.value = "";
  if (!file) return;
  try {
    const d = JSON.parse(await file.text());
    if (!d || typeof d.tasks !== "object") throw new Error();
    if (!confirm("지금 폰에 있는 기록을 백업 파일 내용으로 바꿀까요?")) return;
    localStorage.setItem(STORE_KEY, JSON.stringify(d));
    loadData(); closeSheet(); render(); toast("백업을 불러왔어요.");
  } catch { toast("나의 과제 백업 파일이 아니에요."); }
});

// ---------------------------------------------------------------------
// 8-1. 폰 알림 (웹 푸시)
// ---------------------------------------------------------------------
// 원리: ① 앱이 이 폰 안에서 '보내는 사람 열쇠' 한 쌍(공개·비밀)을 만들어요.
//       ② KY가 비밀 열쇠를 우편함 저장소의 Actions 비밀값(VAPID_PRIVATE_KEY)에 붙여넣어요. (코드·우편함 파일에는 안 넣어요)
//       ③ 폰(크롬)이 '알림 받을 주소'를 만들고, 앱이 그 주소와 공개 열쇠를 우편함 devices/ 폴더에 적어요.
//       ④ 팀이 우편함에 과제를 올리면 GitHub가 자동으로 그 주소로 알림을 보내요(우편함 저장소의 .github 폴더).
function pushStateText() {
  if (!("Notification" in window) || !("PushManager" in window)) return "이 브라우저는 알림을 지원하지 않아요. 설치한 앱에서 열어 주세요.";
  if (Notification.permission === "denied") return "알림이 막혀 있어요. 폰 설정 → 애플리케이션 → 나의 과제 → 알림에서 허용해 주세요.";
  if (cfg.deviceId && cfg.vapidPub && Notification.permission === "granted") return "알림 켜짐 ✓";
  return "알림 꺼짐";
}
const bytesToB64url = (u8) => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
function b64urlToBytes(s) {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob((s + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}
// ① 열쇠 한 쌍 만들기 (웹 브라우저에 들어 있는 암호 기능을 써요)
async function makePushKeys() {
  const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  cfg.vapidPub = bytesToB64url(pub);
  cfg.vapidPriv = jwk.d;          // 비밀 열쇠: 알림을 켜고 나면 폰에서도 지워요
  cfg.deviceId = "";
  saveCfg();
}
// ③ 알림 켜기: 허용 받기 → 알림 받을 주소 만들기 → 우편함에 적기
async function enablePush() {
  if (!cfg.token) throw new Error("먼저 위에서 우편함을 연결해 주세요.");
  if (!cfg.vapidPub) throw new Error("먼저 ‘알림 준비하기’를 눌러 주세요.");
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) throw new Error("이 브라우저는 알림을 지원하지 않아요.");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("알림을 허용해야 켤 수 있어요.");
  const reg = await navigator.serviceWorker.ready;
  const old = await reg.pushManager.getSubscription();
  if (old) await old.unsubscribe();   // 예전 열쇠로 만든 주소는 버리고 새로 만들어요
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToBytes(cfg.vapidPub) });
  cfg.deviceId ||= "phone-" + newId();
  await Mailbox.writeFile(cfg, `devices/${cfg.deviceId}.json`,
    JSON.stringify({ ...sub.toJSON(), vapidPublicKey: cfg.vapidPub, addedAt: new Date().toISOString() }, null, 2),
    "나의 과제: 알림 받을 기기 등록");
  delete cfg.vapidPriv;
  saveCfg();
}
function pushSectionHtml() {
  if (cfg.vapidPriv) {
    return `<p class="muted small"><b>1.</b> 아래 비밀 열쇠를 복사하세요.</p>
      <textarea class="in" id="vapidPriv" rows="2" readonly>${esc(cfg.vapidPriv)}</textarea>
      <div class="row"><button class="btn small" data-act="copyPriv">비밀 열쇠 복사</button></div>
      <p class="muted small"><b>2.</b> 크롬에서 <b>github.com/kimgimky-prog/my-tasks-data/settings/secrets/actions/new</b> 열기 → Name에 <b>VAPID_PRIVATE_KEY</b> → Secret에 붙여넣기 → Add secret</p>
      <p class="muted small"><b>3.</b> 돌아와서 아래 버튼을 누르면 시험 알림이 와요. (비밀 열쇠는 그때 이 폰에서도 지워져요)</p>
      <div class="row"><button class="btn primary" data-act="pushOn">비밀값 넣었어요 → 알림 켜기</button></div>`;
  }
  return `<p class="muted small" id="pushState">${pushStateText()}</p>
    <div class="row"><button class="btn" data-act="pushPrep">${cfg.deviceId ? "알림 처음부터 다시 설정" : "알림 준비하기"}</button></div>`;
}

// ---------------------------------------------------------------------
// 9. 시작
// ---------------------------------------------------------------------
loadData();
finalizePastDays();
render();

// 카톡에서 '공유'로 들어왔으면 붙여넣기 창을 바로 열어요 (manifest의 share_target)
{
  const p = new URLSearchParams(location.search);
  const shared = [p.get("share_title"), p.get("share_text"), p.get("share_url")].filter(Boolean).join("\n");
  if (shared) { history.replaceState(null, "", location.pathname); openPaste(shared); }
}

sync();
// 1분마다 날짜를 확인해서, 자정이 지나면 미완료를 확정하고 화면을 오늘로 넘겨요
let lastDay = today();
setInterval(() => {
  const t = today();
  if (t !== lastDay) {
    if (viewDate === lastDay) viewDate = t;
    lastDay = t;
    if (finalizePastDays()) syncSoon();
    render();
  }
}, 60 * 1000);
// 앱을 다시 화면에 띄울 때마다 우편함 확인
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") { if (finalizePastDays()) render(); sync(); }
});

if ("serviceWorker" in navigator && location.protocol === "https:") {
  navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).catch(() => {});
  navigator.storage?.persist?.().catch(() => {});   // 폰이 기록을 함부로 지우지 않게 요청
}
