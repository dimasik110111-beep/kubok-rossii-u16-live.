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

function parseCalendar(html, fetchedAt) {
  if (typeof html !== "string" || html.length < 500 || html.length > 5_000_000) {
    throw new Error("FHR calendar response has an unexpected size");
  }

  const rows = [...html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  const matches = [];
  const seen = new Set();

  for (const rowMatch of rows) {
    const rowHtml = rowMatch[1];
    const cells = getCellHtml(rowHtml);
    if (cells.length < 5) continue;

    const numberText = cellText(cells[0]);
    if (!/^\d{1,8}$/.test(numberText)) continue;

    const dateText = cellText(cells[1]);
    const dateMatch = dateText.match(/(\d{2})\.(\d{2})\.(20\d{2})\s+(\d{2}):(\d{2})/);
    if (!dateMatch) continue;

    const home = cellText(cells[2]);
    const away = cellText(cells[3]);
    const scoreCell = cellText(cells[4]);
    const arena = cells[5] ? cellText(cells[5]) : "";
    if (!home || !away || home === away) continue;

    const scoreMatch = scoreCell.match(/(?:^|\s)(\d{1,2})\s*:\s*(\d{1,2})(?:\s|$)/);
    const rowAttrs = (rowMatch[0].match(/^<tr\b[^>]*>/i) || [""])[0];
    const explicitLive = /\bLIVE\b|ид[её]т\s+(?:матч|игра)|data-status=["']live["']/i.test(rowHtml + " " + rowAttrs);
    const explicitFinal = /заверш[её]н|окончен|\bFINAL\b|data-status=["']finished["']/i.test(rowHtml + " " + rowAttrs);

    let status = "SCHEDULED";
    if (explicitLive) status = "LIVE";
    else if (explicitFinal) status = "FINAL";
    else if (scoreMatch) status = "SCORE_AVAILABLE";

    const id = Number(numberText);
    const fingerprint = [id, dateText, home, away].join("|");
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);

    const hrefMatch = rowHtml.match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>/i);
    let matchUrl = null;
    if (hrefMatch) {
      try {
        const candidate = new URL(decodeEntities(hrefMatch[1]), FHR_CALENDAR);
        if (candidate.protocol === "https:" && candidate.hostname === "junior.fhr.ru") matchUrl = candidate.href;
      } catch {}
    }

    const date = dateMatch[3] + "-" + dateMatch[2] + "-" + dateMatch[1];
    matches.push({
      id,
      date,
      timeMsk: dateMatch[4] + ":" + dateMatch[5],
      home,
      away,
      homeScore: scoreMatch ? Number(scoreMatch[1]) : null,
      awayScore: scoreMatch ? Number(scoreMatch[2]) : null,
      scoreNote: scoreMatch ? scoreCell.replace(scoreMatch[0], "").trim() : "",
      arena,
      status,
      matchUrl,
      source: "FHR",
      observedAt: fetchedAt
    });
  }

  if (!matches.length) {
    throw new Error("No calendar rows matched the expected FHR table. Parser needs review.");
  }

  matches.sort((a, b) => (a.date + a.timeMsk).localeCompare(b.date + b.timeMsk));
  return matches;
}

async function getCalendar() {
  const fetchedAt = new Date().toISOString();
  const response = await fetch(FHR_CALENDAR, {
    headers: {
      "accept": "text/html,application/xhtml+xml",
      "user-agent": "KubokRossiiU16Live/1.0 (+FHR public calendar reader)"
    },
    redirect: "follow",
    cf: { cacheTtl: 5, cacheEverything: true }
  });

  if (!response.ok) throw new Error("FHR returned HTTP " + response.status);
  const contentType = response.headers.get("content-type") || "";
  if (contentType && !contentType.includes("text/html")) {
    throw new Error("FHR returned an unexpected content type");
  }

  const html = await response.text();
  const matches = parseCalendar(html, fetchedAt);
  return {
    ok: true,
    tournament: "Кубок России U16",
    season: "2026/2027",
    sourceUrl: FHR_CALENDAR,
    fetchedAt,
    refreshHintSeconds: 15,
    liveVerified: matches.some(m => m.status === "LIVE"),
    matches,
    notice: "SCORE_AVAILABLE не означает LIVE. Статус LIVE выставляется только при явном маркере в ответе ФХР. Период, игровое время и события матча пока не подтверждены."
  };
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

    if (url.pathname === "/api/v1/debug/source") {
      try {
        const [calendarResponse, homeResponse] = await Promise.all([
          fetch(FHR_CALENDAR, { headers: { "accept": "text/html", "user-agent": "KubokRossiiU16Live/1.0" }, redirect: "follow" }),
          fetch("https://junior.fhr.ru/", { headers: { "accept": "text/html", "user-agent": "KubokRossiiU16Live/1.0" }, redirect: "follow" })
        ]);
        const [calendarHtml, homeHtml] = await Promise.all([calendarResponse.text(), homeResponse.text()]);
        const rows = parseCalendar(calendarHtml, new Date().toISOString());
        const links = [...homeHtml.matchAll(/<a\\b[^>]*href=["']([^"']+)["'][^>]*>([\\s\\S]*?)<\\/a>/gi)]
          .map(m => ({ href: m[1], text: cellText(m[2]).slice(0, 100) }))
          .filter(x => /kubokrossii|calendar|games\\//i.test(x.href) || /кубок россии u16|матч центр/i.test(x.text))
          .slice(0, 100);
        const scripts = [...homeHtml.matchAll(/<script\\b[^>]*src=["']([^"']+)["']/gi)].map(m => m[1]).slice(0, 40);
        const title = (homeHtml.match(/<title[^>]*>([\\s\\S]*?)<\\/title>/i) || [,""])[1];
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
