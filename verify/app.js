/* ════════════════════════════════════════════════════════════════
   인간 연구자 검증 도구 v13 - 공통 JS

   - 멀티 세트팩 지원 (5개 세트 × 20개씩 같은 형태)
   - LLM Judge 결과 표시 함수
   ════════════════════════════════════════════════════════════════ */

const API_BASE = "http://59.9.20.28/api/eval_api.php";

const LS_USER    = "eval_user";        // {user_id, display_name}
const LS_PACK    = "eval_current_pack"; // {eval_set_id, pack_no, review_type}


// ── API 헬퍼 ────────────────────────────────────────────────────
async function apiGet(action, params = {}) {
    const q = new URLSearchParams({action, ...params});
    const url = `${API_BASE}?${q}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
    return r.json();
}

async function apiPost(action, body) {
    const url = `${API_BASE}?action=${action}`;
    const r = await fetch(url, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${await r.text()}`);
    return r.json();
}


// ── 사용자/세션 관리 ─────────────────────────────────────────────
function getUser() {
    try {
        const raw = localStorage.getItem(LS_USER);
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}

function setUser(user_id, display_name) {
    localStorage.setItem(LS_USER, JSON.stringify({user_id, display_name}));
}

function clearUser() {
    localStorage.removeItem(LS_USER);
}

function getCurrentPack() {
    try {
        const raw = localStorage.getItem(LS_PACK);
        return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
}

function setCurrentPack(eval_set_id, pack_no, review_type) {
    localStorage.setItem(LS_PACK, JSON.stringify({eval_set_id, pack_no, review_type}));
}


// ── 가드: 사용자/팩 없으면 index 로 ─────────────────────────────
function requireSession() {
    const user = getUser();
    const pack = getCurrentPack();
    if (!user) {
        alert("먼저 학번/아이디를 입력하세요.");
        location.href = "index.html";
        return null;
    }
    if (!pack) {
        alert("평가할 세트를 선택하세요.");
        location.href = "index.html";
        return null;
    }
    return {user, pack};
}


// ── 유틸 ───────────────────────────────────────────────────────
function esc(s) {
    return (s == null ? "" : String(s)).replace(/[&<>"']/g, c => ({
        '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    }[c]));
}

function fmtDate(d) {
    if (!d || d.length !== 8) return d || "";
    return `${d.substring(0,4)}-${d.substring(4,6)}-${d.substring(6,8)}`;
}


// ── 헤더 렌더 ───────────────────────────────────────────────────
function renderHeader(title, subtitle) {
    const user = getUser();
    const userInfo = user
        ? `<span>👤 ${esc(user.display_name || user.user_id)}</span>`
        : "";
    return `
    <header class="app">
        <h1>${esc(title)}</h1>
        <div class="sub">${esc(subtitle)}</div>
        <div class="breadcrumb">
            <a href="index.html">← 세트 선택으로</a>
            ${userInfo ? "&nbsp;·&nbsp;" + userInfo : ""}
        </div>
    </header>`;
}


// ── 진행률 ──────────────────────────────────────────────────────
function renderProgress(done, total, labelDone = "검증 완료") {
    const pct = total > 0 ? (done / total * 100) : 0;
    return `
    <div class="progress">
        <div class="text">
            <b>${labelDone}</b>
            <span>${done} / ${total} (${pct.toFixed(1)}%)</span>
        </div>
        <div class="bar"><div class="fill" style="width:${pct}%"></div></div>
    </div>`;
}


// ── 토스트 ──────────────────────────────────────────────────────
function toast(msg, type = "info") {
    const el = document.createElement('div');
    el.style.cssText = `
        position: fixed; bottom: 90px; left: 50%; transform: translateX(-50%);
        background: ${type === 'error' ? '#ef4444' : '#1f2937'};
        color: white; padding: 10px 18px; border-radius: 8px;
        font-size: 14px; z-index: 1000; opacity: 0;
        transition: opacity 0.2s; box-shadow: 0 4px 12px rgba(0,0,0,0.2);
    `;
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(() => el.style.opacity = '1');
    setTimeout(() => {
        el.style.opacity = '0';
        setTimeout(() => el.remove(), 200);
    }, 1500);
}


// ── AI 답 박스 렌더 (인간 평가 후 자동 표시) ────────────────────
// 평가 타입: 'filter' | 'keyword' | 'embedding'
// sample : 샘플 객체 (ai_label, judge_label 등 포함)
// myLabel : 사람이 방금 선택한 라벨
function renderAiReveal(type, sample, myLabel) {
    const BIN = ['0.0-0.2', '0.2-0.4', '0.4-0.6', '0.6-0.8', '0.8-1.0'];
    const aiLabel    = sample.ai_label;
    const judgeLabel = sample.judge_label;
    const aiValue    = sample.ai_value;
    const judgeReason = sample.judge_reason || '';
    const aiReason    = sample.ai_reason    || '';

    function matchClass(humanLabel, otherLabel) {
        if (!otherLabel) return ['na', '—'];
        if (humanLabel === otherLabel) return ['exact', '✓ 일치'];
        if (type === 'embedding') {
            const ih = BIN.indexOf(humanLabel);
            const io = BIN.indexOf(otherLabel);
            if (ih >= 0 && io >= 0 && Math.abs(ih - io) === 1) {
                return ['adj', '△ 인접'];
            }
        }
        return ['miss', '✗ 불일치'];
    }

    function labelChip(label) {
        if (label === 'related')   return `<span class="label related">관련</span>`;
        if (label === 'unrelated') return `<span class="label unrelated">무관</span>`;
        if (BIN.includes(label))   return `<span class="label bin">${label}</span>`;
        return label ? `<span class="label">${esc(label)}</span>` : '—';
    }

    const aiMatch    = matchClass(myLabel, aiLabel);
    const judgeMatch = matchClass(myLabel, judgeLabel);

    // 임베딩일 때 실제 코사인값 표시
    const realRow = type === 'embedding' && aiValue != null
        ? `
        <div class="row">
            <div class="who">📐 실제 코사인</div>
            <div class="ans">
                ${labelChip(aiLabel)} <small style="color:#6b7280;">${aiValue.toFixed(4)}</small>
                <div class="reason">두 키워드 벡터의 실제 cosine similarity</div>
            </div>
            <div class="match ${aiMatch[0]}">${aiMatch[1]}</div>
        </div>
        `
        : `
        <div class="row">
            <div class="who">🤖 메인 AI</div>
            <div class="ans">
                ${labelChip(aiLabel)}
                ${aiReason ? `<div class="reason">${esc(aiReason)}</div>` : ''}
            </div>
            <div class="match ${aiMatch[0]}">${aiMatch[1]}</div>
        </div>
        `;

    const judgeRow = judgeLabel
        ? `
        <div class="row">
            <div class="who">⚖️ LLM Judge</div>
            <div class="ans">
                ${labelChip(judgeLabel)}
                ${judgeReason ? `<div class="reason">${esc(judgeReason)}</div>` : ''}
            </div>
            <div class="match ${judgeMatch[0]}">${judgeMatch[1]}</div>
        </div>
        `
        : '';

    return `
    <div class="ai-reveal">
        <h4>📊 평가 결과 비교 (당신 선택: ${labelChip(myLabel)})</h4>
        ${realRow}
        ${judgeRow}
    </div>`;
}
