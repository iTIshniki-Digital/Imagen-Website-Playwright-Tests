(function () {
  "use strict";

  /* =======================================================================
     CONFIG — fill these in once during setup (docs/README-setup.md), then
     commit. None of these are secret: the OAuth client id, the Worker URL
     and a Drive API key restricted to read-only Drive access are all meant
     to be visible in page source — the actual access control happens on
     GitHub's and Google's side (the viewer's own OAuth token / the
     referrer-restricted key), never here.
     ===================================================================== */
  var OWNER = "iTIshniki-Digital"; // организация сменилась 2026-10-19 (был личный аккаунт iTishnikiDigital)
  var REPO = "Imagen-Website-Playwright-Tests";
  var WORKFLOW_FILE = "playwright.yml";
  var GITHUB_CLIENT_ID = "Ov23liOhDUGvGWL8CUh6"; // OAuth App → Client ID (docs/README-setup.md step 1)
  var WORKER_URL = "https://imagen-qa-oauth.ruslanb-e28.workers.dev"; // Cloudflare Worker URL (docs/README-setup.md step 2)
  var DRIVE_LATEST_JSON_FILE_ID = "1XEeA3QsB6U0ce4J6HcLoMVYSvp8SyqzZ"; // scripts/README-qa-dashboard.md step 1
  var DRIVE_API_KEY = "AIzaSyAbqxbglvdIqzkIJVxTysk5kFMruQuHSz0"; // Google Cloud Console API key, restricted to Drive API (docs/README-setup.md step 3)

  var REDIRECT_URI = location.origin + location.pathname;
  var API = "https://api.github.com";

  /* Same categories as scripts/qa-dashboard-categories.js and
     .github/ISSUE_TEMPLATE/qa-run.yml — THREE places, keep them in sync. */
  var CATEGORIES = [
    ["homepage-nav", "Homepage & Navigation (Desktop 1600px)", ["tests/homepage.spec.ts"]],
    ["signup-flow", "Desktop Signup Flow (full)", ["tests/signup-funnel.spec.ts","tests/quiz-full-walkthrough.spec.ts"]],
    ["multi-language", "Multi-Language Signup (Rotate)", ["tests/localization.spec.ts","tests/localized-funnel.spec.ts"]],
    ["video-page", "Video Page (full flow)", ["tests/video-funnel.spec.ts","tests/video-quiz-full-walkthrough.spec.ts"]],
    ["mobile", "Mobile (real phone or emulation)", ["tests/mobile-funnel.spec.ts"]],
    ["ios", "iOS / Apple Devices", ["tests/ios-and-accessibility.spec.ts"]],
    ["pricing", "Pricing (Rotate regions)", ["tests/pricing-api.spec.ts","tests/pricing-rendered.spec.ts"]],
    ["console-sweep", "Cross-page Console/HTTP Sweep", ["tests/site-health.spec.ts"]],
    ["functional-gaps", "Functional Gaps", ["tests/form-validation.spec.ts","tests/navigation-links.spec.ts","tests/cta-buttons.spec.ts","tests/language-switcher.spec.ts","tests/content-templates.spec.ts","tests/podcast-content-template.spec.ts","tests/cookie-banner.spec.ts"]],
    ["visual-ux", "Visual / UX Gaps", ["tests/responsive.spec.ts","tests/tablet-sweep.spec.ts","tests/media-video.spec.ts","tests/interactive-widgets.spec.ts","tests/scroll-behavior.spec.ts"]],
    ["real-estate", "Real Estate Webapp", ["tests/real-estate.spec.ts"]]
  ];
  function categoryName(slug){ var c = CATEGORIES.filter(function(x){return x[0]===slug;})[0]; return c ? c[1] : (slug || "Other"); }

  var BROWSERS = [["chromium","Chrome"],["firefox","Firefox"],["webkit","Safari (WebKit)"]];
  var SPEC_RE = /^tests\/[A-Za-z0-9._-]+\.spec\.ts$/;
  var GREP_RE = /^[A-Za-z0-9 _.,:()\/|-]{1,120}$/;

  function esc(s){
    return String(s == null ? "" : s).replace(/[&<>"']/g, function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[c];
    });
  }
  function fmtDateTime(iso){ if (!iso) return "–"; try{ return new Date(iso).toLocaleString(undefined,{year:"numeric",month:"short",day:"2-digit",hour:"2-digit",minute:"2-digit"}); }catch(e){ return iso; } }
  function fmtDate(iso){ if (!iso) return "–"; try{ return new Date(iso).toLocaleDateString(undefined,{year:"numeric",month:"short",day:"2-digit"}); }catch(e){ return iso; } }
  function relTime(iso){
    if (!iso) return "";
    var ms = Date.now() - new Date(iso).getTime();
    var m = Math.round(ms/60000);
    if (m < 1) return "just now";
    if (m < 60) return m + "m ago";
    var h = Math.round(m/60);
    if (h < 48) return h + "h ago";
    return Math.round(h/24) + "d ago";
  }
  function sleep(ms){ return new Promise(function(r){ setTimeout(r, ms); }); }
  function randomState(){
    var a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return Array.prototype.map.call(a, function(b){ return b.toString(16).padStart(2,"0"); }).join("");
  }

  /* =============================================================== auth */
  var TOKEN_KEY = "imagenQaRuns.ghToken";
  var STATE_KEY = "imagenQaRuns.oauthState";

  function getToken(){ try{ return localStorage.getItem(TOKEN_KEY); }catch(e){ return null; } }
  function setToken(t){ try{ localStorage.setItem(TOKEN_KEY, t); }catch(e){} }
  function clearToken(){ try{ localStorage.removeItem(TOKEN_KEY); }catch(e){} }

  function beginSignIn(){
    if (!GITHUB_CLIENT_ID){
      showGateMessage("This page isn't configured yet — GITHUB_CLIENT_ID is empty in docs/app.js. See docs/README-setup.md.");
      return;
    }
    var state = randomState();
    try{ sessionStorage.setItem(STATE_KEY, state); }catch(e){}
    var url = "https://github.com/login/oauth/authorize?" + new URLSearchParams({
      client_id: GITHUB_CLIENT_ID, redirect_uri: REDIRECT_URI, scope: "repo", state: state
    }).toString();
    location.href = url;
  }

  function showGateMessage(text){
    var el = document.getElementById("gateMsg");
    el.hidden = false; el.textContent = text;
  }

  // Возвращает access token, если в URL есть ?code=... (возврат с GitHub) —
  // обменивает его через Worker, иначе null.
  function handleOAuthCallback(){
    var params = new URLSearchParams(location.search);
    var code = params.get("code");
    var state = params.get("state");
    if (!code) return Promise.resolve(null);

    var expected = null;
    try{ expected = sessionStorage.getItem(STATE_KEY); }catch(e){}
    history.replaceState(null, "", location.pathname); // убираем code/state из адресной строки сразу

    if (!state || state !== expected){
      showGateMessage("Sign-in failed (state mismatch) — try again.");
      return Promise.resolve(null);
    }
    if (!WORKER_URL){
      showGateMessage("This page isn't configured yet — WORKER_URL is empty in docs/app.js. See docs/README-setup.md.");
      return Promise.resolve(null);
    }
    return fetch(WORKER_URL, {
      method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify({code: code})
    }).then(function(res){ return res.json(); }).then(function(data){
      if (data.access_token) return data.access_token;
      showGateMessage("Sign-in failed: " + (data.error_description || data.error || "unknown error") + ".");
      return null;
    }).catch(function(err){
      showGateMessage("Sign-in failed: " + err.message);
      return null;
    });
  }

  /* ========================================================= GitHub API */
  var ghCache = {}; // простая память на время сессии, не персистентная
  function gh(path, opts){
    opts = opts || {};
    var token = getToken();
    var headers = {
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28"
    };
    if (token) headers["Authorization"] = "Bearer " + token;
    if (opts.body) headers["Content-Type"] = "application/json";
    return fetch(API + path, { method: opts.method || "GET", headers: headers, body: opts.body }).then(function(res){
      if (res.status === 401){ clearToken(); location.reload(); throw new Error("Session expired — signed out."); }
      if (res.status === 204) return null;
      return res.json().then(function(data){
        if (!res.ok){
          var err = new Error((data && data.message) || ("GitHub API " + res.status));
          err.status = res.status; err.data = data;
          throw err;
        }
        return data;
      });
    });
  }

  /* ---------------------------------------------------------------- tabs */
  var tabs = Array.prototype.slice.call(document.querySelectorAll(".tab"));
  var panels = {};
  Array.prototype.slice.call(document.querySelectorAll(".panel")).forEach(function(p){ panels[p.dataset.panel] = p; });
  function selectTab(name){
    tabs.forEach(function(t){ t.setAttribute("aria-selected", String(t.dataset.tab === name)); });
    Object.keys(panels).forEach(function(k){ panels[k].hidden = (k !== name); });
    try{ localStorage.setItem("imagenQaRuns.tab", name); }catch(e){}
    if (name === "latest" && !state.latestRun) loadLatestRun();
    if (name === "bugs" && !state.bugsLoaded) loadBugs();
    if (name === "history" && !state.historyLoaded) loadHistory();
  }
  tabs.forEach(function(t){ t.addEventListener("click", function(){ selectTab(t.dataset.tab); }); });

  /* ------------------------------------------------------------ lightbox */
  var lightbox = document.getElementById("lightbox");
  var lightboxImg = document.getElementById("lightboxImg");
  function openLightbox(url){ lightboxImg.src = url; lightbox.hidden = false; }
  document.getElementById("lightboxClose").addEventListener("click", function(){ lightbox.hidden = true; lightboxImg.src=""; });
  lightbox.addEventListener("click", function(e){ if (e.target === lightbox){ lightbox.hidden = true; lightboxImg.src=""; } });
  document.addEventListener("keydown", function(e){ if (e.key === "Escape" && !lightbox.hidden){ lightbox.hidden = true; lightboxImg.src=""; } });
  window.__qaOpenShot = openLightbox;

  /* -------------------------------------------------------- run-tests UI */
  var browserChips = document.getElementById("browserChips");
  BROWSERS.forEach(function(b, i){
    var label = document.createElement("label");
    label.className = "chip";
    label.innerHTML = '<input type="checkbox" value="'+b[0]+'" '+(i===0?"checked":"")+'><span>'+esc(b[1])+'</span>';
    browserChips.appendChild(label);
  });

  var categoryChips = document.getElementById("categoryChips");
  var allChipLabel = document.createElement("label");
  allChipLabel.className = "chip all";
  allChipLabel.innerHTML = '<input type="checkbox" id="catAll" checked><span>Full suite</span>';
  categoryChips.appendChild(allChipLabel);
  var catAllInput = allChipLabel.querySelector("input");
  var catInputs = [];
  CATEGORIES.forEach(function(c){
    var label = document.createElement("label");
    label.className = "chip";
    label.innerHTML = '<input type="checkbox" value="'+c[0]+'"><span>'+esc(c[1])+'</span> <span class="file-count">'+c[2].length+' file'+(c[2].length>1?"s":"")+'</span>';
    categoryChips.appendChild(label);
    catInputs.push(label.querySelector("input"));
  });
  function updateFileLimit(){
    var picked = catInputs.filter(function(i){ return i.checked; });
    var total = 0;
    picked.forEach(function(i){
      var cat = CATEGORIES.filter(function(c){ return c[0] === i.value; })[0];
      if (cat) total += cat[2].length;
    });
    var msg = document.getElementById("fileLimitMsg");
    var submitBtn = document.getElementById("runSubmitBtn");
    if (picked.length && total > 12){
      msg.hidden = false;
      msg.textContent = "Too many test files selected (" + total + ", max 12). Pick fewer categories, or use Full suite.";
      submitBtn.disabled = true;
    } else {
      msg.hidden = true;
      submitBtn.disabled = false;
    }
  }
  catAllInput.addEventListener("change", function(){
    if (catAllInput.checked){ catInputs.forEach(function(i){ i.checked = false; }); }
    updateFileLimit();
  });
  catInputs.forEach(function(i){
    i.addEventListener("change", function(){
      if (i.checked) catAllInput.checked = false;
      if (!catInputs.some(function(x){ return x.checked; })) catAllInput.checked = true;
      updateFileLimit();
    });
  });

  function setBanner(el, kind, html){ el.hidden = false; el.className = "status-banner " + kind; el.innerHTML = html; }

  document.getElementById("runForm").addEventListener("submit", function(e){
    e.preventDefault();
    var banner = document.getElementById("runStatusBanner");
    var browsers = Array.prototype.slice.call(browserChips.querySelectorAll("input:checked")).map(function(i){ return i.value; });
    if (!browsers.length){ setBanner(banner, "err", "Select at least one browser."); return; }

    var customSpecsRaw = document.getElementById("rtSpecs").value.trim();
    var specFiles = "";
    if (customSpecsRaw){
      var parts = customSpecsRaw.split(/\s+/);
      if (parts.length > 12 || !parts.every(function(p){ return SPEC_RE.test(p); })){
        setBanner(banner, "err", "Custom test files are invalid. Use paths like tests/name.spec.ts separated by spaces, at most 12.");
        return;
      }
      specFiles = parts.join(" ");
    } else if (!catAllInput.checked){
      var files = [];
      catInputs.filter(function(i){ return i.checked; }).forEach(function(i){
        var cat = CATEGORIES.filter(function(c){ return c[0] === i.value; })[0];
        if (cat) cat[2].forEach(function(f){ if (files.indexOf(f) === -1) files.push(f); });
      });
      if (!files.length){ setBanner(banner, "err", "Select at least one category, or Full suite."); return; }
      if (files.length > 12){ setBanner(banner, "err", "Too many test files selected (" + files.length + ", max 12). Pick fewer categories."); return; }
      specFiles = files.join(" ");
    }

    var grep = document.getElementById("rtGrep").value.trim();
    if (grep && !GREP_RE.test(grep)){ setBanner(banner, "err", "The name filter has invalid characters. Allowed: Latin letters, digits, spaces and _ . , : ( ) / | -."); return; }
    var cookies = document.getElementById("rtCookies").value.trim();
    if (cookies && (cookies.length > 2000 || /[\r\n]/.test(cookies) || cookies.indexOf("=") === -1)){ setBanner(banner, "err", "Cookies are invalid. Use a string like name1=value1; name2=value2, on one line."); return; }
    var retries = document.getElementById("rtRetries").checked;

    var btn = document.getElementById("runSubmitBtn");
    btn.disabled = true;
    banner.hidden = true;
    setBanner(document.getElementById("runProgress"), "info", '<span class="spinner"></span>&nbsp; Starting the run…');

    var inputs = {
      browsers: browsers.join(","), raw_client_cookies: cookies, spec_files: specFiles,
      grep: grep, retries: retries ? "true" : "false"
    };
    var dispatchedAt = new Date().toISOString();
    gh("/repos/"+OWNER+"/"+REPO+"/actions/workflows/"+WORKFLOW_FILE+"/dispatches", {
      method: "POST", body: JSON.stringify({ ref: "main", inputs: inputs })
    }).then(function(){
      return pollForNewRun(dispatchedAt);
    }).then(function(run){
      btn.disabled = false;
      if (!run){
        setBanner(document.getElementById("runProgress"), "info",
          'Run dispatched, but it hasn\'t shown up in the run list yet — ' +
          '<a href="https://github.com/'+OWNER+'/'+REPO+'/actions/workflows/'+WORKFLOW_FILE+'" target="_blank" rel="noopener">check Actions directly</a>.');
        return;
      }
      trackRun(run);
    }).catch(function(err){
      btn.disabled = false;
      document.getElementById("runProgress").hidden = true;
      setBanner(banner, "err", "Couldn't start the run: " + esc(err.message) +
        (err.status === 403 ? " — you may not have write access to this repository." : ""));
    });
  });

  function pollForNewRun(afterIso, attemptsLeft){
    attemptsLeft = attemptsLeft == null ? 8 : attemptsLeft;
    return sleep(3000).then(function(){
      return gh("/repos/"+OWNER+"/"+REPO+"/actions/workflows/"+WORKFLOW_FILE+"/runs?event=workflow_dispatch&per_page=5");
    }).then(function(data){
      var match = (data.workflow_runs || []).filter(function(r){ return new Date(r.created_at) >= new Date(afterIso); })[0];
      if (match) return match;
      if (attemptsLeft <= 1) return null;
      return pollForNewRun(afterIso, attemptsLeft - 1);
    });
  }

  function trackRun(run){
    var box = document.getElementById("runProgress");
    var startedAt = Date.now();
    var MAX_MS = 50 * 60 * 1000;
    (function poll(){
      gh("/repos/"+OWNER+"/"+REPO+"/actions/runs/"+run.id).then(function(r){
        var running = r.status !== "completed";
        var ok = r.conclusion === "success";
        setBanner(box, running ? "info" : (ok ? "ok" : "err"),
          (running ? '<span class="spinner"></span>&nbsp; ' : "") +
          '<a href="'+esc(r.html_url)+'" target="_blank" rel="noopener">Run #'+r.run_number+'</a> — ' +
          esc(running ? (r.status === "queued" ? "queued…" : "in progress…") : (ok ? "finished — passed" : ("finished — " + r.conclusion))) +
          (running ? "" : ' · check the <strong>Open Bugs</strong> and <strong>Latest Run</strong> tabs for details.')
        );
        if (running && (Date.now() - startedAt) < MAX_MS) sleep(10000).then(poll);
        else if (!running){
          state.latestRun = null; state.bugsLoaded = false; state.historyLoaded = false; // force refresh next visit
        }
      }).catch(function(err){
        setBanner(box, "err", "Lost track of the run: " + esc(err.message) +
          ' — <a href="https://github.com/'+OWNER+'/'+REPO+'/actions" target="_blank" rel="noopener">check Actions directly</a>.');
      });
    })();
  }

  /* --------------------------------------------------------- latest run */
  var state = { latestRun: null, bugs: [], bugsLoaded: false, bugFilter: "open", historyLoaded: false, runs: [] };

  function statusDotClass(s){ return s === "passed" ? "good" : (s === "skipped" ? "skip" : "bad"); }
  function statusLabel(s){ return s === "passed" ? "Good" : (s === "skipped" ? "Skipped" : "Failed"); }

  function loadLatestRun(){
    var empty = document.getElementById("latestEmpty");
    var list = document.getElementById("categoryList");
    var meta = document.getElementById("runPickerMeta");
    if (!DRIVE_LATEST_JSON_FILE_ID || !DRIVE_API_KEY){
      empty.hidden = false; list.innerHTML = "";
      document.getElementById("latestEmpty").querySelector("p").textContent =
        "Drive isn't configured yet (DRIVE_LATEST_JSON_FILE_ID / DRIVE_API_KEY in docs/app.js) — see scripts/README-qa-dashboard.md.";
      return;
    }
    meta.textContent = "loading…";
    var url = "https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(DRIVE_LATEST_JSON_FILE_ID) +
      "?alt=media&key=" + encodeURIComponent(DRIVE_API_KEY);
    fetch(url).then(function(res){
      if (!res.ok) throw new Error("Drive returned " + res.status);
      return res.json();
    }).then(function(run){
      state.latestRun = run;
      renderLatest();
      renderHeader();
    }).catch(function(err){
      meta.textContent = "";
      empty.hidden = false;
      empty.querySelector("h3").textContent = "Couldn't load the latest run";
      empty.querySelector("p").textContent = err.message;
    });
  }
  document.getElementById("refreshLatestBtn").addEventListener("click", loadLatestRun);

  function renderLatest(){
    var empty = document.getElementById("latestEmpty");
    var list = document.getElementById("categoryList");
    var meta = document.getElementById("runPickerMeta");
    var run = state.latestRun;
    if (!run){
      empty.hidden = false; list.innerHTML = ""; meta.textContent = "";
      return;
    }
    empty.hidden = true;
    var t = run.trigger || {};
    meta.textContent = run.runId + (t.actor ? " · " + t.actor : "") + " · " + fmtDateTime(run.finishedAt);
    var cats = run.categories || {};
    var slugs = Object.keys(cats).sort(function(a,b){
      var ia = CATEGORIES.findIndex(function(c){ return c[0]===a; }); if (ia === -1) ia = 999;
      var ib = CATEGORIES.findIndex(function(c){ return c[0]===b; }); if (ib === -1) ib = 999;
      return ia - ib;
    });
    if (!slugs.length){ list.innerHTML = '<div class="empty"><span class="mark">∅</span><h3>Run has no categorized checks</h3></div>'; return; }
    list.innerHTML = slugs.map(function(slug){
      var cat = cats[slug];
      var checks = cat.checks || [];
      var passed = checks.filter(function(c){ return c.status === "passed"; }).length;
      var failed = checks.filter(function(c){ return c.status === "failed"; }).length;
      var skipped = checks.filter(function(c){ return c.status === "skipped"; }).length;
      var stripe = failed ? "bad" : (passed ? "good" : "skip");
      var openAttr = failed ? " open" : "";
      var checksHtml = checks.map(function(c){
        var projects = c.projects || {};
        var projKeys = Object.keys(projects);
        var badges = projKeys.map(function(p){
          var pr = projects[p];
          var cls = pr.status === "passed" ? "good" : (pr.status === "skipped" ? "" : "bad");
          return '<span class="proj '+cls+(pr.expectedFail?" expected":"")+'">'+esc(p)+' '+(pr.status==="passed"?"✓":(pr.status==="skipped"?"–":"✕"))+'</span>';
        }).join("");
        var errors = projKeys.map(function(p){ return projects[p].error ? (p+": "+projects[p].error) : null; }).filter(Boolean);
        var detail = "";
        if (c.status === "failed"){
          detail = '<div class="check-detail">' +
            (errors.length ? '<div class="err-box">'+esc(errors.join("\n\n"))+'</div>' : '') +
            (c.screenshotUrl ? '<div class="shot"><img src="'+esc(c.screenshotUrl)+'" alt="Failure screenshot: '+esc(c.title)+'" loading="lazy" onclick="window.__qaOpenShot(\''+esc(c.screenshotUrl).replace(/'/g,"&#39;")+'\')" onerror="this.closest(\'.shot\').remove()"></div>' : '') +
            (c.videoUrl ? '<a class="clip-link" href="'+esc(c.videoUrl)+'" target="_blank" rel="noopener">▶ Watch recording</a>' : '') +
          '</div>';
        }
        return '<div class="check">' +
          '<div class="check-top">' +
            '<span class="check-badge '+statusDotClass(c.status)+'">'+(c.status==="passed"?"✓":(c.status==="skipped"?"–":"✕"))+'</span>' +
            '<div style="flex:1 1 auto;"><div class="check-title">'+esc(c.title)+'</div>' +
              '<div class="check-status-text '+statusDotClass(c.status)+'">'+statusLabel(c.status)+'</div>' +
              '<div class="proj-badges">'+badges+'</div></div>' +
          '</div>' + detail +
        '</div>';
      }).join("");
      var allGood = failed === 0 && skipped === 0 && passed > 0;
      return '<details class="cat"'+openAttr+'>' +
        '<summary class="cat-head"><span class="cat-stripe '+stripe+'"></span>' +
          '<span class="cat-name">'+esc(cat.name || categoryName(slug))+'</span>' +
          '<span class="cat-counts">' +
            (allGood ? '<span class="pill all-good">All good</span>' : [
              passed? '<span class="pill good">'+passed+' pass</span>':'',
              failed? '<span class="pill bad">'+failed+' fail</span>':'',
              skipped? '<span class="pill skip">'+skipped+' skip</span>':''
            ].join('')) +
          '</span><span class="chevron">›</span></summary>' +
        '<div class="cat-body">'+checksHtml+'</div>' +
      '</details>';
    }).join("");
  }

  function renderHeader(){
    var t = state.latestRun && state.latestRun.totals;
    document.getElementById("headerTotals").innerHTML =
      '<span class="seg"><span class="dot good"></span>'+(t?t.passed:"–")+'</span>' +
      '<span class="seg"><span class="dot bad"></span>'+(t?t.failed:"–")+'</span>' +
      '<span class="seg"><span class="dot skip"></span>'+(t?t.skipped:"–")+'</span>';
  }

  /* ------------------------------------------------------------ bugs */
  var bugTabs = Array.prototype.slice.call(document.querySelectorAll(".bug-tab"));
  function selectBugFilter(f){
    state.bugFilter = f;
    bugTabs.forEach(function(t){ t.setAttribute("aria-selected", String(t.dataset.bugfilter === f)); });
    renderBugs();
  }
  bugTabs.forEach(function(t){ t.addEventListener("click", function(){ selectBugFilter(t.dataset.bugfilter); }); });

  function loadBugs(){
    gh("/repos/"+OWNER+"/"+REPO+"/issues?labels=qa-bug&state=all&per_page=100").then(function(issues){
      state.bugs = issues;
      state.bugsLoaded = true;
      renderBugs();
    }).catch(function(err){
      var list = document.getElementById("bugsList");
      list.innerHTML = '<div class="empty"><span class="mark">!</span><h3>Couldn\'t load bugs</h3><p>'+esc(err.message)+'</p></div>';
    });
  }

  function toggleBugState(number, nextState, btn){
    btn.disabled = true;
    gh("/repos/"+OWNER+"/"+REPO+"/issues/"+number, { method: "PATCH", body: JSON.stringify({ state: nextState }) })
      .then(function(){ return loadBugsAsync(); })
      .then(function(){ renderBugs(); })
      .catch(function(err){ btn.disabled = false; alert_("Couldn't update the issue: " + err.message); });
  }
  function loadBugsAsync(){
    return gh("/repos/"+OWNER+"/"+REPO+"/issues?labels=qa-bug&state=all&per_page=100").then(function(issues){ state.bugs = issues; });
  }
  function alert_(msg){ // без window.alert (не поддерживается в некоторых встроенных вьюерах) — просто баннер
    var b = document.getElementById("runStatusBanner");
    setBanner(b, "err", esc(msg));
    selectTab("run");
  }
  window.__qaToggleBug = function(number, next, el){ toggleBugState(number, next, el); };

  function renderBugs(){
    var list = document.getElementById("bugsList");
    var empty = document.getElementById("bugsEmpty");
    var emptyTitle = document.getElementById("bugsEmptyTitle");
    var filtered = state.bugs.filter(function(b){ return state.bugFilter === "all" ? true : b.state === state.bugFilter; });
    if (!filtered.length){
      list.innerHTML = "";
      empty.hidden = false;
      emptyTitle.textContent = state.bugFilter === "closed" ? "No fixed bugs yet" : (state.bugFilter === "all" ? "No bugs logged yet" : "No open bugs");
      return;
    }
    empty.hidden = true;
    list.innerHTML = filtered.map(function(b){
      var body = b.body || "";
      var catMatch = body.match(/\*\*Category:\*\*\s*(\S+)/);
      var shotMatch = body.match(/!\[screenshot\]\(([^)]+)\)/);
      var videoMatch = body.match(/\[▶ Watch recording[^\]]*\]\(([^)]+)\)/);
      var isOpen = b.state === "open";
      var shot = shotMatch ? ('<div class="shot"><img src="'+esc(shotMatch[1])+'" alt="Screenshot for: '+esc(b.title)+'" loading="lazy" onclick="window.__qaOpenShot(\''+esc(shotMatch[1]).replace(/'/g,"&#39;")+'\')" onerror="this.closest(\'.shot\').remove()"></div>') : "";
      return '<div class="bug">' + shot +
        '<div class="bug-main">' +
          '<div class="bug-top">' +
            (catMatch ? '<span class="bug-cat mono">'+esc(categoryName(catMatch[1]))+'</span>' : '') +
            '<span class="bug-title"><a href="'+esc(b.html_url)+'" target="_blank" rel="noopener">'+esc(b.title)+'</a></span>' +
          '</div>' +
          (videoMatch ? '<a class="clip-link" href="'+esc(videoMatch[1])+'" target="_blank" rel="noopener">▶ Watch recording</a>' : '') +
          '<div class="bug-meta mono">'+ (isOpen ? "open" : "fixed") + ' · #'+b.number+' · '+fmtDate(b.created_at) + '</div>' +
        '</div>' +
        '<div class="bug-actions">' +
          '<button class="btn small" onclick="window.__qaToggleBug('+b.number+',\''+(isOpen?"closed":"open")+'\',this)">'+(isOpen?"Mark fixed":"Reopen")+'</button>' +
        '</div>' +
      '</div>';
    }).join("");
  }

  /* --------------------------------------------------------- history */
  function loadHistory(){
    gh("/repos/"+OWNER+"/"+REPO+"/actions/workflows/"+WORKFLOW_FILE+"/runs?per_page=30").then(function(data){
      state.runs = data.workflow_runs || [];
      state.historyLoaded = true;
      renderHistory();
    }).catch(function(err){
      document.getElementById("historyEmpty").hidden = false;
      document.getElementById("historyEmpty").querySelector("p").textContent = err.message;
    });
  }
  function statusPillClass(run){
    if (run.status !== "completed") return "skip";
    return run.conclusion === "success" ? "good" : "bad";
  }
  function statusPillText(run){
    if (run.status !== "completed") return run.status;
    return run.conclusion;
  }
  function renderHistory(){
    var empty = document.getElementById("historyEmpty");
    var wrap = document.getElementById("historyTableWrap");
    if (!state.runs.length){ empty.hidden = false; wrap.hidden = true; return; }
    empty.hidden = true; wrap.hidden = false;
    document.getElementById("historyBody").innerHTML = state.runs.map(function(r){
      var duration = r.updated_at && r.run_started_at
        ? Math.round((new Date(r.updated_at) - new Date(r.run_started_at)) / 60000) + "m"
        : "–";
      return '<tr>' +
        '<td class="mono">'+esc(fmtDate(r.created_at))+'</td>' +
        '<td class="mono">#'+r.run_number+'</td>' +
        '<td>'+esc(r.triggering_actor ? r.triggering_actor.login : "–")+'</td>' +
        '<td><span class="pill '+statusPillClass(r)+'">'+esc(statusPillText(r))+'</span></td>' +
        '<td class="mono">'+duration+'</td>' +
        '<td><a href="'+esc(r.html_url)+'" target="_blank" rel="noopener">view</a></td>' +
      '</tr>';
    }).join("");
  }

  /* -------------------------------------------------------------- boot */
  function showApp(user){
    document.getElementById("gate").hidden = true;
    document.getElementById("app").hidden = false;
    var who = document.getElementById("whoBox");
    who.innerHTML = '<img src="'+esc(user.avatar_url)+'" alt=""><span>'+esc(user.login)+'</span>';
    document.getElementById("logBugLink").href = "https://github.com/"+OWNER+"/"+REPO+"/issues/new?labels=qa-bug&title=" + encodeURIComponent("QA: ");
    var saved = null;
    try{ saved = localStorage.getItem("imagenQaRuns.tab"); }catch(e){}
    selectTab(saved && panels[saved] ? saved : "run");
    renderHeader();
  }

  document.getElementById("signInBtn").addEventListener("click", beginSignIn);
  document.getElementById("signOutBtn").addEventListener("click", function(){ clearToken(); location.reload(); });

  handleOAuthCallback().then(function(tokenFromCallback){
    if (tokenFromCallback) setToken(tokenFromCallback);
    var token = getToken();
    if (!token){ return; } // остаёмся на экране входа
    return gh("/user").then(function(user){
      return gh("/repos/"+OWNER+"/"+REPO).then(function(repo){
        showApp(user);
      }).catch(function(err){
        showGateMessage(
          err.status === 404
            ? "Signed in as " + user.login + ", but this account has no access to " + OWNER + "/" + REPO + ". Ask for repo access, then reload."
            : "Couldn't reach the repository: " + err.message
        );
      });
    }).catch(function(err){
      clearToken();
      showGateMessage("Session expired or invalid — sign in again.");
    });
  });
})();
