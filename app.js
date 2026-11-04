(() => {
  const COLS = 6, ROWS = 5, PER_BOX = COLS * ROWS;
  const STATS = [
    ["HP", "HP", "#e8453c"], ["Attack", "Attack", "#f08a30"], ["Defense", "Defense", "#f2c230"],
    ["Sp_Atk", "Sp. Atk", "#5a8fe0"], ["Sp_Def", "Sp. Def", "#6cc36a"], ["Speed", "Speed", "#e866a8"],
  ];
  const GAMES = ["Alpha Sapphire", "Omega Ruby", "Y", "X"];

  const $ = (id) => document.getElementById(id);
  const grid = $("grid");
  const info = $("info");
  const toast = $("toast");
  const syncBtn = $("syncBtn");
  const syncDot = $("syncDot");
  const syncText = $("syncText");
  const syncModal = $("syncModal");
  const closeModalBtn = $("closeModalBtn");
  const syncForm = $("syncForm");
  const ghRepoInput = $("ghRepo");
  const ghBranchInput = $("ghBranch");
  const ghTokenInput = $("ghToken");
  const clearSyncBtn = $("clearSyncBtn");
  const localServerNotice = $("localServerNotice");
  const boxSlider = $("boxSlider");
  const sliderFill = $("sliderFill");
  const sliderStops = $("sliderStops");
  const locationModal = $("locationModal");
  const locModalTitle = $("locModalTitle");
  const locModalSubtitle = $("locModalSubtitle");
  const closeLocModalBtn = $("closeLocModalBtn");
  const locModalTabs = $("locModalTabs");
  const locModalList = $("locModalList");

  let pokemon = [];
  let caughtSet = new Set();
  let boxCount = 0;
  let current = Math.max(0, parseInt(localStorage.getItem("gen6box") || "0", 10) || 0);
  let infoFor = null;
  let selected = null;
  const touchMode = window.matchMedia("(hover: none)").matches;

  let syncMode = "offline"; // "local" | "github" | "offline"
  let ghSha = null;
  let saveChain = Promise.resolve();

  const isCaught = (p) => caughtSet.has(parseInt(p.Ndex, 10));

  function showToast(msg) {
    toast.textContent = msg;
    toast.style.display = "block";
    clearTimeout(showToast.t);
    showToast.t = setTimeout(() => (toast.style.display = "none"), 3500);
  }

  function setSyncStatus(status, text, tooltip) {
    syncDot.className = "sync-dot " + (status || "offline");
    syncText.textContent = text || "Sync";
    syncBtn.title = tooltip || text || "";
  }

  function parseLocation(text) {
    if (!text) return { game: "Alpha Sapphire", where: "Unknown" };
    if (text.startsWith("Unobtainable")) return { game: null, where: text, unobtainable: true };
    for (const g of GAMES) {
      if (text.startsWith(g + ": ")) return { game: g, where: text.slice(g.length + 2) };
    }
    return { game: "Alpha Sapphire", where: text };
  }

  const isAlphaSapphire = (p) => parseLocation(p.Location).game === "Alpha Sapphire";

  function compactRoutes(text) {
    if (!text) return "";
    return text.split(" / ").map((part) => {
      const out = [];
      let nums = [];
      const flush = () => {
        if (!nums.length) return;
        if (nums.length === 1) {
          out.push("Route " + nums[0]);
        } else {
          const ranges = [];
          let start = nums[0], prev = nums[0];
          for (let i = 1; i <= nums.length; i++) {
            const n = nums[i];
            if (n === prev + 1) { prev = n; continue; }
            ranges.push(start === prev ? String(start) : `${start}–${prev}`);
            start = n; prev = n;
          }
          out.push("Routes " + ranges.join(", "));
        }
        nums = [];
      };
      for (const tok of part.split(", ")) {
        const m = tok.match(/^Route (\d+)$/);
        if (m) nums.push(parseInt(m[1], 10));
        else if (nums.length && /^\d+$/.test(tok)) nums.push(parseInt(tok, 10));
        else { flush(); out.push(tok); }
      }
      flush();
      return out.join(", ");
    }).join(" / ");
  }

  function extractLocations(p) {
    if (!p || !p.Location) return [];
    let s = p.Location.trim();
    if (s.startsWith("Unobtainable")) {
      return ["Unobtainable"];
    }
    for (const g of GAMES) {
      if (s.startsWith(g + ": ")) {
        s = s.slice(g.length + 2).trim();
        break;
      }
    }
    const chunks = s.split(" / ").map((c) => c.trim()).filter(Boolean);
    const tokens = [];
    for (const chunk of chunks) {
      const parts = chunk.split(", ").map((sp) => sp.trim()).filter(Boolean);
      let lastRoute = null;
      for (const part of parts) {
        const mRoute = part.match(/^Route\s+(\d+)$/i);
        const mNum = part.match(/^(\d+)$/);
        if (mRoute) {
          lastRoute = parseInt(mRoute[1], 10);
          tokens.push(`Route ${lastRoute}`);
        } else if (mNum && lastRoute !== null) {
          lastRoute = parseInt(mNum[1], 10);
          tokens.push(`Route ${lastRoute}`);
        } else if (part.toLowerCase().startsWith("from professor birch in")) {
          continue;
        } else {
          lastRoute = null;
          tokens.push(part);
        }
      }
    }
    const res = [];
    const seen = new Set();
    for (const t of tokens) {
      if (!seen.has(t)) {
        seen.add(t);
        res.push(t);
      }
    }
    return res;
  }

  function findPokemonForLocation(locName) {
    if (!locName) return [];
    const target = locName.trim().toLowerCase();
    const isRoute = /^route\s+\d+$/i.test(target);
    return pokemon.filter((p) => {
      const tokens = extractLocations(p).map((t) => t.toLowerCase());
      if (tokens.includes(target)) return true;
      if (isRoute) return false;
      let raw = p.Location || "";
      for (const g of GAMES) {
        if (raw.startsWith(g + ": ")) {
          raw = raw.slice(g.length + 2);
          break;
        }
      }
      return raw.toLowerCase().includes(target);
    });
  }

  // ---- Grid & Info Panel ------------------------------------------------
  function renderGrid() {
    grid.replaceChildren();
    const start = current * PER_BOX;
    for (let i = 0; i < PER_BOX; i++) {
      const p = pokemon[start + i];
      const cell = document.createElement("div");
      if (!p) {
        cell.className = "cell empty";
        grid.appendChild(cell);
        continue;
      }
      cell.className = "cell " + (isCaught(p) ? "caught" : "uncaught") +
        (isAlphaSapphire(p) ? "" : " not-as") + (p === selected ? " selected" : "");
      cell.dataset.ndex = p.Ndex;
      cell.tabIndex = 0;
      cell.setAttribute("role", "button");
      cell.setAttribute("aria-label", `${p.Pokemon} #${p.Ndex}`);

      const img = document.createElement("img");
      img.src = `icons/${p.Ndex}.png`;
      img.alt = p.Pokemon;
      img.loading = "lazy";
      cell.appendChild(img);

      const ball = document.createElement("span");
      ball.className = "ball";
      cell.appendChild(ball);

      const num = document.createElement("span");
      num.className = "num";
      num.textContent = p.Ndex;
      cell.appendChild(num);

      if (!touchMode) {
        cell.addEventListener("mouseenter", () => showInfo(p));
        cell.addEventListener("focus", () => showInfo(p));
      }
      cell.addEventListener("click", () => onTap(p));
      cell.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          toggleCaught(p);
        }
      });
      grid.appendChild(cell);
    }

    const first = start + 1, last = Math.min(start + PER_BOX, pokemon.length);
    $("boxName").textContent = `BOX ${current + 1}`;
    $("boxRange").textContent = `#${String(first).padStart(3, "0")} – #${String(last).padStart(3, "0")}`;
    $("prev").disabled = current === 0;
    $("next").disabled = current === boxCount - 1;
    updateSliderState();
    renderTotals();
  }

  function onTap(p) {
    if (touchMode && selected !== p) {
      showInfo(p);
      return;
    }
    toggleCaught(p);
  }

  function boxStats(b) {
    const slice = pokemon.slice(b * PER_BOX, (b + 1) * PER_BOX);
    return { caught: slice.filter(isCaught).length, size: slice.length };
  }

  function setupBoxSlider() {
    if (!boxSlider || boxCount <= 0) return;
    boxSlider.min = "1";
    boxSlider.max = String(boxCount);
    boxSlider.value = String(current + 1);

    if (sliderStops) {
      sliderStops.replaceChildren();
      for (let b = 0; b < boxCount; b++) {
        const pct = boxCount > 1 ? (b / (boxCount - 1)) * 100 : 0;
        const stop = document.createElement("span");
        stop.className = "slider-stop";
        stop.style.left = `${pct}%`;
        stop.dataset.box = String(b);
        sliderStops.appendChild(stop);
      }
    }

    updateSliderState();
  }

  function updateSliderState() {
    if (!boxSlider) return;
    const targetVal = String(current + 1);
    if (boxSlider.value !== targetVal) {
      boxSlider.value = targetVal;
    }
    boxSlider.setAttribute("aria-valuenow", targetVal);
    boxSlider.setAttribute("aria-valuetext", `Box ${targetVal}`);

    if (sliderFill && boxCount > 1) {
      sliderFill.style.width = `${(current / (boxCount - 1)) * 100}%`;
    }

    if (sliderStops) {
      const stops = sliderStops.children;
      for (let i = 0; i < stops.length; i++) {
        const s = stops[i];
        const b = parseInt(s.dataset.box, 10);
        const stats = boxStats(b);
        s.classList.toggle("done", stats.caught === stats.size);
      }
    }
  }

  function renderTotals() {
    const totalCountEl = $("totalCount");
    const obtainableCountEl = $("obtainableCount");
    if (!totalCountEl || !obtainableCountEl || !pokemon.length) return;

    let caughtTotal = 0;
    let asTotal = 0;
    let asCaught = 0;

    for (let i = 0; i < pokemon.length; i++) {
      const p = pokemon[i];
      const caught = isCaught(p);
      if (caught) caughtTotal++;
      if (isAlphaSapphire(p)) {
        asTotal++;
        if (caught) asCaught++;
      }
    }

    obtainableCountEl.textContent = `${asCaught}/${asTotal}`;
    totalCountEl.textContent = `${caughtTotal}/${pokemon.length}`;
  }

  function goTo(b) {
    current = Math.min(Math.max(0, b), boxCount - 1);
    localStorage.setItem("gen6box", String(current));
    renderGrid();
  }

  function kvRow(table, label, value, cls) {
    const tr = table.insertRow();
    const th = document.createElement("th");
    th.textContent = label;
    tr.appendChild(th);
    const td = tr.insertCell();
    td.textContent = value;
    if (cls) td.className = cls;
    return tr;
  }

  function showInfo(p) {
    infoFor = p;
    selected = p;
    localStorage.setItem("gen6ndex", p.Ndex);
    grid.querySelectorAll(".cell.selected").forEach((c) => c.classList.remove("selected"));
    if (document.activeElement && document.activeElement.classList && document.activeElement.classList.contains("cell") && document.activeElement.dataset.ndex !== p.Ndex) {
      document.activeElement.blur();
    }
    if (touchMode) {
      const activeCell = grid.querySelector(`.cell[data-ndex="${p.Ndex}"]`);
      if (activeCell) activeCell.classList.add("selected");
    }
    info.className = "";
    info.replaceChildren();

    const head = document.createElement("div");
    head.className = "head";
    const img = document.createElement("img");
    img.src = `icons/${p.Ndex}.png`;
    img.alt = "";
    const names = document.createElement("div");
    const nm = document.createElement("div");
    nm.className = "nm"; nm.textContent = p.Pokemon;
    const dex = document.createElement("div");
    dex.className = "dex"; dex.textContent = `No. ${p.Ndex}`;
    const tot = document.createElement("span");
    tot.className = "tot"; tot.textContent = ` · Total ${p.Total}`;
    dex.appendChild(tot);
    names.append(nm, dex);
    const badge = document.createElement("button");
    badge.type = "button";
    badge.id = "badge";
    badge.addEventListener("click", () => toggleCaught(p));
    head.append(img, names, badge);
    info.appendChild(head);
    updateBadge();

    const body = document.createElement("div");
    body.className = "body";

    const locCol = document.createElement("div");
    const locSec = document.createElement("div");
    locSec.className = "sec"; locSec.textContent = "Location";
    const lt = document.createElement("table");
    lt.className = "kv";
    const loc = parseLocation(p.Location);
    if (loc.game) {
      const lg = document.createElement("span");
      lg.className = "loc-game";
      lg.textContent = " · " + (loc.game.length === 1 ? "Pokémon " : "") + loc.game;
      locSec.appendChild(lg);
    }
    const renderLocationField = (td) => {
      const box = document.createElement("div");
      box.className = "where-scroll";
      const locTokens = extractLocations(p);

      if (loc.unobtainable) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "loc-tag unob";
        btn.textContent = loc.where;
        btn.title = "Click to view Unobtainable Pokémon";
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          openLocationModal("Unobtainable", p);
        });
        box.appendChild(btn);
        td.replaceChildren(box);
        td.title = "Click to view Unobtainable Pokémon";
        td.addEventListener("click", () => openLocationModal("Unobtainable", p));
        return;
      }

      if (!locTokens.length) {
        const span = document.createElement("span");
        span.textContent = loc.where || "Unknown";
        box.appendChild(span);
        td.replaceChildren(box);
        return;
      }

      const whereLower = (loc.where || "").toLowerCase();
      if (whereLower.startsWith("from professor birch in")) {
        const pfx = document.createElement("span");
        pfx.className = "loc-prefix";
        pfx.textContent = "From Professor Birch in: ";
        box.appendChild(pfx);
      }

      locTokens.forEach((tok) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "loc-tag";
        btn.textContent = tok;
        btn.title = `Click to view Pokémon in ${tok}`;
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          openLocationModal(tok, p);
        });
        box.appendChild(btn);
      });

      td.replaceChildren(box);
      td.title = `Click to view Pokémon in ${locTokens[0]}`;
      td.addEventListener("click", () => openLocationModal(locTokens[0], p));
    };

    if (loc.unobtainable) {
      const td = lt.insertRow().insertCell();
      td.colSpan = 2; td.className = "unob";
      renderLocationField(td);
    } else {
      kvRow(lt, "Game", "Pokémon " + loc.game).className = "game-row";
      const wr = kvRow(lt, "Where", "");
      wr.className = "where-row";
      wr.cells[0].style.cursor = "pointer";
      wr.cells[0].title = "Click to view location";
      wr.cells[0].addEventListener("click", () => {
        const tokens = extractLocations(p);
        if (tokens.length) openLocationModal(tokens[0], p);
      });
      renderLocationField(wr.cells[1]);
      if (loc.game !== "Alpha Sapphire") {
        kvRow(lt, "Note", "Not available in Alpha Sapphire").className = "note-row";
      }
    }
    locCol.append(locSec, lt);

    const statCol = document.createElement("div");
    const statSec = document.createElement("div");
    statSec.className = "sec stat-sec"; statSec.textContent = "Base stats";
    const st = document.createElement("div");
    st.className = "stats";
    const addStat = (label, value, color, cls) => {
      const item = document.createElement("div");
      item.className = "stat" + (cls ? " " + cls : "");
      const lab = document.createElement("div");
      lab.className = "lab"; lab.textContent = label;
      item.appendChild(lab);
      if (color) {
        const wrap = document.createElement("div");
        wrap.className = "barwrap";
        const bar = document.createElement("div"); bar.className = "bar";
        const fill = document.createElement("span");
        fill.style.width = Math.min(100, (value / 255) * 100) + "%";
        fill.style.background = color;
        bar.appendChild(fill); wrap.appendChild(bar);
        item.appendChild(wrap);
      }
      const val = document.createElement("div");
      val.className = "val"; val.textContent = value;
      item.appendChild(val);
      st.appendChild(item);
    };
    for (const [key, label, color] of STATS) addStat(label, parseInt(p[key], 10), color);
    addStat("Total", p.Total, null, "total");
    statCol.append(statSec, st);

    body.append(locCol, statCol);
    info.appendChild(body);
  }

  function updateBadge() {
    const badge = $("badge");
    if (!badge || !infoFor) return;
    const c = isCaught(infoFor);
    badge.className = "badge" + (c ? " caught" : "");
    badge.textContent = c ? "● Caught" : "○ Not caught";
  }

  function refreshCaughtUI(p) {
    const cell = grid.querySelector(`.cell[data-ndex="${p.Ndex}"]`);
    if (cell) {
      const c = isCaught(p);
      cell.classList.toggle("caught", c);
      cell.classList.toggle("uncaught", !c);
    }
    if (infoFor === p) updateBadge();
    updateSliderState();
    renderTotals();
  }

  // ---- Toggling & Syncing -----------------------------------------------
  function toggleCaught(p) {
    const id = parseInt(p.Ndex, 10);
    const desired = !caughtSet.has(id);
    if (desired) {
      caughtSet.add(id);
    } else {
      caughtSet.delete(id);
    }

    // Persist to local browser storage immediately
    try {
      localStorage.setItem("gen6_caught", JSON.stringify(Array.from(caughtSet)));
    } catch (e) {}

    refreshCaughtUI(p);

    saveChain = saveChain.then(async () => {
      if (syncMode === "local") {
        setSyncStatus("saving", "Saving...", "Saving to local caught.json");
        try {
          const res = await fetch("/api/caught", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ndex: id, caught: desired }),
          });
          if (!res.ok) throw new Error("HTTP " + res.status);
          const data = await res.json();
          if (!data.ok) throw new Error(data.error || "Save failed");
          setSyncStatus("synced", "Local Server", "Saved to local caught.json");
        } catch (e) {
          setSyncStatus("error", "Local Error", e.message);
          showToast("Local save error: " + e.message);
        }
      } else if (syncMode === "github") {
        setSyncStatus("saving", "Syncing...", "Pushing caught.json to GitHub");
        try {
          await pushCaughtToGitHub();
          setSyncStatus("synced", "GitHub Synced", "Changes synced to GitHub");
        } catch (e) {
          setSyncStatus("error", "Sync Error", e.message);
          showToast("GitHub sync error: " + e.message);
        }
      } else {
        setSyncStatus("offline", "Saved Locally", "Saved in browser. Click Sync to configure GitHub.");
      }
    });
  }

  function normalizeRepo(input) {
    if (!input) return "";
    let r = input.trim();
    r = r.replace(/^https?:\/\/github\.com\//, "");
    r = r.replace(/^git@github\.com:/, "");
    r = r.replace(/\.git$/, "");
    r = r.replace(/^\/+|\/+$/g, "");
    return r;
  }

  // ---- GitHub API Integration ------------------------------------------
  async function fetchGitHubCaught(repo, branch, token) {
    const url = `https://api.github.com/repos/${repo}/contents/caught.json?ref=${encodeURIComponent(branch || "main")}`;
    const res = await fetch(url, {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
      },
    });
    if (res.status === 404) {
      return { sha: null, caught: [] };
    }
    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.message || `GitHub error ${res.status}`);
    }
    const data = await res.json();
    let parsed = { caught: [] };
    if (data.content) {
      try {
        const decoded = decodeURIComponent(escape(atob(data.content.replace(/\n/g, ""))));
        parsed = JSON.parse(decoded);
      } catch (e) {
        console.warn("Could not decode caught.json from GitHub", e);
      }
    }
    return { sha: data.sha, caught: Array.isArray(parsed.caught) ? parsed.caught : [] };
  }

  async function pushCaughtToGitHub() {
    const repo = localStorage.getItem("gen6_gh_repo");
    const branch = localStorage.getItem("gen6_gh_branch") || "main";
    const token = localStorage.getItem("gen6_gh_token");
    if (!repo || !token) throw new Error("Missing GitHub repository or token");

    if (!ghSha) {
      const info = await fetchGitHubCaught(repo, branch, token);
      ghSha = info.sha;
    }

    const sortedCaught = Array.from(caughtSet).sort((a, b) => a - b);
    const jsonStr = JSON.stringify({ caught: sortedCaught }, null, 2) + "\n";
    const contentB64 = btoa(unescape(encodeURIComponent(jsonStr)));

    const url = `https://api.github.com/repos/${repo}/contents/caught.json`;
    const payload = {
      message: `Update caught Pokémon (${sortedCaught.length}/721)`,
      content: contentB64,
      branch: branch,
    };
    if (ghSha) payload.sha = ghSha;

    let res = await fetch(url, {
      method: "PUT",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (res.status === 409) {
      // Conflict: SHA out of date; refetch latest and retry once
      const info = await fetchGitHubCaught(repo, branch, token);
      ghSha = info.sha;
      if (ghSha) payload.sha = ghSha;
      res = await fetch(url, {
        method: "PUT",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
    }

    if (!res.ok) {
      const errJson = await res.json().catch(() => ({}));
      throw new Error(errJson.message || `GitHub error ${res.status}`);
    }

    const data = await res.json();
    if (data.content && data.content.sha) {
      ghSha = data.content.sha;
    }
  }

  // ---- Modal Handling --------------------------------------------------
  function openSyncModal() {
    ghRepoInput.value = localStorage.getItem("gen6_gh_repo") || "";
    ghBranchInput.value = localStorage.getItem("gen6_gh_branch") || "main";
    ghTokenInput.value = localStorage.getItem("gen6_gh_token") || "";

    // If repo is empty and hosted on github.io, auto-fill reasonable default
    if (!ghRepoInput.value && window.location.hostname.endsWith(".github.io")) {
      const owner = window.location.hostname.split(".")[0];
      const pathParts = window.location.pathname.split("/").filter(Boolean);
      const repoName = pathParts[0] || "national_dex_as";
      ghRepoInput.value = `${owner}/${repoName}`;
    }

    if (syncMode === "local") {
      localServerNotice.classList.remove("hidden");
    } else {
      localServerNotice.classList.add("hidden");
    }
    syncModal.classList.remove("hidden");
  }

  function closeSyncModal() {
    syncModal.classList.add("hidden");
  }

  // ---- Location Modal ---------------------------------------------------
  function openLocationModal(locName, sourcePokemon) {
    if (!locName) return;
    locModalTitle.textContent = locName;
    locModalTitle.title = locName;

    const source = sourcePokemon || selected || infoFor;
    const allTokens = source ? extractLocations(source) : [];

    // Render tabs if source has multiple locations
    if (allTokens.length > 1) {
      locModalTabs.replaceChildren();
      allTokens.forEach((tok) => {
        const tabBtn = document.createElement("button");
        tabBtn.type = "button";
        tabBtn.className = "loc-tab-btn" + (tok.toLowerCase() === locName.toLowerCase() ? " active" : "");
        tabBtn.textContent = tok;
        tabBtn.addEventListener("click", () => openLocationModal(tok, source));
        locModalTabs.appendChild(tabBtn);
      });
      locModalTabs.classList.remove("hidden");
    } else {
      locModalTabs.replaceChildren();
      locModalTabs.classList.add("hidden");
    }

    const matches = findPokemonForLocation(locName);

    const updateSubtitle = () => {
      const caughtCount = matches.filter(isCaught).length;
      locModalSubtitle.textContent = `${matches.length} Pokémon · ${caughtCount} caught`;
    };
    updateSubtitle();

    locModalList.replaceChildren();

    if (!matches.length) {
      const empty = document.createElement("div");
      empty.className = "loc-item-empty";
      empty.textContent = "No Pokémon found for this location.";
      locModalList.appendChild(empty);
    } else {
      matches.forEach((p) => {
        const item = document.createElement("div");
        item.className = "loc-item" + (source && p.Ndex === source.Ndex ? " current" : "");
        item.tabIndex = 0;
        item.setAttribute("role", "button");
        item.setAttribute("aria-label", `Reveal ${p.Pokemon} #${p.Ndex}`);

        const left = document.createElement("div");
        left.className = "loc-item-left";

        const img = document.createElement("img");
        img.className = "loc-item-sprite";
        img.src = `icons/${p.Ndex}.png`;
        img.alt = "";
        img.loading = "lazy";

        const dex = document.createElement("span");
        dex.className = "loc-item-dex";
        dex.textContent = `#${p.Ndex}`;

        const name = document.createElement("span");
        name.className = "loc-item-name";
        name.textContent = p.Pokemon;

        left.append(img, dex, name);

        const badge = document.createElement("button");
        badge.type = "button";
        const c = isCaught(p);
        badge.className = "loc-item-badge" + (c ? " caught" : "");
        badge.textContent = c ? "● Caught" : "○ Not caught";
        badge.setAttribute("aria-label", `${c ? "Mark uncaught" : "Mark caught"}: ${p.Pokemon}`);
        badge.addEventListener("click", (e) => {
          e.stopPropagation();
          toggleCaught(p);
          const nowCaught = isCaught(p);
          badge.className = "loc-item-badge" + (nowCaught ? " caught" : "");
          badge.textContent = nowCaught ? "● Caught" : "○ Not caught";
          badge.setAttribute("aria-label", `${nowCaught ? "Mark uncaught" : "Mark caught"}: ${p.Pokemon}`);
          updateSubtitle();
        });

        item.append(left, badge);

        item.addEventListener("click", () => revealPokemon(p));
        item.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            revealPokemon(p);
          }
        });

        locModalList.appendChild(item);
      });
    }

    locationModal.classList.remove("hidden");
  }

  function closeLocationModal() {
    locationModal.classList.add("hidden");
  }

  function revealPokemon(p) {
    const idx = pokemon.indexOf(p);
    if (idx !== -1) {
      const boxIdx = Math.floor(idx / PER_BOX);
      goTo(boxIdx);
      showInfo(p);
      const activeCell = grid.querySelector(`.cell[data-ndex="${p.Ndex}"]`);
      if (activeCell) {
        activeCell.classList.add("selected");
        activeCell.focus({ preventScroll: true });
      }
    }
    closeLocationModal();
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  closeLocModalBtn.addEventListener("click", closeLocationModal);
  locationModal.addEventListener("click", (e) => {
    if (e.target === locationModal) closeLocationModal();
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!locationModal.classList.contains("hidden")) {
        closeLocationModal();
      } else if (!syncModal.classList.contains("hidden")) {
        closeSyncModal();
      }
    }
  });

  syncBtn.addEventListener("click", openSyncModal);
  closeModalBtn.addEventListener("click", closeSyncModal);
  syncModal.addEventListener("click", (e) => {
    if (e.target === syncModal) closeSyncModal();
  });

  clearSyncBtn.addEventListener("click", () => {
    localStorage.removeItem("gen6_gh_repo");
    localStorage.removeItem("gen6_gh_branch");
    localStorage.removeItem("gen6_gh_token");
    ghSha = null;
    if (syncMode === "github") {
      syncMode = "offline";
      setSyncStatus("offline", "Sync", "Click to configure GitHub sync");
    }
    showToast("GitHub sync settings cleared.");
    closeSyncModal();
  });

  syncForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const repo = normalizeRepo(ghRepoInput.value);
    const branch = ghBranchInput.value.trim() || "main";
    const token = ghTokenInput.value.trim();

    if (!repo || !token) {
      showToast("Please enter both repository and token.");
      return;
    }

    if (!repo.includes("/")) {
      showToast("Repository must be in 'owner/repo' format (e.g. doomsdaykidney/national_dex_as).");
      return;
    }

    setSyncStatus("saving", "Connecting...", "Validating GitHub credentials");
    try {
      const info = await fetchGitHubCaught(repo, branch, token);
      ghSha = info.sha;

      localStorage.setItem("gen6_gh_repo", repo);
      localStorage.setItem("gen6_gh_branch", branch);
      localStorage.setItem("gen6_gh_token", token);

      // Merge GitHub caught list with current in-memory caught set
      let changed = false;
      for (const id of info.caught) {
        const num = Number(id);
        if (num && !caughtSet.has(num)) {
          caughtSet.add(num);
          changed = true;
        }
      }

      syncMode = "github";
      setSyncStatus("synced", "GitHub Synced", `Connected to ${repo} (${branch})`);
      closeSyncModal();
      showToast("Connected to GitHub!");

      if (changed) {
        localStorage.setItem("gen6_caught", JSON.stringify(Array.from(caughtSet)));
        renderGrid();
        if (infoFor) showInfo(infoFor);
      } else {
        // If local had additions not on GitHub, sync them now
        await pushCaughtToGitHub();
      }
    } catch (err) {
      setSyncStatus("error", "GitHub Error", err.message);
      showToast("GitHub connection failed: " + err.message);
    }
  });

  // ---- Navigation & Gestures -------------------------------------------
  $("prev").addEventListener("click", () => goTo(current - 1));
  $("next").addEventListener("click", () => goTo(current + 1));

  if (boxSlider) {
    boxSlider.addEventListener("input", () => {
      const b = parseInt(boxSlider.value, 10) - 1;
      if (b !== current) {
        goTo(b);
      }
    });
    boxSlider.addEventListener("change", () => {
      const b = parseInt(boxSlider.value, 10) - 1;
      if (b !== current) {
        goTo(b);
      }
    });
  }

  let swipeStart = null;
  grid.addEventListener("touchstart", (e) => {
    const t = e.changedTouches[0];
    swipeStart = { x: t.clientX, y: t.clientY };
  }, { passive: true });
  grid.addEventListener("touchend", (e) => {
    if (!swipeStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - swipeStart.x, dy = t.clientY - swipeStart.y;
    swipeStart = null;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 40) goTo(current + (dx < 0 ? 1 : -1));
  }, { passive: true });

  document.addEventListener("keydown", (e) => {
    if (e.target && (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA")) return;
    if (e.key === "ArrowLeft") goTo(current - 1);
    if (e.key === "ArrowRight") goTo(current + 1);
  });

  // ---- App Initialization ----------------------------------------------
  async function init() {
    // 1. Fetch immutable Pokémon Pokédex data
    try {
      const res = await fetch("pokemon.json");
      if (!res.ok) throw new Error("HTTP " + res.status);
      const data = await res.json();
      pokemon = data.pokemon || [];
      boxCount = Math.ceil(pokemon.length / PER_BOX);
      current = Math.min(current, Math.max(0, boxCount - 1));
      setupBoxSlider();
    } catch (e) {
      const err = $("err");
      err.style.display = "block";
      err.textContent = "Could not load pokemon.json (" + e.message + ").";
      return;
    }

    // 2. Load caught data from local server or caught.json / localStorage
    let isLocalServer = false;
    try {
      const localRes = await fetch("/api/local", { cache: "no-store" });
      if (localRes.ok) {
        const localData = await localRes.json();
        if (localData.local_server) {
          isLocalServer = true;
          syncMode = "local";
          setSyncStatus("synced", "Local Server", "Connected to local server. Saves directly to caught.json");
          if (Array.isArray(localData.caught)) {
            caughtSet = new Set(localData.caught.map(Number));
          }
        }
      }
    } catch (e) {
      // Local server not running; fall back to GitHub Pages mode
    }

    if (!isLocalServer) {
      // Load from localStorage cache first
      try {
        const cached = localStorage.getItem("gen6_caught");
        if (cached) {
          const parsed = JSON.parse(cached);
          if (Array.isArray(parsed)) {
            caughtSet = new Set(parsed.map(Number));
          }
        }
      } catch (e) {}

      // Fetch static caught.json from repo
      try {
        const res = await fetch("caught.json", { cache: "no-store" });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data.caught)) {
            if (caughtSet.size === 0) {
              caughtSet = new Set(data.caught.map(Number));
            } else {
              data.caught.forEach((id) => caughtSet.add(Number(id)));
            }
          }
        }
      } catch (e) {}

      // Check if GitHub PAT sync is configured
      const ghRepo = localStorage.getItem("gen6_gh_repo");
      const ghToken = localStorage.getItem("gen6_gh_token");
      const ghBranch = localStorage.getItem("gen6_gh_branch") || "main";

      if (ghRepo && ghToken) {
        syncMode = "github";
        setSyncStatus("saving", "GitHub Sync", "Checking GitHub repository");
        fetchGitHubCaught(ghRepo, ghBranch, ghToken)
          .then((info) => {
            ghSha = info.sha;
            let merged = false;
            for (const id of info.caught) {
              const num = Number(id);
              if (num && !caughtSet.has(num)) {
                caughtSet.add(num);
                merged = true;
              }
            }
            setSyncStatus("synced", "GitHub Synced", `Connected to ${ghRepo} (${ghBranch})`);
            if (merged) {
              localStorage.setItem("gen6_caught", JSON.stringify(Array.from(caughtSet)));
              renderGrid();
              if (infoFor) showInfo(infoFor);
            }
          })
          .catch((err) => {
            setSyncStatus("error", "GitHub Error", err.message);
          });
      } else {
        syncMode = "offline";
        setSyncStatus("offline", "Sync", "Click to configure GitHub sync");
      }
    }

    renderGrid();

    const savedNdex = localStorage.getItem("gen6ndex");
    const initial = (savedNdex && pokemon.find((p) => p.Ndex === savedNdex)) || pokemon[current * PER_BOX];
    if (initial) showInfo(initial);
  }

  init();
})();

