/* eslint-disable no-console */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SUPABASE_URL, SUPABASE_ANON_KEY, FUNCTIONS_BASE } from "./config.js";

const state = {
  queue: "RANKED_SOLO_5x5",
  search: "",
  players: [],
  latest: new Map(), // key: player_id|queue -> latest row
  games: new Map(), // key: player_id|queue -> games json
  presence: new Map(), // key: player_id -> live status
  lastFetchAt: null,
  loading: false,
};

// DPM.LOL links (hardcoded)
const DPM_LINKS = {
  "Heroic Pol#POL": "https://dpm.lol/Heroic%20Pol-POL",
  "zankyos#help": "https://dpm.lol/zankyos-help",
  "Rominhood#999": "https://dpm.lol/Rominhood-999",
  "TheUndertaker#Ghoul": "https://dpm.lol/TheUndertaker-Ghoul",
  "Serial gooner#619": "https://dpm.lol/Serial%20gooner-619",
  "SwordofDemacia#SPIN": "https://dpm.lol/SwordofDemacia-SPIN",
  "Kappaguena#KAPPA": "https://dpm.lol/Kappaguena-KAPPA",
  "Sad Kermit cry#EUW": "https://dpm.lol/Sad%20Kermit%20cry-EUW",
  "Medium#mommy": "https://dpm.lol/Medium-mommy",
  "Talented Gambler#6969": "https://dpm.lol/Talented%20Gambler-6969",
  "Cargopin62#RedZN": "https://dpm.lol/Cargopin62-RedZN",
  "CaptainYordle#RedZN": "https://dpm.lol/CaptainYordle-RedZN",
  "ElBlobi#blob": "https://dpm.lol/ElBlobi-blob",
  "Chris Brown#EUW": "https://dpm.lol/Chris%20Br%CE%BFwn-EUW",
};

function formatRiotName(p) {
  const game = (p?.riot_game_name ?? p?.gameName ?? "").toString().trim();
  const tag = (p?.riot_tag_line ?? p?.tagLine ?? p?.riot_tag ?? "").toString().trim();
  if (game && tag) return `${game}#${tag}`;
  return game || "";
}

function getDpmLink(player) {
  const key = `${player.riot_game_name}#${player.riot_tag_line}`;
  return DPM_LINKS[key] ?? null;
}

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const $ = (id) => document.getElementById(id);

function setStatus(msg) {
  const el = $("status");
  if (el) el.textContent = msg;
}

function setStat(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function toast(msg, ms = 2400) {
  const el = $("toast");
  if (!el) return;
  el.textContent = msg;
  el.hidden = false;
  el.classList.remove("show");
  // force reflow
  void el.offsetWidth;
  el.classList.add("show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => {
    el.classList.remove("show");
    setTimeout(() => (el.hidden = true), 250);
  }, ms);
}

function banner(kind, title, text) {
  const b = $("banner");
  const t = $("bannerTitle");
  const x = $("bannerText");
  if (!b || !t || !x) return;
  b.hidden = false;
  b.dataset.kind = kind || "info";
  t.textContent = title || "Info";
  x.textContent = text || "";
}

function hideBanner() {
  const b = $("banner");
  if (b) b.hidden = true;
}

function fmtDate(d) {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      day: "2-digit",
      month: "2-digit",
    });
  } catch {
    return "—";
  }
}

function queueLabel(q) {
  return q === "RANKED_FLEX_SR" ? "Flex" : "SoloQ";
}

function tierScore(tier, div, lp) {
  // High -> low
  const tiers = [
    "CHALLENGER",
    "GRANDMASTER",
    "MASTER",
    "DIAMOND",
    "EMERALD",
    "PLATINUM",
    "GOLD",
    "SILVER",
    "BRONZE",
    "IRON",
  ];
  const divs = ["I", "II", "III", "IV"];
  const t = tier ? String(tier).toUpperCase() : "UNRANKED";
  const ti = tiers.indexOf(t);
  const base = ti === -1 ? -1 : tiers.length - ti;
  const di = div ? divs.indexOf(String(div).toUpperCase()) : 9;
  const dscore = di === -1 ? 0 : 4 - di;
  const lps = Number.isFinite(lp) ? lp : 0;
  return base * 1000 + dscore * 100 + lps;
}

function rankIconUrl(tier) {
  const t = String(tier || "unranked").toLowerCase();
  return `https://raw.communitydragon.org/latest/plugins/rcp-fe-lol-shared-components/global/default/${t}.png`;
}

function buildLast10Squares(gamesJson) {
  // Expect array of { win: true/false, ... }. Unknown -> black.
  const arr = Array.isArray(gamesJson) ? gamesJson : [];
  const last = arr.slice(0, 10);
  const squares = last
    .map((g) => {
      if (g && g.queue && g.queue !== state.queue) return "⬛";
      if (g && typeof g.win === "boolean") return g.win ? "🟩" : "🟥";
      return "⬛";
    })
    .join("");
  return squares || "—";
}

function computeWR(w, l) {
  const W = Number.isFinite(w) ? w : 0;
  const L = Number.isFinite(l) ? l : 0;
  const t = W + L;
  if (!t) return null;
  return Math.round((W / t) * 100);
}

function playerRow(p) {
  const key = `${p.id}|${state.queue}`;
  const latest = state.latest.get(key) || null;
  const games = state.games.get(key) || [];
  const pres = state.presence.get(p.id) || null;

  const tier = latest?.tier ?? null;
  const div = latest?.division ?? null;
  const lp = latest?.lp ?? null;
  const wins = latest?.wins ?? null;
  const losses = latest?.losses ?? null;
  const wr = computeWR(wins, losses);

  const rankLabel =
    tier && div
      ? `${tier} ${div}${lp != null ? ` • ${lp} LP` : ""}`
      : "Unranked";

  const wl = wins != null && losses != null ? `${wins} / ${losses}` : "—";
  const wrTxt = wr == null ? "—" : `${wr}%`;

  const last10 = buildLast10Squares(games);

  const score = tierScore(tier, div, lp);

  return {
    p,
    latest,
    pres,
    tier,
    div,
    lp,
    wins,
    losses,
    wr,
    rankLabel,
    wl,
    wrTxt,
    last10,
    score,
  };
}

function buildRows() {
  const q = String(state.search || "").trim().toLowerCase();
  let rows = state.players.map(playerRow);

  if (q) {
    rows = rows.filter((r) => r.p.display_name.toLowerCase().includes(q));
  }

  // keep sorted by elo (high -> low)
  rows.sort((a, b) => b.score - a.score);

  return rows;
}

function renderStats(rows) {
  setStat("statPlayers", String(rows.length));
  setStat("statQueue", queueLabel(state.queue));
  setStat("statRefresh", state.lastFetchAt ? fmtDate(state.lastFetchAt) : "—");
  setStatus(state.loading ? "Chargement…" : "OK");
}

function renderCards(rows) {
  const root = $("cardsView");
  if (!root) return;
  root.innerHTML = "";

  for (const r of rows) {
    const p = r.p;

    const card = document.createElement("div");
    card.className = "card";

    if (r.pres?.in_game) {
      card.classList.add("inGame");
    }

    const dpm = getDpmLink(p);
    if (dpm) {
      card.style.cursor = "pointer";
      card.title = "Ouvrir dpm.lol";
      card.addEventListener("click", (ev) => {
        const target = ev.target;
        if (target && target.closest && target.closest("button, a, input, select, textarea")) return;
        window.open(dpm, "_blank", "noopener,noreferrer");
      });
    }

    const head = document.createElement("div");
    head.className = "cardHead";

    const who = document.createElement("div");
    who.className = "who";

    const name = document.createElement("div");
    name.className = "name";
    name.textContent = (p.display_name && String(p.display_name).trim()) ? p.display_name : formatRiotName(p);

    const sub = document.createElement("div");
    sub.className = "sub";
    sub.textContent = formatRiotName(p);

    who.appendChild(name);
    who.appendChild(sub);

    if (r.pres?.in_game) {
      const badge = document.createElement("div");
      badge.className = "ingameBadge";
      badge.innerHTML = `<span class="dot" aria-hidden="true"></span><span class="txt">EN GAME</span>`;
      who.appendChild(badge);
    }

    const rank = document.createElement("div");
    rank.className = "rank";

    const icon = document.createElement("img");
    icon.className = "rankIcon";
    icon.alt = r.tier ? String(r.tier) : "unranked";
    icon.src = rankIconUrl(r.tier || "unranked");

    const rankText = document.createElement("div");
    rankText.className = "rankText";

    const rankLabel = document.createElement("div");
    rankLabel.className = "rankLabel" + (!r.tier ? " unranked" : "");
    rankLabel.textContent = r.rankLabel;

    const rankMeta = document.createElement("div");
    rankMeta.className = "rankMeta";
    const wr = r.wr == null ? "—" : `${r.wr}%`;
    rankMeta.textContent = `${r.wl} • WR ${wr}`;

    rankText.appendChild(rankLabel);
    rankText.appendChild(rankMeta);

    rank.appendChild(icon);
    rank.appendChild(rankText);

    head.appendChild(who);
    head.appendChild(rank);

    const body = document.createElement("div");
    body.className = "cardBody";

    const miniStats = document.createElement("div");
    miniStats.className = "miniStats";

    const m1 = document.createElement("div");
    m1.className = "mini";
    m1.innerHTML = `<div class="k">10 dernières</div><div class="v">${r.last10}</div>`;

    miniStats.appendChild(m1);
    body.appendChild(miniStats);

    card.appendChild(head);
    card.appendChild(body);

    root.appendChild(card);
  }
}

function applyQueue(q) {
  state.queue = q;
  const solo = $("queueSolo");
  const flex = $("queueFlex");
  if (solo && flex) {
    solo.classList.toggle("active", q === "RANKED_SOLO_5x5");
    flex.classList.toggle("active", q === "RANKED_FLEX_SR");
  }
}

async function fetchData() {
  state.loading = true;
  hideBanner();
  setStatus("Chargement…");

  const { data: players, error: pErr } = await supabase
    .from("players")
    .select("id, display_name, riot_game_name, riot_tag_line, active")
    .eq("active", true)
    .order("created_at", { ascending: true });

  if (pErr) {
    state.loading = false;
    banner("err", "Erreur Supabase", pErr.message);
    setStatus("Erreur");
    return;
  }

  state.players = players || [];

  // latest_rank
  const { data: latest, error: lErr } = await supabase
    .from("latest_rank")
    .select("player_id, queue, day, tier, division, lp, wins, losses, updated_at")
    .eq("queue", state.queue);

  if (lErr) {
    state.loading = false;
    banner("err", "Erreur Supabase", lErr.message);
    setStatus("Erreur");
    return;
  }

  state.latest.clear();
  for (const row of latest || []) {
    state.latest.set(`${row.player_id}|${row.queue}`, row);
  }

  // recent_games
  const { data: games, error: gErr } = await supabase
    .from("recent_games")
    .select("player_id, queue, games, fetched_at")
    .eq("queue", state.queue);

  if (gErr) {
    state.loading = false;
    banner("err", "Erreur Supabase", gErr.message);
    setStatus("Erreur");
    return;
  }

  state.games.clear();
  for (const row of games || []) {
    state.games.set(`${row.player_id}|${row.queue}`, row.games || []);
  }

  // presence
  const { data: pres, error: prErr } = await supabase
    .from("live_status")
    .select("player_id, in_game, queue_id, checked_at, last_error");

  if (prErr) {
    // non bloquant
    console.warn("presence fetch error:", prErr.message);
  } else {
    state.presence.clear();
    for (const row of pres || []) {
      state.presence.set(row.player_id, row);
    }
  }

  state.lastFetchAt = new Date().toISOString();
  state.loading = false;
  setStatus("OK");
}

function rerender() {
  const rows = buildRows();
  renderStats(rows);

  const emptyEl = document.getElementById("empty");
  if (emptyEl) emptyEl.hidden = rows.length !== 0;

  renderCards(rows);
}

async function manualRefresh() {
  try {
    const btn = $("refreshBtn");
    if (btn) btn.disabled = true;

    const res = await fetch(`${FUNCTIONS_BASE}/refresh_now_public`, {
      method: "POST",
      headers: { "content-type": "application/json", apikey: SUPABASE_ANON_KEY },
      body: JSON.stringify({ reason: "site" }),
    });

    const txt = await res.text().catch(() => "");
    if (!res.ok) {
      toast(`Refresh KO (${res.status})`);
      console.warn("refresh error:", res.status, txt);
      if (btn) btn.disabled = false;
      return;
    }

    toast("Refresh lancé ✅");
    await fetchData();
    rerender();
  } finally {
    const btn = $("refreshBtn");
    if (btn) btn.disabled = false;
  }
}

function wireUI() {
  const solo = $("queueSolo");
  const flex = $("queueFlex");

  if (solo) {
    solo.addEventListener("click", async () => {
      applyQueue("RANKED_SOLO_5x5");
      await fetchData();
      rerender();
    });
  }

  if (flex) {
    flex.addEventListener("click", async () => {
      applyQueue("RANKED_FLEX_SR");
      await fetchData();
      rerender();
    });
  }

  const search = $("search");
  if (search) {
    search.addEventListener("input", () => {
      state.search = search.value;
      rerender();
    });
  }

  const refreshBtn = $("refreshBtn");
  if (refreshBtn) {
    refreshBtn.addEventListener("click", manualRefresh);
  }
}

async function main() {
  // Force cards-only mode
  document.body.dataset.view = "cards";

  applyQueue("RANKED_SOLO_5x5");
  wireUI();

  await fetchData();
  rerender();

  // presence refresh loop (every 30s): just reload presence + rerender
  setInterval(async () => {
    try {
      const { data: pres, error } = await supabase
        .from("live_status")
        .select("player_id, in_game, queue_id, checked_at, last_error");
      if (!error) {
        state.presence.clear();
        for (const row of pres || []) state.presence.set(row.player_id, row);
        rerender();
      }
    } catch {}
  }, 30_000);
}

main().catch((e) => {
  console.error(e);
  banner("err", "Erreur", String(e?.message ?? e));
  setStatus("Erreur");
});
