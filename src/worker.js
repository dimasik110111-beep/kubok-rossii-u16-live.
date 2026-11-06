const FHR_CALENDAR = "https://junior.fhr.ru/tournaments/kubokrossii-25008909/calendar/";
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff"
};

function json(data, status = 200, cacheSeconds = 10) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS,
      "cache-control": status === 200 ? "public, max-age=" + cacheSeconds : "no-store"
    }
  });
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
}

function cellText(html) {
  const withAlt = String(html || "").replace(/<img\b[^>]*\balt=["']([^"']*)["'][^>]*>/gi, " $1 ");
  return decodeEntities(withAlt.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

function getCellHtml(row) {
  return [...row.matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(m => m[1]);
}

function parseCalendar(html, fetchedAt, groupName = "") {
  if (typeof html !== "string" || html.length < 500 || html.length > 5_000_000) {
    throw new Error("FHR calendar response has an unexpected size");
  }

  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  const matches = [];
  const seen = new Set();

  for (const rowMatch of rows) {
    const rowHtml = rowMatch[1];
    const cells = getCellHtml(rowHtml);
    const texts = cells.map(cellText);
    if (texts.length < 5) continue;

    const dateIndex = texts.findIndex(value => /\d{2}\.\d{2}\.20\d{2}/.test(value));
    if (dateIndex < 0) continue;
    const dateMatch = texts[dateIndex].match(/(\d{2})\.(\d{2})\.(20\d{2})(?:\s+(\d{1,2}):(\d{2}))?/);
    if (!dateMatch) continue;

    let timeMsk = dateMatch[4] ? String(dateMatch[4]).padStart(2, "0") + ":" + dateMatch[5] : "";
    let timeIndex = -1;
    if (!timeMsk) {
      const possibleTimeIndex = dateIndex + 1;
      const timeMatch = (texts[possibleTimeIndex] || "").match(/^(\d{1,2}):(\d{2})$/);
      if (timeMatch) {
        timeMsk = String(timeMatch[1]).padStart(2, "0") + ":" + timeMatch[2];
        timeIndex = possibleTimeIndex;
      }
    }

    const numberIndex = texts.findIndex((value, index) =>
      index < dateIndex && /^\d{1,8}$/.test(value)
    );
    const matchNumber = numberIndex >= 0 ? Number(texts[numberIndex]) : null;

    const isArena = (value) =>
      /^(?:ЛА|МАУ)(?:\s|$)/i.test(value) ||
      /(?:арена|ледов|дворец|море спорта|побережье)/i.test(value);
    const isScore = (value) => /^\d{1,2}\s*:\s*\d{1,2}(?:\s+(?:ОТ|ПБ|ПП))?$/i.test(value);
    const arenaParts = texts.filter((value, index) =>
      index > dateIndex && index !== timeIndex && isArena(value)
    );
    const scoreIndex = texts.findIndex((value, index) =>
      index > dateIndex && index !== timeIndex && isScore(value)
    );
    const arena = arenaParts.join(" ");
    const scoreCell = scoreIndex >= 0 ? texts[scoreIndex] : "";
    const scoreMatch = scoreCell.match(/^(\d{1,2})\s*:\s*(\d{1,2})(?:\s+(ОТ|ПБ|ПП))?$/i);

    const teamCandidates = texts.filter((value, index) => {
      if (!value || index === dateIndex || index === timeIndex || index === scoreIndex || isArena(value)) return false;
      if (index === numberIndex || /^\d{1,8}$/.test(value)) return false;
      if (/^\d{1,2}:\d{2}$/.test(value) || /\d{2}\.\d{2}\.20\d{2}/.test(value)) return false;
      if (/^(?:ОТ|ПБ|ПП|МСК|:|—|-|№|дата|арена|команда|сч[её]т)$/i.test(value)) return false;
      if (/^\d+\s*-\s*\d+\s*м\.?$/i.test(value)) return false;
      return true;
    });

    const home = teamCandidates[0] || null;
    const away = teamCandidates[1] || null;
    const hrefMatch = rowHtml.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/i);
    let matchUrl = null;
    let gameId = null;
    if (hrefMatch) {
      try {
        const candidate = new URL(decodeEntities(hrefMatch[1]), FHR_CALENDAR);
        if (candidate.protocol === "https:" && candidate.hostname === "junior.fhr.ru" && /^\/games\/\d+\/?$/.test(candidate.pathname)) {
          matchUrl = candidate.href;
          gameId = Number(candidate.pathname.match(/\d+/)[0]);
        }
      } catch {}
    }

    const isUnassignedPlayoff = /плей-офф/i.test(groupName) && Boolean(gameId) && (!home || !away);
    if ((!home || !away) && !isUnassignedPlayoff) continue;
    if (home && away && home === away) continue;

    const id = gameId || matchNumber;
    if (!id) continue;
    const fingerprint = gameId ? String(gameId) : [dateMatch[3], dateMatch[2], dateMatch[1], timeMsk, home || "", away || ""].join("|");
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    matches.push({
      id,
      gameId,
      matchNumber,
      group: groupName || null,
      date: dateMatch[3] + "-" + dateMatch[2] + "-" + dateMatch[1],
      timeMsk,
      home,
      away,
      homeScore: scoreMatch ? Number(scoreMatch[1]) : null,
      awayScore: scoreMatch ? Number(scoreMatch[2]) : null,
      scoreNote: scoreMatch ? (scoreMatch[3] || "") : "",
      arena,
      status: scoreMatch ? "SCORE_AVAILABLE" : "SCHEDULED",
      matchUrl,
      source: "FHR",
      observedAt: fetchedAt
    });
  }

  return matches;
}

function parseMatchPage(html, gameId, fetchedAt) {
  const matchNumberText = (html.match(/<span\b[^>]*class=["'][^"']*\bmatch-number\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) || [,""])[1];
  const statusText = (html.match(/<span\b[^>]*class=["'][^"']*\bmatch-result\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) || [,""])[1];
  const dateText = (html.match(/<span\b[^>]*class=["'][^"']*\bmatch-date\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i) || [,""])[1];
  const teamTitles = [...html.matchAll(/<span\b[^>]*class=["'][^"']*\bteam-title\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)]
    .map(m => cellText(m[1])).filter(Boolean);
  const teamCities = [...html.matchAll(/<span\b[^>]*class=["'][^"']*\bteam-city\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi)]
    .map(m => cellText(m[1]));
  const teams = teamTitles.map((name, index) => [name, teamCities[index] || ""].filter(Boolean).join(" "));
  const scoreIndex = html.indexOf('class="match-score"');
  const scoreChunk = scoreIndex >= 0 ? html.slice(scoreIndex, scoreIndex + 700) : "";
  const scoreNumbers = [...scoreChunk.matchAll(/class=["']text-score["']>(\d+)</gi)].map(m => Number(m[1])).slice(0, 2);
  const deskStart = html.search(/<div\b[^>]*class=["'][^"']*\btime-score-desk\b[^"']*["'][^>]*>/i);
  const mobileStart = html.search(/<div\b[^>]*class=["'][^"']*\btime-score-mob\b[^"']*["'][^"']*["'][^>]*>/i);
  const periodHtml = deskStart >= 0
    ? html.slice(deskStart, mobileStart > deskStart ? mobileStart : deskStart + 7000)
    : html;
  const periodScores = [...periodHtml.matchAll(/<div\b[^>]*class=["'][^"']*\bperiod-score\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi)]
    .map(m => [...m[1].matchAll(/class=["']text-score["']>(\d+)</gi)].map(x => Number(x[1])))
    .filter(x => x.length >= 2).map(x => ({ home: x[0], away: x[1] }));
  const eventRows = [...html.matchAll(/<div\b[^>]*class=["'][^"']*\bevent-row\b[^"']*["'][^>]*>([\s\S]*?)<\/div>\s*<\/div>/gi)]
    .map(m => {
      const score = (m[1].match(/<div\b[^>]*class=["'][^"']*\bscore-col\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) || [,""])[1];
      const info = (m[1].match(/<div\b[^>]*class=["'][^"']*\binfo-col\b[^"']*["'][^>]*>([\s\S]*?)<\/div>/i) || [,""])[1];
      return { score: cellText(score), description: cellText(info) };
    }).filter(x => x.score || x.description);

  const statusLabel = cellText(statusText);
  let status = "UNKNOWN";
  if (/не начался|не сыгран|ожидает/i.test(statusLabel)) status = "SCHEDULED";
  else if (/окончен|заверш[её]н|финал/i.test(statusLabel)) status = "FINAL";
  else if (/перерыв/i.test(statusLabel)) status = "LIVE_PAUSED";
  else if (/период|овертайм|буллит|ид[её]т|live/i.test(statusLabel)) status = "LIVE";

  return {
    ok: true,
    gameId: Number(gameId),
    matchNumber: Number((cellText(matchNumberText).match(/\d+/) || [])[0]) || null,
    tournament: "Кубок России U16",
    season: "2026/2027",
    home: teams[0] || null,
    away: teams[1] || null,
    homeScore: status === "SCHEDULED" ? null : (scoreNumbers.length === 2 ? scoreNumbers[0] : null),
    awayScore: status === "SCHEDULED" ? null : (scoreNumbers.length === 2 ? scoreNumbers[1] : null),
    periodScores: status === "SCHEDULED" ? [] : periodScores,
    period: (statusLabel.match(/(\d+)\s*(?:период|периода|period)/i) || [])[1] ? Number((statusLabel.match(/(\d+)\s*(?:период|периода|period)/i) || [])[1]) : null,
    clock: (statusLabel.match(/\b\d{1,2}:\d{2}\b/) || [])[0] || null,
    status,
    statusText: statusLabel || null,
    dateText: cellText(dateText) || null,
    events: eventRows,
    matchUrl: "https://junior.fhr.ru/games/" + gameId + "/",
    source: "FHR",
    observedAt: fetchedAt,
    liveVerified: status === "LIVE" || status === "LIVE_PAUSED"
  };
}

async function fetchMatchDetail(gameId) {
  const matchUrl = "https://junior.fhr.ru/games/" + gameId + "/";
  const response = await fetch(matchUrl, {
    headers: {
      "accept": "text/html,application/xhtml+xml",
      "user-agent": "KubokRossiiU16Live/1.0 (+FHR match-center reader)"
    },
    redirect: "follow"
  });
  if (!response.ok) throw new Error("FHR match page returned HTTP " + response.status);
  const contentType = response.headers.get("content-type") || "";
  if (contentType && !contentType.includes("text/html")) throw new Error("Unexpected FHR match content type");
  return parseMatchPage(await response.text(), gameId, new Date().toISOString());
}

async function getLiveMatches() {
  const calendar = await getCalendar();
  const now = Date.now();
  const mskNow = new Date(now + 3 * 60 * 60 * 1000);
  const today = mskNow.toISOString().slice(0, 10);
  const yesterday = new Date(mskNow.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const candidates = calendar.matches.filter(match => {
    if (!match.gameId || (match.date !== today && match.date !== yesterday)) return false;
    const start = Date.parse(match.date + "T" + match.timeMsk + ":00+03:00");
    const age = now - start;
    return age >= -3 * 60 * 60 * 1000 && age <= 8 * 60 * 60 * 1000;
  }).slice(0, 24);

  const results = await Promise.all(candidates.map(async match => {
    try {
      return await fetchMatchDetail(match.gameId);
    } catch (error) {
      return { ok: false, gameId: match.gameId, error: String(error && error.message || error).slice(0, 180) };
    }
  }));
  const liveMatches = results.filter(match => match.ok !== false && (match.status === "LIVE" || match.status === "LIVE_PAUSED"));
  const errors = results.filter(match => match.ok === false);
  return {
    ok: true,
    tournament: calendar.tournament,
    season: calendar.season,
    sourceUrl: FHR_CALENDAR,
    fetchedAt: new Date().toISOString(),
    refreshHintSeconds: 10,
    liveVerified: candidates.length > 0 && errors.length === 0,
    checkedCount: results.length,
    errors,
    matches: liveMatches,
    checkedMatches: results,
    notice: errors.length
      ? "Часть карточек ФХР не удалось проверить; LIVE-статус не считается полностью подтверждённым."
      : (candidates.length === 0
        ? "Сейчас нет матчей в окне проверки; LIVE не подтверждён, повторите запрос перед началом игры."
        : (liveMatches.length ? "LIVE-статус проверен по карточкам матчей ФХР." : "Карточки матчей ФХР проверены: сейчас подтверждённых LIVE-матчей нет."))
  };
}

async function getCalendar() {
  const cacheKey = new Request("https://cache.kubok-u16-live/api/v1/matches");
  const cached = await caches.default.match(cacheKey);
  if (cached) return await cached.json();

  const fetchedAt = new Date().toISOString();
  const response = await fetch(FHR_CALENDAR, {
    headers: {
      "accept": "text/html,application/xhtml+xml",
      "user-agent": "KubokRossiiU16Live/1.0 (+FHR public calendar reader)"
    },
    redirect: "follow"
  });

  if (!response.ok) throw new Error("FHR calendar returned HTTP " + response.status);
  const html = await response.text();
  const filters = [...html.matchAll(/<div\b[^>]*data-ajax-link=["']([^"']+)["'][^>]*>([\s\S]*?)<\/div>/gi)]
    .map(m => ({
      url: new URL(decodeEntities(m[1]), FHR_CALENDAR).href,
      name: cellText(m[2])
    }))
    .filter(x => x.name && /группа|плей-офф/i.test(x.name));

  if (!filters.length) {
    const fallbackMatches = parseCalendar(html, fetchedAt, "Основной календарь");
    if (!fallbackMatches.length) throw new Error("No FHR group calendar filters or match rows found");
    return {
      ok: true,
      tournament: "Кубок России U16",
      season: "2026/2027",
      sourceUrl: FHR_CALENDAR,
      fetchedAt,
      refreshHintSeconds: 15,
      groupsFetched: 1,
      matches: fallbackMatches,
      liveVerified: false,
      notice: "Календарь получен с ФХР. Для LIVE-статуса запрашивайте карточку матча отдельно."
    };
  }

  const feedResults = await Promise.all(filters.map(async filter => {
    try {
      const feedResponse = await fetch(filter.url, {
        headers: {
          "accept": "text/html, */*",
          "user-agent": "KubokRossiiU16Live/1.0 (+FHR public calendar reader)",
          "x-requested-with": "XMLHttpRequest",
          "referer": FHR_CALENDAR
        },
        redirect: "follow"
      });
      if (!feedResponse.ok) throw new Error("HTTP " + feedResponse.status);
      const feedHtml = await feedResponse.text();
      return { group: filter.name, matches: parseCalendar(feedHtml, fetchedAt, filter.name) };
    } catch (error) {
      return { group: filter.name, matches: [], error: String(error && error.message || error).slice(0, 160) };
    }
  }));

  const matchesById = new Map();
  for (const feed of feedResults) {
    for (const match of feed.matches) {
      const key = match.gameId ? String(match.gameId) : [match.date, match.timeMsk, match.home, match.away].join("|");
      if (!matchesById.has(key)) matchesById.set(key, match);
    }
  }

  const matches = [...matchesById.values()].sort((a, b) =>
    (a.date + a.timeMsk).localeCompare(b.date + b.timeMsk)
  );
  if (!matches.length) throw new Error("FHR group feeds returned no match rows");

  const payload = {
    ok: true,
    tournament: "Кубок России U16",
    season: "2026/2027",
    sourceUrl: FHR_CALENDAR,
    fetchedAt,
    refreshHintSeconds: 15,
    groupsFetched: feedResults.filter(x => !x.error).length,
    groups: feedResults.map(x => ({ name: x.group, matchesCount: x.matches.length, error: x.error || null })),
    groupErrors: feedResults.filter(x => x.error).map(x => ({ group: x.group, error: x.error })),
    matchesCount: matches.length,
    liveVerified: false,
    matches,
    notice: "Список и результаты загружаются из календаря ФХР по всем группам и этапам. Для подтверждённого LIVE, периода и событий используйте /api/v1/matches/{gameId}."
  };

  const cacheResponse = new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=12" }
  });
  await caches.default.put(cacheKey, cacheResponse);
  return payload;
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") return new Response(null, { headers: CORS });
    if (request.method !== "GET") return json({ ok: false, error: "GET only" }, 405, 0);

    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return json({
        ok: true,
        service: "kubok-u16-live",
        source: FHR_CALENDAR,
        feed: "/api/v1/matches",
        liveVerified: false,
        note: "Health check only; live match updates must be validated during an active FHR match."
      });
    }

    if (url.pathname === "/api/v1/debug/group-feeds") {
      try {
        const response = await fetch(FHR_CALENDAR, { headers: { "accept": "text/html", "user-agent": "KubokRossiiU16Live/1.0" } });
        const html = await response.text();
        const filters = [...html.matchAll(/<div\b[^>]*data-ajax-link=["']([^"']+)["'][^>]*>([\s\S]*?)<\/div>/gi)]
          .map(m => ({ url: new URL(decodeEntities(m[1]), FHR_CALENDAR).href, name: cellText(m[2]) }))
          .filter(x => x.name && /группа|плей-офф/i.test(x.name));
        const feeds = await Promise.all(filters.map(async filter => {
          try {
            const r = await fetch(filter.url, {
              headers: {
                "accept": "text/html, */*",
                "user-agent": "KubokRossiiU16Live/1.0",
                "x-requested-with": "XMLHttpRequest",
                "referer": FHR_CALENDAR
              }
            });
            const body = await r.text();
            let parsedCount = 0, parseError = null;
            try { parsedCount = parseCalendar(body, new Date().toISOString(), filter.name).length; }
            catch (e) { parseError = String(e && e.message || e); }
            const rowSamples = [...body.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)]
              .filter(m => /СПАРТАК|ЛОКОМОТИВ|ТОРПЕДО/.test(cellText(m[1])))
              .slice(0, 2).map(m => getCellHtml(m[1]).map(cellText));
            const sampleIndex = body.indexOf("СПАРТАК");
            const rowStart = sampleIndex >= 0 ? body.lastIndexOf("<tr", sampleIndex) : -1;
            const rowEnd = sampleIndex >= 0 ? body.indexOf("</tr>", sampleIndex) : -1;
            const sampleHtml = /плей-офф/i.test(filter.name) && rowStart >= 0 && rowEnd >= 0 ? body.slice(rowStart, rowEnd + 5) : "";
            return { name: filter.name, status: r.status, contentType: r.headers.get("content-type"), length: body.length, parsedCount, parseError, preview: cellText(body).slice(0, 900), rowSamples, sampleHtml };
          } catch (e) {
            return { name: filter.name, error: String(e && e.message || e) };
          }
        }));
        return json({ ok: true, filtersCount: filters.length, feeds }, 200, 0);
      } catch (error) {
        return json({ ok: false, error: String(error && error.message || error) }, 502, 0);
      }
    }

    if (url.pathname === "/api/v1/debug/calendar") {
      try {
        const calendarUrl = FHR_CALENDAR;
        const response = await fetch(calendarUrl, {
          headers: { "accept": "text/html,application/xhtml+xml", "user-agent": "KubokRossiiU16Live/1.0" },
          redirect: "follow"
        });
        const html = await response.text();
        const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
          .map(m => ({ href: m[1], text: cellText(m[2]).slice(0, 120) }))
          .filter(x => /games\/|calendar|kubokrossii/i.test(x.href) || /группа|этап|2011 г\.р\./i.test(x.text)).slice(0, 150);
        const filters = [...html.matchAll(/<[^>]+data-ajax-link=["']([^"']+)["'][^>]*>([\s\S]*?)<\/[^>]+>/gi)]
          .map(m => ({ url: m[1], text: cellText(m[2]).slice(0, 80) })).slice(0, 40);
        const textPreview = cellText(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")).slice(0, 12000);
        const snippets = ["Календарь", "Группа A-I", "Группа Б-I", "Группа В-I", "Группа Г-I", "data-ajax-link"]
          .map(term => {
            const i = html.toLowerCase().indexOf(term.toLowerCase());
            return i < 0 ? null : { term, html: html.slice(Math.max(0, i - 500), Math.min(html.length, i + 1800)).replace(/\s+/g, " ").slice(0, 2200) };
          }).filter(Boolean);
        return json({ ok: response.ok, httpStatus: response.status, finalUrl: response.url, htmlLength: html.length, filters, links, textPreview, snippets }, 200, 0);
      } catch (error) {
        return json({ ok: false, error: String(error && error.message || error) }, 502, 0);
      }
    }

    if (url.pathname === "/api/v1/debug/tournament") {
      try {
        const tournamentUrl = "https://junior.fhr.ru/tournaments/kubokrossii-25008909/";
        const response = await fetch(tournamentUrl, {
          headers: { "accept": "text/html,application/xhtml+xml", "user-agent": "KubokRossiiU16Live/1.0" },
          redirect: "follow"
        });
        const html = await response.text();
        const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
          .map(m => ({ href: m[1], text: cellText(m[2]).slice(0, 140) }))
          .filter(x => /games\/|calendar|kubokrossii/i.test(x.href) || /2011 г\.р\.|группа|матч/i.test(x.text)).slice(0, 180);
        const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [,""])[1];
        const textPreview = cellText(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")).slice(0, 14000);
        const tabSnippets = ["Календарь", "Группа A-I", "Группа Б-I", "Группа В-I", "Группа Г-I", "Группа A-II", "data-ajax-url", "data-ajax"]
          .map(term => {
            const i = html.toLowerCase().indexOf(term.toLowerCase());
            return i < 0 ? null : { term, html: html.slice(Math.max(0, i - 700), Math.min(html.length, i + 1500)).replace(/\s+/g, " ").slice(0, 2200) };
          }).filter(Boolean);
        return json({ ok: response.ok, httpStatus: response.status, finalUrl: response.url, htmlLength: html.length, title: cellText(title), textPreview, links, tabSnippets }, 200, 0);
      } catch (error) {
        return json({ ok: false, error: String(error && error.message || error) }, 502, 0);
      }
    }

    if (url.pathname === "/api/v1/debug/game") {
      const gameId = url.searchParams.get("id") || "";
      if (!/^\d{5,12}$/.test(gameId)) return json({ ok: false, error: "Provide numeric FHR game id" }, 400, 0);
      try {
        const gameUrl = "https://junior.fhr.ru/games/" + gameId + "/";
        const response = await fetch(gameUrl, {
          headers: { "accept": "text/html,application/xhtml+xml", "user-agent": "KubokRossiiU16Live/1.0" },
          redirect: "follow"
        });
        const html = await response.text();
        const title = (html.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [,""])[1];
        const scriptSrcs = [...html.matchAll(/<script[^>]*src=["']([^"']+)["']/gi)].map(m => m[1]).slice(0, 50);
        const hrefs = [...html.matchAll(/href=["']([^"']+)["']/gi)].map(m => m[1])
          .filter(x => /api|ajax|game|match|stat|protocol|event/i.test(x)).slice(0, 80);
        const inlineScripts = [...html.matchAll(/<script\b(?![^>]*src=)[^>]*>([\s\S]*?)<\/script>/gi)]
          .map(m => m[1]).filter(x => /game|match|ajax|api|score|period|event/i.test(x))
          .map(x => x.slice(0, 1800)).slice(0, 12);
        const textPreview = cellText(html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ").replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")).slice(0, 5000);
        const markers = [...html.matchAll(/.{0,100}(?:live|period|score|game_id|gameId|match_id|matchId|ajax|api).{0,180}/gi)]
          .map(m => m[0].replace(/\s+/g, " ").slice(0, 280)).slice(0, 35);
        const snippets = ["Окончен", "Не сыгран", "period-score", "score-wrap", "Матч центр", "Протокол", "гол:", "game-status", "match-status"]
          .map(term => {
            const i = html.toLowerCase().indexOf(term.toLowerCase());
            return i < 0 ? null : { term, html: html.slice(Math.max(0, i - 500), Math.min(html.length, i + 900)).replace(/\s+/g, " ").slice(0, 1400) };
          }).filter(Boolean);
        return json({
          ok: response.ok,
          httpStatus: response.status,
          finalUrl: response.url,
          contentType: response.headers.get("content-type"),
          htmlLength: html.length,
          title: cellText(title),
          textPreview,
          scriptSrcs,
          hrefs,
          inlineScripts,
          markers,
          snippets
        }, 200, 0);
      } catch (error) {
        return json({ ok: false, error: String(error && error.message || error) }, 502, 0);
      }
    }

    if (url.pathname === "/api/v1/debug/source") {
      try {
        const [calendarResponse, homeResponse] = await Promise.all([
          fetch(FHR_CALENDAR, { headers: { "accept": "text/html", "user-agent": "KubokRossiiU16Live/1.0" }, redirect: "follow" }),
          fetch("https://junior.fhr.ru/", { headers: { "accept": "text/html", "user-agent": "KubokRossiiU16Live/1.0" }, redirect: "follow" })
        ]);
        const [calendarHtml, homeHtml] = await Promise.all([calendarResponse.text(), homeResponse.text()]);
        const rows = parseCalendar(calendarHtml, new Date().toISOString());
        const links = [...homeHtml.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)]
          .map(m => ({ href: m[1], text: cellText(m[2]).slice(0, 100) }))
          .filter(x => /kubokrossii|calendar|games\//i.test(x.href) || /кубок россии u16|матч центр/i.test(x.text))
          .slice(0, 100);
        const scripts = [...homeHtml.matchAll(/<script\b[^>]*src=["']([^"']+)["']/gi)].map(m => m[1]).slice(0, 40);
        const title = (homeHtml.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [,""])[1];
        const dates = rows.map(x => x.date).sort();
        return json({
          ok: true,
          calendarStatus: calendarResponse.status,
          calendarUrl: calendarResponse.url,
          calendarCount: rows.length,
          calendarMinDate: dates[0],
          calendarMaxDate: dates[dates.length - 1],
          homeStatus: homeResponse.status,
          homeUrl: homeResponse.url,
          homeTitle: cellText(title),
          homeHtmlLength: homeHtml.length,
          calendarHtmlLength: calendarHtml.length,
          links,
          scripts
        }, 200, 0);
      } catch (error) {
        return json({ ok: false, error: String(error && error.message || error) }, 502, 0);
      }
    }

    if (url.pathname === "/api/v1/live") {
      try {
        return json(await getLiveMatches(), 200, 5);
      } catch (error) {
        return json({
          ok: false,
          error: "FHR live check failed",
          detail: String(error && error.message || error).slice(0, 220),
          fetchedAt: new Date().toISOString(),
          liveVerified: false
        }, 502, 0);
      }
    }

    const matchRoute = url.pathname.match(/^\/api\/v1\/matches\/(\d+)\/?$/);
    if (matchRoute) {
      const gameId = matchRoute[1];
      try {
        const data = await fetchMatchDetail(gameId);
        return json(data, 200, 3);
      } catch (error) {
        return json({
          ok: false,
          gameId: Number(gameId),
          error: "FHR match detail fetch/parse failed",
          detail: String(error && error.message || error).slice(0, 220),
          fetchedAt: new Date().toISOString()
        }, 502, 0);
      }
    }

    if (url.pathname === "/api/v1/matches") {
      try {
        return json(await getCalendar(), 200, 10);
      } catch (error) {
        return json({
          ok: false,
          error: "FHR calendar fetch/parse failed",
          detail: String(error && error.message || error).slice(0, 220),
          sourceUrl: FHR_CALENDAR,
          fetchedAt: new Date().toISOString()
        }, 502, 0);
      }
    }

    return json({ ok: false, error: "Not found", endpoints: ["/health", "/api/v1/matches"] }, 404, 0);
  }
};
