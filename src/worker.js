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

    const isUnassignedPlayoff = /плей-офф/i.test(groupName) && Boolean(matchNumber) && (!home || !away);
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


function fhrElementText(html, cssClass) {
  if (!/^[a-z0-9_-]{2,80}$/i.test(cssClass)) return "";
  const source=String(html||"");
  const expression=new RegExp("<(div|span|a)\\b[^>]*\\bclass=[\"'][^\"']*\\b"+cssClass+"\\b[^\"']*[\"'][^>]*>", "i");
  const open=expression.exec(source);
  if (!open) return "";
  const tag=open[1].toLowerCase();
  const start=open.index+open[0].length;
  const tokens=new RegExp("<\\/?" + tag + "\\b[^>]*>", "gi");
  tokens.lastIndex=start;
  let depth=1, token;
  while ((token=tokens.exec(source))!==null) {
    if (token[0].startsWith("</")) depth--;
    else if (!token[0].endsWith("/>")) depth++;
    if (depth===0) return cellText(source.slice(start,token.index));
    if (token.index-start>12000) break;
  }
  return "";
}
function fhrOfficialPortrait(chunk,category) {
  const m=String(chunk||"").match(new RegExp('https:\\/\\/img\\.fhr\\.ru\\/'+category+'\\/[a-z0-9]+\\/[a-z0-9]+\\/\\d+\\.webp','i'));
  return m ? m[0] : null;
}
function parseProtocolTimeline(html) {
  const starts=[...html.matchAll(/<div\b[^>]*\bclass=["']match-protocol(?:\s+match-protocol--[a-z-]+)?["'][^>]*>/gi)];
  const timeline=[];
  const isEventType=(v)=>["GOAL","PENALTY","TIMEOUT","GOALKEEPER"].includes(v);
  for(let index=0;index<starts.length && index<500;index++){
    const m=starts[index];
    const end=index+1<starts.length?starts[index+1].index:Math.min(html.length,m.index+11000);
    const chunk=html.slice(m.index,Math.min(end,m.index+24000));
    const leftIndex=chunk.search(/class=["'][^"']*\bmatch-protocol__left\b/);
    const centerIndex=chunk.search(/class=["'][^"']*\bmatch-protocol__center\b/);
    const rightIndex=chunk.search(/class=["'][^"']*\bmatch-protocol__right\b/);
    if(centerIndex<0)continue;
    const left=leftIndex>=0?chunk.slice(leftIndex,centerIndex):"";
    const center=chunk.slice(centerIndex,rightIndex>=0?rightIndex:chunk.length);
    const right=rightIndex>=0?chunk.slice(rightIndex):"";
    const top=fhrElementText(center,"protocol-time__top");
    const bottom=fhrElementText(center,"protocol-time__bottom");
    const time=(bottom.match(/\b\d{1,3}:\d{2}\b/)||[])[0]||"";
    // FHR goal blocks have the plain "match-protocol" class; scores are nested in center spans.
    // Only seek a goal score in those blocks, never confuse a penalty timestamp with the score.
    const scoreMatch=/match-protocol--/.test(m[0])?null:
      (top+" "+cellText(center)).match(/\b(\d+)\s*-\s*(\d+)\b/);
    const entryClass=m[0];
    const type=/match-protocol--penalty/.test(entryClass)?"PENALTY":
      /match-protocol--keepers/.test(entryClass)?"GOALKEEPER":
      /match-protocol--timeout/.test(entryClass)?"TIMEOUT":
      scoreMatch?"GOAL":"OTHER";
    if(!isEventType(type))continue;
    const extract=(part,side)=>{
      if(!part||!/protocol-player-card/.test(part))return null;
      const name=fhrElementText(part,"protocol-player-card__name");
      const team=fhrElementText(part,"protocol-player-card__name-team");
      const number=fhrElementText(part,"protocol-player-card__number");
      const reason=fhrElementText(part,"protocol-player-card__label");
      const duration=fhrElementText(part,"protocol-player-card__sidebar");
      const photo=fhrOfficialPortrait(part,"players");
      const teamLogo=fhrOfficialPortrait(part,"teams");
      if(!name&&!team)return null;
      return {side,name,team,number,reason,duration,photo,teamLogo};
    };
    const l=extract(left,"home"),r=extract(right,"away");
    const primary=(l&&l.name?l:r)||l||r;
    const seconds=time ? Number(time.split(":")[0])*60+Number(time.split(":")[1]):null;
    timeline.push({
      id:"event-"+index,
      type,elapsed:time,elapsedSeconds:seconds,
      period:seconds===null?null:seconds>3600?4:seconds>2400?3:seconds>1200?2:1,
      label:top||type,
      score:scoreMatch?scoreMatch[1]+":"+scoreMatch[2]:null,
      player:primary?.name||null,
      playerNumber:primary?.number||null,
      team:primary?.team||null,
      side:primary?.side||null,
      playerPhoto:primary?.photo||null,
      teamLogo:primary?.teamLogo||null,
      description:primary?.reason||null,
      penaltyMinutes:primary?.duration||null,
      homePlayer:l,awayPlayer:r
    });
  }
  return timeline;
}


function fhrSafeProfileUrl(chunk) {
  const link=(String(chunk||"").match(/<a\b[^>]*\bhref=["']([^"']+\/player\/[^"']+|\/player\/[^"']+)["']/i)||[])[1]
    || (String(chunk||"").match(/\bhref=["'](\/player\/[^"']+)["']/i)||[])[1];
  if (!link) return null;
  try {
    const url=new URL(decodeEntities(link),"https://junior.fhr.ru");
    return url.origin==="https://junior.fhr.ru"&&url.pathname.startsWith("/player/")?url.href:null;
  } catch { return null; }
}

function fhrInt(value) {
  const text=cellText(value).replace(/\s+/g,"");
  return /^\d{1,3}$/.test(text)?Number(text):null;
}

function parseFhrMatchLineups(html) {
  const start=html.search(/<div\b[^>]*\bclass=["'][^"']*\bmatch-team-tab\b[^"']*["'][^>]*>/i);
  if (start<0) return {available:false, source:"FHR_MATCH", teams:[]};
  const tail=html.slice(start,start+350000);
  const nextTab=tail.search(/<div\b[^>]*\bclass=["'][^"']*\bmatch-protocol-tab\b[^"']*["'][^>]*>/i);
  const tab=nextTab>0?tail.slice(0,nextTab):tail;
  const blockPattern=/<div\b[^>]*\bclass=["'][^"']*\bteam-block\s+(left-team|right-team)\b[^"']*["'][^>]*>/gi;
  const blocks=[...tab.matchAll(blockPattern)];
  const teams=[];
  for (let i=0;i<blocks.length&&i<2;i++) {
    const block=blocks[i],side=block[1]==="left-team"?"home":"away";
    const slice=tab.slice(block.index,i+1<blocks.length?blocks[i+1].index:tab.length);
    const table=(slice.match(/<table\b[^>]*\bclass=["'][^"']*\bteam-table\b[^"']*["'][^>]*>([\s\S]*?)<\/table>/i)||[])[1]||"";
    const logo=fhrOfficialPortrait(table.slice(0,3000),"teams");
    const players=[],staff=[],seen=new Set();
    for(const tbody of table.matchAll(/<tbody\b[^>]*\bdata-id=["']([1-4])["'][^>]*>([\s\S]*?)<\/tbody>/gi)){
      const role={1:"GOALIE",2:"DEFENDER",3:"FORWARD",4:"STAFF"}[Number(tbody[1])];
      if(!role)continue;
      for(const row of tbody[2].matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){
        const cells=[...row[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(m=>m[1]);
        if(!cells.length)continue;
        const playerCell=cells[0];
        const name=fhrElementText(playerCell,"text").trim();
        const number=fhrElementText(playerCell,"number");
        if(!name||name.length>100)continue;
        if(role==="STAFF"){
          staff.push({name,position:cellText(cells[cells.length-1]).slice(0,100),
            photo:fhrOfficialPortrait(playerCell,"personals"),source:"FHR_MATCH"});
          continue;
        }
        const url=fhrSafeProfileUrl(playerCell);
        const playerKey=url||role+"|"+number+"|"+name;
        if(seen.has(playerKey))continue;
        seen.add(playerKey);
        const rawCaptain=cells.length>1?fhrElementText(cells[1],"captain-mark"):"";
        const roleMark=rawCaptain==="К"?"C":rawCaptain==="А"?"A":null;
        const stats=role==="GOALIE"?null:{
          goals:fhrInt(cells[2]),assists:fhrInt(cells[3]),points:fhrInt(cells[4]),penaltyMinutes:fhrInt(cells[5])
        };
        players.push({
          name,number,position:role,
          assignment:fhrElementText(playerCell,"unit")||null,
          captainRole:roleMark,photo:fhrOfficialPortrait(playerCell,"players"),
          url,stats,source:"FHR_MATCH"
        });
      }
    }
    teams.push({side,logo,players,staff,playerCount:players.length,
      verified:players.length>=10,
      source:"FHR_MATCH"});
  }
  return {available:teams.length===2&&teams.every(t=>t.verified),
    partial:teams.length>0 && !teams.every(t=>t.verified),
    source:"FHR_MATCH", teams};
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
    timeline: parseProtocolTimeline(html),
    protocolSource: "FHR match center",
    matchLineups: parseFhrMatchLineups(html),
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
  const cacheKey = new Request("https://cache.kubok-u16-live/api/v1/live");
  const cached = await caches.default.match(cacheKey);
  if (cached) return await cached.json();

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
  const payload = {
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

  const cacheResponse = new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=10" }
  });
  await caches.default.put(cacheKey, cacheResponse);
  return payload;
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
    .filter(x => {
      if (!x.name || !/группа|плей-офф|стыков|золотой финал|серебряный финал/i.test(x.name)) return false;
      try {
        const u = new URL(x.url);
        return u.protocol === "https:" && u.hostname === "junior.fhr.ru";
      } catch { return false; }
    });

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
    groupsPublished: filters.length,
    stagesPublished: {
      first: filters.filter(x => /группа\s+.{1,4}-I$/i.test(x.name)).length,
      second: filters.filter(x => /группа\s+.{1,4}-II$/i.test(x.name)).length,
      third: filters.filter(x => /группа\s+.{1,4}-III$/i.test(x.name)).length,
      crossovers: filters.filter(x => /стыков|плей-офф/i.test(x.name)).length,
      finals: filters.filter(x => /золотой финал|серебряный финал/i.test(x.name)).length
    },
    groupsFetched: feedResults.filter(x => !x.error).length,
    groups: feedResults.map(x => ({ name: x.group, matchesCount: x.matches.length, error: x.error || null })),
    groupErrors: feedResults.filter(x => x.error).map(x => ({ group: x.group, error: x.error })),
    matchesCount: matches.length,
    liveVerified: false,
    matches,
    notice: "Динамический каталог ФХР: все опубликованные группы, туры, стыковки и финалы; неопубликованные игры не создаются. Для LIVE используйте карточки матчей."
  };

  const cacheResponse = new Response(JSON.stringify(payload), {
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60" }
  });
  await caches.default.put(cacheKey, cacheResponse);
  return payload;
}


const FHR_TEAMS = "https://junior.fhr.ru/tournaments/kubokrossii-25008909/teams/";
const TOURNAMENT_ICON = "https://img.fhr.ru/tournaments/b6/ef/25008909.webp";

function onlyFhrImage(src, category) {
  try {
    const url = new URL(decodeEntities(src), "https://junior.fhr.ru/");
    return url.protocol === "https:" && url.hostname === "img.fhr.ru" &&
      new RegExp("^/" + category + "/[a-z0-9]+/[a-z0-9]+/\\d+\\.webp$", "i").test(url.pathname)
      ? url.href : null;
  } catch { return null; }
}

function parseTeamsMarkup(html, stage) {
  const entries = [];
  const seen = new Set();
  const pattern = /<a\b([^>]*\bclass=["'][^"']*\bteam-link\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi;
  for (const result of html.matchAll(pattern)) {
    const attributes=result[1], body=result[2];
    const href=(attributes.match(/\bhref=["']([^"']+)["']/i)||[])[1];
    if (!href) continue;
    let url;
    try { url = new URL(decodeEntities(href),FHR_TEAMS); } catch { continue; }
    if (url.origin !== "https://junior.fhr.ru") continue;
    const m=url.pathname.match(/^\/tournaments\/kubokrossii-25008909\/[a-z0-9-]+_(\d+)\/$/);
    if (!m) continue;
    const teamId=Number(m[1]);
    if (seen.has(teamId)) continue;
    seen.add(teamId);
    const title=(body.match(/<span\b[^>]*class=["'][^"']*\bteam-title\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)||[])[1];
    const city=(body.match(/<span\b[^>]*class=["'][^"']*\bteam-city\b[^"']*["'][^>]*>([\s\S]*?)<\/span>/i)||[])[1];
    const name=cellText(title)||cellText(body);
    if (!name) continue;
    const image=(body.match(/\bsrc=["'](https:\/\/img\.fhr\.ru\/(?:teams|players)\/[^"']+)["']/i)||[])[1];
    entries.push({
      id:teamId, name, city:cellText(city), fullName:[name,cellText(city)].filter(Boolean).join(" "),
      logo:onlyFhrImage(image,"teams"),
      url:url.href, stage, source:"FHR"
    });
  }
  return entries;
}

async function getTeams() {
  const key = new Request("https://cache.kubok-u16-live/api/v1/teams?images=v10");
  const cached = await caches.default.match(key);
  if (cached) return await cached.json();
  const r=await fetch(FHR_TEAMS,{
    headers:{"accept":"text/html","user-agent":"KubokRossiiU16Live/1.1"}
  });
  if (!r.ok) throw new Error("FHR teams HTTP "+r.status);
  const html=await r.text();
  const filters=[...html.matchAll(/<div\b[^>]*data-ajax-link=["']([^"']+)["'][^>]*>([\s\S]*?)<\/div>/gi)]
    .map(m=>({url:new URL(decodeEntities(m[1]),FHR_TEAMS).href,stage:cellText(m[2])}))
    .filter(x=>/^группа\s+.{1,3}-(I|II|III)$/i.test(x.stage));
  const firstStage=filters.filter(f=>/-I$/i.test(f.stage));
  const chosen=firstStage.length>=4?firstStage:filters;
  const batches=await Promise.all(chosen.map(async f=>{
    try{
      const u=new URL(f.url);
      if(u.hostname!=="junior.fhr.ru"||u.protocol!=="https:")throw new Error("Unexpected FHR host");
      const res=await fetch(u.href,{headers:{
        "accept":"text/html,*/*",
        "x-requested-with":"XMLHttpRequest",
        "referer":FHR_TEAMS
      }});
      if(!res.ok)throw new Error("FHR teams group HTTP "+res.status);
      return {stage:f.stage,teams:parseTeamsMarkup(await res.text(),f.stage),error:null};
    }catch(e){return {stage:f.stage,teams:[],error:String(e&&e.message||e).slice(0,120)};}
  }));
  const map=new Map();
  for(const item of parseTeamsMarkup(html,"Группа A-I"))map.set(item.id,item);
  for(const group of batches)for(const team of group.teams)map.set(team.id,team);
  const teams=[...map.values()].sort((a,b)=>a.name.localeCompare(b.name,"ru"));
  if(!teams.length)throw new Error("No teams parsed from FHR");
  const payload={
    ok:true, source:"FHR",sourceUrl:FHR_TEAMS,tournamentLogo:TOURNAMENT_ICON,
    fetchedAt:new Date().toISOString(),count:teams.length,
    complete:teams.length>=20 && !batches.some(x=>x.error),
    groups:batches.map(x=>({name:x.stage,count:x.teams.length,error:x.error})),
    teams
  };
  await caches.default.put(key,new Response(JSON.stringify(payload),{
    headers:{"content-type":"application/json","cache-control":"public,max-age=900"}}));
  return payload;
}

function parseRoster(html, team) {
  const players=[],seen=new Set();
  const cards=html.matchAll(/<a\b([^>]*\bclass=["'][^"']*\bteam-player-card\b[^"']*["'][^>]*)>([\s\S]*?)<\/a>/gi);
  for(const match of cards) {
    const a=match[1], body=match[2];
    const link=(a.match(/href=["']([^"']+)["']/i)||[])[1];
    const url=new URL(decodeEntities(link||"/"),"https://junior.fhr.ru/");
    if(url.origin!=="https://junior.fhr.ru" || !/^\/player\/[a-z0-9-]+\/$/.test(url.pathname))continue;
    if(seen.has(url.pathname))continue;
    seen.add(url.pathname);
    const number=cellText((body.match(/team-player-card__number["'][^>]*>([\s\S]*?)<\/span>/i)||[])[1]);
    const name=cellText((body.match(/team-player-card__name["'][^>]*>([\s\S]*?)<\/div>/i)||[])[1]);
    if(!name)continue;
    const additional=cellText((body.match(/team-player-card__additional["'][^>]*>([\s\S]*?)<\/div>/i)||[])[1]);
    const position=(additional.match(/Вратарь|Защитник|Нападающий/i)||[])[0]||"";
    const image=(body.match(/\bsrc=["'](https:\/\/img\.fhr\.ru\/(?:teams|players)\/[^"']+)["']/i)||[])[1];
    players.push({number, name, position,
      photo:onlyFhrImage(image,"players"),url:url.href,source:"FHR"});
  }
  return {
    ok:true,source:"FHR",sourceUrl:team.url,fetchedAt:new Date().toISOString(),
    team,playersCount:players.length,players,
    complete:players.length>0
  };
}

async function getRoster(teamId){
  const directory=await getTeams();
  const team=directory.teams.find(t=>t.id===Number(teamId));
  if(!team)throw new Error("Team not found in FHR tournament");
  const key=new Request("https://cache.kubok-u16-live/api/v1/teams/"+teamId+"?images=v10");
  const cached=await caches.default.match(key);
  if(cached)return await cached.json();
  const response=await fetch(team.url,{headers:{"accept":"text/html","user-agent":"KubokRossiiU16Live/1.1"}});
  if(!response.ok)throw new Error("FHR roster HTTP "+response.status);
  const payload=parseRoster(await response.text(),team);
  if(!payload.playersCount)throw new Error("FHR roster returned no players");
  await caches.default.put(key,new Response(JSON.stringify(payload),{
    headers:{"content-type":"application/json","cache-control":"public,max-age=600"}}));
  return payload;
}


const STATS_SOURCE = "https://junior.fhr.ru/tournaments/kubokrossii-25008909/stats/";
const STATS_AJAX_BASE = "https://junior.fhr.ru/fhr-ajax/SXRwcm9maXRcQXBwXEFqYXhcQWpheFN0YXRz/Z2V0RGF0YVRhYmxlU2ltcGxlU3RhdHM=/";
const STATS_YEAR_ID="25008950";
const STATS_TOURNAMENT_ID="25008909";

function statNumber(value){
  const normalized=cellText(value).replace(/\u00a0/g,"").replace(/\s/g,"").replace(",",".");
  if(normalized==="" || normalized==="—" || normalized==="-")return null;
  const n=Number(normalized);
  return Number.isFinite(n)?n:null;
}
function statText(html,classname){
  if(!/^[a-zA-Z0-9_-]{1,60}$/.test(classname))return "";
  const regex=new RegExp("<(?:span|div)\\b[^>]*\\bclass=[\\\"'][^\\\"']*\\b"+classname+"\\b[^\\\"']*[\\\"'][^>]*>([\\s\\S]*?)<\\/(?:span|div)>","i");
  const found=String(html||"").match(regex);
  return cellText(found?.[1]||"");
}
function officialStatsProfile(html){
  const match=String(html||"").match(/\bhref=["'](\/player\/[^"']+\/)["']/i);
  if(!match)return null;
  try{
    const url=new URL(decodeEntities(match[1]),STATS_SOURCE);
    return url.origin==="https://junior.fhr.ru"&&/^\/player\/[a-z0-9-]+\/$/.test(url.pathname)?url.href:null;
  }catch{return null;}
}
function officialStatsImage(html,category){
  const match=String(html||"").match(new RegExp('https:\\/\\/img\\.fhr\\.ru\\/'+category+'\\/[a-z0-9]+\\/[a-z0-9]+\\/\\d+\\.webp','i'));
  return match?match[0]:null;
}
function parseFhrSkaterStats(record){
  const player=String(record.surname||""),team=String(record.team_name||"");
  const href=officialStatsProfile(player);
  const name=statText(player,"player__name");
  const teamName=statText(team,"team-title");
  const teamCity=statText(team,"team-city");
  if(!href||!name||!teamName)return null;
  const id=Number((href.match(/-(\d+)\/$/)||[])[1]);
  if(!Number.isFinite(id))return null;
  return {
    id,name,number:statText(player,"player__number"),
    position:cellText((player.match(/<span\b[^>]*\bclass=["']player__role["'][^>]*>([\s\S]*?)<\/span>\s*<\/div>/i)||[])[1]||"")
      .replace(/\s+/g," ").trim(),
    photo:officialStatsImage(player,"players"),profile:href,
    team:teamName,city:teamCity,teamLogo:officialStatsImage(team,"teams"),
    gp:statNumber(record.gp),goals:statNumber(record.g),
    assists:statNumber(record.a),points:statNumber(record.pts),
    plusMinus:statNumber(record.plusminus),pim:statNumber(record.pim),
    powerplayGoals:statNumber(record.ppg),shorthandedGoals:statNumber(record.shg),
    shotsPerGame:null,pointsPerGame:statNumber(record.ptspg),
    source:"FHR_STATS"
  };
}
function parseFhrGoalieStats(record){
  const player=String(record.surname||""),team=String(record.team_name||"");
  const href=officialStatsProfile(player);
  const name=statText(player,"player__name"),teamName=statText(team,"team-title");
  if(!href||!name||!teamName)return null;
  const id=Number((href.match(/-(\d+)\/$/)||[])[1]);
  if(!Number.isFinite(id))return null;
  return {
    id,name,number:statText(player,"player__number"),position:"Вратарь",
    photo:officialStatsImage(player,"players"),profile:href,
    team:teamName,city:statText(team,"team-city"),teamLogo:officialStatsImage(team,"teams"),
    gp:statNumber(record.gp),wins:statNumber(record.w),
    losses:statNumber(record.l),timeOnIce:cellText(record.toi),
    saves:statNumber(record.sv),shotsAgainst:statNumber(record.sa),
    savePercentage:statNumber(record.sv_pct),gaa:statNumber(record.gaa),
    goalsAgainst:statNumber(record.ga),shutouts:statNumber(record.so),
    points:statNumber(record.t),pim:statNumber(record.pim),
    source:"FHR_STATS"
  };
}

function discoverStatsGroups(html){
  const filters=[...html.matchAll(/<div\b[^>]*\bclass=["'][^"']*\bfilter-btn\b[^"']*["'][^>]*\bdata-ajax-link=["']([^"']+)["'][^>]*>([\s\S]*?)<\/div>/gi)];
  const map=new Map([["Общая статистика",""]]);
  for(const [,path,labelRaw] of filters){
    const label=cellText(labelRaw);
    try{
      const url=new URL(decodeEntities(path),STATS_SOURCE);
      if(url.origin!=="https://junior.fhr.ru")continue;
      const encoded=url.searchParams.get("params");
      if(!encoded)continue;
      const decoded=atob(encoded);
      const id=(decoded.match(/GROUP_ID";s:\d+:"([^"]+)"/)||[])[1];
      if(label&&id&&/^\d{6,10}$/.test(id))map.set(label,id);
    }catch{}
  }
  return [...map.entries()].map(([name,id])=>({name,id}));
}
async function getStats(queryGroup){
  const requested=String(queryGroup||"").trim().slice(0,95);
  const key=new Request("https://cache.kubok-u16-live/api/v1/stats?group="+encodeURIComponent(requested));
  const cached=await caches.default.match(key);
  if(cached)return await cached.json();
  const page=await fetch(STATS_SOURCE,{headers:{
    "accept":"text/html","user-agent":"JuniorU16-FHRStats/1.0"
  }});
  if(!page.ok)throw new Error("FHR stats page HTTP "+page.status);
  const pageHtml=await page.text();
  const groups=discoverStatsGroups(pageHtml);
  const selected=requested?groups.find(x=>x.name===requested):groups[0];
  if(!selected)throw new Error("Unknown/unpublished FHR statistics group");
  const groupId=selected.id;
  async function getAll(key){
    const url=new URL(STATS_AJAX_BASE);
    for(const [k,value] of Object.entries({
      key,comp:STATS_TOURNAMENT_ID,year:STATS_YEAR_ID,
      group:groupId,season:"2026-2027",draw:"1",start:"0",length:"1500"
    }))url.searchParams.set(k,value);
    const response=await fetch(url.href,{headers:{
      "accept":"application/json","x-requested-with":"XMLHttpRequest",
      "referer":STATS_SOURCE,"user-agent":"JuniorU16-FHRStats/1.0"
    }});
    if(!response.ok)throw new Error("FHR stats "+key+" HTTP "+response.status);
    const json=await response.json();
    if(!json || !Array.isArray(json.data))throw new Error("Invalid FHR stats table "+key);
    const expected=Number(json.recordsFiltered ?? json.recordsTotal);
    if(!Number.isInteger(expected)||expected<0||json.data.length!==expected)
      throw new Error("FHR "+key+" table incomplete: "+json.data.length+"/"+expected);
    return json.data;
  }
  const [rawSkaters,rawGoalies]=await Promise.all([getAll("scorers"),getAll("goalkeeper")]);
  const skaters=rawSkaters.map(parseFhrSkaterStats).filter(Boolean);
  const goalies=rawGoalies.map(parseFhrGoalieStats).filter(Boolean);
  if(skaters.length!==rawSkaters.length||goalies.length!==rawGoalies.length)
    throw new Error("FHR player identity/photo table format changed");
  const payload={
    ok:true,source:"FHR",sourceUrl:STATS_SOURCE,
    tournament:"Кубок России U16",season:"2026/2027",fetchedAt:new Date().toISOString(),
    group:selected.name,availableGroups:groups.map(x=>x.name),
    complete:true,skaterCount:skaters.length,goalieCount:goalies.length,
    skaters,goalies,
    note:"Full official FHR statistics tables. Goalie savePercentage is the source ratio 0–1, not 0–100."
  };
  await caches.default.put(key,new Response(JSON.stringify(payload),{
    headers:{"content-type":"application/json","cache-control":"public,max-age=600"}
  }));
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
        endpoints: {
          matches: "/api/v1/matches",
          live: "/api/v1/live",
          match: "/api/v1/matches/{gameId}", teams: "/api/v1/teams", roster:"/api/v1/teams/{teamId}",stats:"/api/v1/stats?group={optional FHR group name}"
        },
        liveVerified: false,
        note: "Health check only. Match LIVE status is verified separately through FHR match-center pages."
      });
    }

    if(url.pathname==="/api/v1/teams"){
      try{return json(await getTeams(),200,90);}
      catch(error){return json({ok:false,error:"FHR team directory failed",detail:String(error&&error.message||error).slice(0,200)},502,0);}
    }
    const rosterRoute=url.pathname.match(/^\/api\/v1\/teams\/(\d+)\/?$/);
    if(rosterRoute){
      try{return json(await getRoster(Number(rosterRoute[1])),200,90);}
      catch(error){return json({ok:false,error:"FHR roster failed",detail:String(error&&error.message||error).slice(0,200)},502,0);}
    }

    if (url.pathname === "/api/v1/stats") {
      try {
        return json(await getStats(url.searchParams.get("group")),200,60);
      }catch(error){
        return json({ok:false,error:"FHR full statistics unavailable",
          detail:String(error?.message||error).slice(0,220)},502,0);
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

    return json({ ok: false, error: "Not found", endpoints: ["/health", "/api/v1/matches", "/api/v1/live", "/api/v1/matches/{gameId}"] }, 404, 0);
  }
};
