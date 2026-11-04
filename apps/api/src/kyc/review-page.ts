/**
 * The manual ID review page served at /review. Self-contained: inline CSS and JS only, each
 * tagged with the per-response CSP nonce (__NONCE__ is replaced by ReviewPageController). Data
 * from the API is only ever written with textContent, never as HTML.
 */
export const REVIEW_PAGE_HTML = String.raw`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>ID review</title>
<style nonce="__NONCE__">
:root {
  --bg: #f6f7f9; --surface: #ffffff; --text: #15181d; --muted: #5d6673; --border: #dde1e7;
  --accent: #1f6feb; --ok: #1a7f37; --bad: #cf222e; --chip: #eef1f5;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #0e1116; --surface: #161b22; --text: #e6edf3; --muted: #8d96a0; --border: #30363d;
    --accent: #4493f8; --ok: #3fb950; --bad: #f85149; --chip: #21262d;
  }
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text);
  font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
header { background: var(--surface); border-bottom: 1px solid var(--border); padding: 12px 16px;
  display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
header h1 { font-size: 17px; margin: 0; flex: 1; }
main { max-width: 960px; margin: 0 auto; padding: 16px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 12px;
  padding: 16px; margin-bottom: 12px; }
label { display: block; font-size: 13px; font-weight: 600; color: var(--muted); margin: 12px 0 4px; }
input, textarea { width: 100%; font: inherit; color: var(--text); background: var(--bg);
  border: 1px solid var(--border); border-radius: 8px; padding: 9px 10px; }
textarea { min-height: 70px; resize: vertical; }
button { font: inherit; font-weight: 600; border-radius: 8px; border: 1px solid var(--border);
  background: var(--surface); color: var(--text); padding: 8px 14px; cursor: pointer; min-height: 40px; }
button:disabled { opacity: .5; cursor: default; }
button.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
button.ok { background: var(--ok); border-color: var(--ok); color: #fff; }
button.bad { background: var(--bad); border-color: var(--bad); color: #fff; }
button.link { border: 0; background: none; color: var(--accent); padding: 4px 0; min-height: 0; }
.row { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
.tabs { display: flex; gap: 6px; margin-bottom: 12px; }
.tabs button[aria-selected="true"] { background: var(--accent); border-color: var(--accent); color: #fff; }
.item { display: flex; justify-content: space-between; gap: 12px; align-items: center; width: 100%;
  text-align: left; font-weight: 400; padding: 12px 14px; margin-bottom: 8px; border-radius: 10px; }
.item strong { display: block; }
.muted { color: var(--muted); font-size: 13px; }
.error { color: var(--bad); margin-top: 10px; white-space: pre-wrap; }
.notice { color: var(--ok); margin-top: 10px; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; margin: 0; }
dt { color: var(--muted); font-size: 13px; }
dd { margin: 0; overflow-wrap: anywhere; }
.photos { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; margin-top: 12px; }
.photos figure { margin: 0; }
.photos img { width: 100%; border-radius: 10px; border: 1px solid var(--border); background: var(--chip);
  display: block; cursor: zoom-in; }
.photos img.zoomed { cursor: zoom-out; position: fixed; inset: 0; width: 100vw; height: 100vh; object-fit: contain; z-index: 10; border-radius: 0; background: rgba(0,0,0,.92); }
.photos figcaption { font-size: 13px; color: var(--muted); margin-top: 4px; text-transform: capitalize; }
.chips { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 8px; }
.chips button { background: var(--chip); font-weight: 500; font-size: 13px; min-height: 32px; padding: 4px 10px; }
.grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
.badge { font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: var(--chip); white-space: nowrap; }
.badge.warn { color: var(--bad); }
.hidden { display: none !important; }
.s1 { margin-top:14px }
.s2 { margin-left:auto }
.s3 { justify-content:space-between }
.s4 { margin:0;font-size:18px }
.s5 { margin-top:12px }
.s6 { margin:0 0 4px;font-size:16px }
.s7 { margin:0 }
.s8 { margin:20px 0 4px;font-size:16px }
@media (max-width: 560px) { .grid2 { grid-template-columns: 1fr; } }
</style>
</head>
<body>
<header>
  <h1>ID review</h1>
  <span id="who" class="muted"></span>
  <button id="signOut" class="hidden" type="button">Sign out</button>
</header>
<main>
  <section id="login" class="card">
    <p class="muted">Enter the reviewer token from the server's KYC_REVIEWER_TOKEN setting, and your name for the review record.</p>
    <label for="tokenInput">Reviewer token</label>
    <input id="tokenInput" type="password" autocomplete="off">
    <label for="nameInput">Your name</label>
    <input id="nameInput" type="text" autocomplete="name" maxlength="80">
    <div class="s1 row"><button id="loginBtn" class="primary" type="button">Open queue</button></div>
    <div id="loginError" class="error"></div>
  </section>

  <section id="queue" class="hidden">
    <div class="tabs" role="tablist">
      <button type="button" role="tab" data-status="pending" aria-selected="true">Pending</button>
      <button type="button" role="tab" data-status="approved" aria-selected="false">Approved</button>
      <button type="button" role="tab" data-status="rejected" aria-selected="false">Rejected</button>
      <button type="button" id="refresh" class="s2">Refresh</button>
    </div>
    <div id="list"></div>
    <div id="listError" class="error"></div>
  </section>

  <section id="detail" class="hidden">
    <button id="back" class="link" type="button">&larr; Back to the list</button>
    <div class="card">
      <div class="s3 row">
        <h2 id="dTitle" class="s4"></h2>
        <span id="dStatus" class="badge"></span>
      </div>
      <dl id="facts" class="s5"></dl>
      <div id="photos" class="photos"></div>
    </div>
    <div id="decide" class="card">
      <h3 class="s6">Approve</h3>
      <p class="s7 muted">Check the photo shows a real document, the details match what was typed, and the player is 18 or over. Correct the details below only if the photo shows different ones.</p>
      <div class="grid2">
        <div><label for="fixBirth">Corrected date of birth (optional)</label><input id="fixBirth" type="text" placeholder="YYYY-MM-DD" inputmode="numeric"></div>
        <div><label for="fixNumber">Corrected document number (optional)</label><input id="fixNumber" type="text" autocomplete="off"></div>
      </div>
      <div class="s5 row"><button id="approve" class="ok" type="button">Approve</button></div>
      <h3 class="s8">Reject</h3>
      <label for="reason">Reason (shown to the player)</label>
      <textarea id="reason" maxlength="300"></textarea>
      <div class="chips" id="reasons"></div>
      <div class="s5 row"><button id="reject" class="bad" type="button">Reject</button></div>
      <div id="decideError" class="error"></div>
    </div>
    <div id="decideDone" class="notice"></div>
  </section>
</main>
<script nonce="__NONCE__">
(function () {
  'use strict';
  var REASONS = ['Photo is blurry', 'Document is cut off', "Details don't match", 'Document expired', 'Under 18', 'Not a national ID card or passport'];
  var DOC = { nid: 'National ID card', passport: 'Passport' };
  var LAYOUT = { front_back: 'Front and back', single: 'Single photo' };
  var state = { token: '', name: '', status: 'pending', current: null, urls: [] };

  function $(id) { return document.getElementById(id); }
  function show(el, on) { el.classList.toggle('hidden', !on); }
  function store(key, value) {
    try { if (value === null) sessionStorage.removeItem(key); else sessionStorage.setItem(key, value); } catch (e) {}
  }
  function load(key) { try { return sessionStorage.getItem(key) || ''; } catch (e) { return ''; } }
  function el(tag, text, cls) {
    var n = document.createElement(tag);
    if (text !== undefined && text !== null) n.textContent = String(text);
    if (cls) n.className = cls;
    return n;
  }
  function when(iso) {
    if (!iso) return '';
    var d = new Date(iso);
    return isNaN(d.getTime()) ? String(iso) : d.toLocaleString();
  }
  function ageOf(birth) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(birth || '');
    if (!m) return null;
    var now = new Date(), y = +m[1], mo = +m[2], d = +m[3];
    var age = now.getFullYear() - y;
    if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) age--;
    return age;
  }

  function ApiError(status, body) {
    this.status = status;
    this.message = (body && body.message) ? (Array.isArray(body.message) ? body.message.join('\n') : String(body.message)) : 'Request failed (' + status + ')';
    this.code = body && body.error ? String(body.error) : '';
  }
  function call(path, opts) {
    opts = opts || {};
    var headers = { 'x-reviewer-token': state.token };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    return fetch(path, {
      method: opts.method || 'GET',
      headers: headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      cache: 'no-store',
      credentials: 'omit'
    }).then(function (res) {
      if (opts.blob && res.ok) return res.blob();
      return res.text().then(function (text) {
        var body = null;
        try { body = text ? JSON.parse(text) : null; } catch (e) { body = { message: text }; }
        if (!res.ok) throw new ApiError(res.status, body);
        return body;
      });
    });
  }
  function errorText(err) {
    if (err instanceof ApiError) {
      if (err.status === 401 || err.status === 403) return 'The reviewer token was refused.';
      if (err.status === 404 && !state.current) return 'Review is switched off on this server (KYC_REVIEWER_TOKEN is not set), or the token is wrong.';
      return (err.code ? err.code + ': ' : '') + err.message;
    }
    return 'Could not reach the API: ' + (err && err.message ? err.message : String(err));
  }

  function releasePhotos() {
    state.urls.forEach(function (u) { URL.revokeObjectURL(u); });
    state.urls = [];
    $('photos').replaceChildren();
  }

  // ---------------------------------------------------------------- sign-in
  function signedIn() {
    show($('login'), false);
    show($('queue'), true);
    show($('signOut'), true);
    $('who').textContent = 'Reviewing as ' + state.name;
    loadList();
  }
  $('loginBtn').addEventListener('click', function () {
    var token = $('tokenInput').value.trim(), name = $('nameInput').value.trim();
    $('loginError').textContent = '';
    if (!token || !name) { $('loginError').textContent = 'Enter the token and your name.'; return; }
    state.token = token; state.name = name;
    $('loginBtn').disabled = true;
    call('/v1/review/verifications?status=pending').then(function () {
      store('kycReviewToken', token); store('kycReviewName', name);
      signedIn();
    }, function (err) {
      state.token = '';
      $('loginError').textContent = errorText(err);
    }).then(function () { $('loginBtn').disabled = false; });
  });
  $('tokenInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('loginBtn').click(); });
  $('nameInput').addEventListener('keydown', function (e) { if (e.key === 'Enter') $('loginBtn').click(); });
  $('signOut').addEventListener('click', function () {
    store('kycReviewToken', null);
    state.token = ''; state.current = null;
    releasePhotos();
    show($('queue'), false); show($('detail'), false); show($('signOut'), false);
    show($('login'), true);
    $('who').textContent = '';
    $('tokenInput').value = '';
  });

  // ---------------------------------------------------------------- list
  Array.prototype.forEach.call(document.querySelectorAll('[data-status]'), function (tab) {
    tab.addEventListener('click', function () {
      state.status = tab.getAttribute('data-status');
      Array.prototype.forEach.call(document.querySelectorAll('[data-status]'), function (t) {
        t.setAttribute('aria-selected', String(t === tab));
      });
      loadList();
    });
  });
  $('refresh').addEventListener('click', function () { loadList(); });

  function loadList() {
    var list = $('list');
    $('listError').textContent = '';
    list.replaceChildren(el('p', 'Loading...', 'muted'));
    call('/v1/review/verifications?status=' + encodeURIComponent(state.status)).then(function (items) {
      items = Array.isArray(items) ? items : (items && items.items) || [];
      list.replaceChildren();
      if (items.length === 0) {
        list.appendChild(el('p', state.status === 'pending' ? 'Nothing waiting for review.' : 'None yet.', 'muted'));
        return;
      }
      items.forEach(function (s) {
        var b = el('button', null, 'item card');
        b.type = 'button';
        var left = el('div');
        left.appendChild(el('strong', (DOC[s.documentType] || s.documentType) + ' - ' + (LAYOUT[s.layout] || s.layout)));
        left.appendChild(el('span', 'Player ' + s.userId + ' - sent ' + when(s.submittedAt), 'muted'));
        if (s.reviewedAt) left.appendChild(el('div', 'Decided ' + when(s.reviewedAt) + (s.reviewedBy ? ' by ' + s.reviewedBy : ''), 'muted'));
        b.appendChild(left);
        var age = ageOf(s.birthDate);
        if (age !== null && age < 18) b.appendChild(el('span', 'Under 18', 'badge warn'));
        b.addEventListener('click', function () { openSubmission(s.id); });
        list.appendChild(b);
      });
    }, function (err) {
      list.replaceChildren();
      $('listError').textContent = errorText(err);
    });
  }

  // ---------------------------------------------------------------- one submission
  function fact(dl, label, value) {
    dl.appendChild(el('dt', label));
    dl.appendChild(el('dd', value === null || value === undefined || value === '' ? '-' : value));
  }

  function openSubmission(id) {
    releasePhotos();
    state.current = null;
    $('decideError').textContent = ''; $('decideDone').textContent = '';
    $('fixBirth').value = ''; $('fixNumber').value = ''; $('reason').value = '';
    show($('queue'), false); show($('detail'), true);
    $('dTitle').textContent = 'Loading...'; $('dStatus').textContent = '';
    $('facts').replaceChildren();
    show($('decide'), false);
    window.scrollTo(0, 0);
    call('/v1/review/verifications/' + encodeURIComponent(id)).then(function (s) {
      state.current = s;
      $('dTitle').textContent = (DOC[s.documentType] || s.documentType) + ' - ' + (LAYOUT[s.layout] || s.layout);
      $('dStatus').textContent = s.status;
      var dl = $('facts');
      var age = ageOf(s.birthDate);
      fact(dl, 'Player', s.userId);
      fact(dl, 'Date of birth (typed)', s.birthDate);
      fact(dl, 'Age today', age === null ? null : age + (age < 18 ? ' - under 18' : ''));
      fact(dl, 'Document number (typed)', s.documentNumber || (s.status === 'pending' ? null : 'Wiped after the decision'));
      fact(dl, 'Sent', when(s.submittedAt));
      if (s.reviewedAt) fact(dl, 'Decided', when(s.reviewedAt) + (s.reviewedBy ? ' by ' + s.reviewedBy : ''));
      if (s.rejectionReason) fact(dl, 'Rejection reason', s.rejectionReason);
      if (s.imagesPurgedAt) fact(dl, 'Photos deleted', when(s.imagesPurgedAt));
      show($('decide'), s.status === 'pending');
      if (!s.imagesPurgedAt) loadPhotos(s);
    }, function (err) {
      $('dTitle').textContent = 'Could not open this submission';
      $('decideError').textContent = errorText(err);
    });
  }

  function loadPhotos(s) {
    var sides = (s.images || []).map(function (i) { return i.side; });
    if (sides.length === 0) sides = s.layout === 'single' ? ['single'] : ['front', 'back'];
    sides.forEach(function (side) {
      var fig = el('figure');
      var img = document.createElement('img');
      img.alt = side + ' photo';
      img.addEventListener('click', function () {
        img.classList.toggle('zoomed');
      });
      fig.appendChild(img);
      var cap = el('figcaption', side === 'single' ? 'Single photo' : side + ' side');
      fig.appendChild(cap);
      $('photos').appendChild(fig);
      call('/v1/review/verifications/' + encodeURIComponent(s.id) + '/images/' + side, { blob: true }).then(function (blob) {
        if (!state.current || state.current.id !== s.id) return;
        var url = URL.createObjectURL(blob);
        state.urls.push(url);
        img.src = url;
      }, function (err) {
        cap.textContent = side + ': ' + errorText(err);
      });
    });
  }

  $('back').addEventListener('click', function () {
    releasePhotos();
    state.current = null;
    show($('detail'), false); show($('queue'), true);
    loadList();
  });

  REASONS.forEach(function (r) {
    var b = el('button', r);
    b.type = 'button';
    b.addEventListener('click', function () { $('reason').value = r; $('reason').focus(); });
    $('reasons').appendChild(b);
  });

  function decide(action, body) {
    var s = state.current;
    if (!s) return;
    $('decideError').textContent = '';
    $('approve').disabled = true; $('reject').disabled = true;
    call('/v1/review/verifications/' + encodeURIComponent(s.id) + '/' + action, { method: 'POST', body: body }).then(function () {
      show($('decide'), false);
      $('decideDone').textContent = action === 'approve' ? 'Approved. The player is verified.' : 'Rejected. The player can send new photos.';
      $('dStatus').textContent = action === 'approve' ? 'approved' : 'rejected';
    }, function (err) {
      $('decideError').textContent = errorText(err);
    }).then(function () { $('approve').disabled = false; $('reject').disabled = false; });
  }

  $('approve').addEventListener('click', function () {
    var body = { reviewer: state.name };
    var birth = $('fixBirth').value.trim(), num = $('fixNumber').value.trim();
    if (birth) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(birth)) { $('decideError').textContent = 'Write the corrected date as YYYY-MM-DD.'; return; }
      body.birthDate = birth;
    }
    if (num) body.documentNumber = num;
    var age = ageOf(birth || (state.current && state.current.birthDate));
    if (age !== null && age < 18 && !window.confirm('This date of birth is under 18. Approve anyway?')) return;
    decide('approve', body);
  });
  $('reject').addEventListener('click', function () {
    var reason = $('reason').value.trim();
    if (!reason) { $('decideError').textContent = 'Write or pick a reason for the player.'; return; }
    decide('reject', { reviewer: state.name, reason: reason });
  });

  // ---------------------------------------------------------------- start
  state.name = load('kycReviewName');
  $('nameInput').value = state.name;
  var saved = load('kycReviewToken');
  if (saved && state.name) {
    state.token = saved;
    call('/v1/review/verifications?status=pending').then(signedIn, function () {
      state.token = '';
      store('kycReviewToken', null);
    });
  }
})();
</script>
</body>
</html>
`;
