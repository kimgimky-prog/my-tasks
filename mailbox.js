// =====================================================================
// mailbox.js : 비공개 '우편함' 저장소(GitHub)와 주고받는 부분
// ---------------------------------------------------------------------
// 우편함 = KY 계정의 비공개 저장소 (기본: kimgimky-prog/my-tasks-data)
//   inbox/   : 팀 Claude가 과제·보고를 올리는 곳 (팀 → 앱)
//   outbox/  : 앱이 내 답과 '미완료'를 적는 곳 (앱 → 팀)
// 파일 모양은 우편함 저장소의 README.md에 적혀 있어요.
//
// GitHub에는 'API'라는 창구가 있어서, 열쇠(토큰)를 보여 주면 파일을 읽고 쓸 수 있어요.
// 열쇠는 이 폰의 저장 공간에만 두고, 코드나 저장소에는 절대 넣지 않아요.
// =====================================================================

const Mailbox = (() => {
  const API = "https://api.github.com";

  // 글자(한글 포함) ↔ base64 바꾸기. GitHub은 파일 내용을 base64라는 모양으로 주고받아요.
  function toB64(str) {
    const bytes = new TextEncoder().encode(str);
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function fromB64(b64) {
    const bin = atob(b64.replace(/\s/g, ""));
    return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
  }

  // GitHub API에 한 번 요청하기
  async function call(cfg, path, opts = {}) {
    const res = await fetch(`${API}/repos/${cfg.repo}/contents/${path}`, {
      ...opts,
      cache: "no-store",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${cfg.token}`,
        ...(opts.body ? { "Content-Type": "application/json" } : {}),
      },
    });
    if (res.status === 404) return null;                 // 파일이나 폴더가 아직 없음
    if (res.status === 401) throw new Error("열쇠(토큰)가 틀렸거나 기간이 끝났어요.");
    if (res.status === 403) throw new Error("열쇠에 이 저장소 권한이 없어요.");
    if (!res.ok) throw new Error(`우편함 오류 (${res.status})`);
    return res.json();
  }

  // 연결 확인: 저장소 맨 위 폴더를 읽어 봐요
  async function test(cfg) {
    const r = await call(cfg, "");
    if (!r) throw new Error("저장소를 못 찾았어요. 이름을 확인해 주세요.");
    return true;
  }

  // inbox 폴더의 파일 목록 → [{name, sha}]
  async function listInbox(cfg) {
    const list = await call(cfg, "inbox");
    if (!Array.isArray(list)) return [];
    return list.filter((f) => f.type === "file" && f.name.endsWith(".json")).map((f) => ({ name: f.name, sha: f.sha }));
  }

  // 파일 하나 읽기 → 글자
  async function readFile(cfg, path) {
    const f = await call(cfg, path);
    if (!f || !f.content) return null;
    return { text: fromB64(f.content), sha: f.sha };
  }

  // 파일 쓰기 (없으면 새로 만들고, 있으면 고쳐요)
  // 고칠 때는 지금 파일의 sha(지문)를 같이 보내야 해서, 먼저 한 번 읽어요.
  async function writeFile(cfg, path, text, message) {
    const now = await call(cfg, path);
    const body = { message, content: toB64(text) };
    if (now && now.sha) body.sha = now.sha;
    return call(cfg, path, { method: "PUT", body: JSON.stringify(body) });
  }

  return { test, listInbox, readFile, writeFile };
})();
