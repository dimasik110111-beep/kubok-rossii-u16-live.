import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import worker, { fetchFhr } from "../src/worker.js";

const calendarUrl = "https://junior.fhr.ru/tournaments/kubokrossii-25008909/calendar/";
const originalFetch = globalThis.fetch;
const originalCaches = globalThis.caches;
afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.caches = originalCaches;
});

function fakeCache({ fail = false } = {}) {
  const saved = new Map();
  globalThis.caches = { default: {
    async match(key) {
      if (fail) throw new Error("cache unavailable");
      return saved.get(key.url)?.clone();
    },
    async put(key, response) {
      if (fail) throw new Error("cache full");
      saved.set(key.url, response.clone());
    },
  }};
  return saved;
}
function fixtureCalendar() {
  return `<table><tr>
    <td>1</td><td>19.11.2026</td><td>18:00</td><td>ЦСКА Москва</td>
    <td><a href="/games/25170469/">3:1</a></td><td>Спартак Москва</td>
    <td>ЛА Арена</td></tr></table>` + "<!-- padding -->".repeat(40);
}
function request(path) {
  return worker.fetch(new Request("https://example.workers.dev" + path));
}

test("health responds independently of the FHR upstream", async () => {
  globalThis.fetch = async () => { throw new Error("must not contact FHR"); };
  const response = await request("/health");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).ok, true);
});

test("a hanging fetch is bounded even if the transport ignores abort", async () => {
  let signal;
  globalThis.fetch = (_, options) => {
    signal = options.signal;
    return new Promise(() => {});
  };
  await assert.rejects(fetchFhr(calendarUrl, {}, 15), /timed out/);
  assert.equal(signal.aborted, true);
});

test("the deadline covers a response body that stops streaming", async () => {
  let cancelled = false;
  globalThis.fetch = async (_, { signal }) => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("<html>"));
      signal.addEventListener("abort", () => {
        cancelled = true;
        controller.error(signal.reason);
      });
    },
  }));
  await assert.rejects(fetchFhr(calendarUrl, {}, 15), /timed out/);
  assert.equal(cancelled, true);
});

test("a failed group retains successful matches and allows a quick retry", async () => {
  const saved = fakeCache();
  globalThis.fetch = async (url) => {
    if (url === calendarUrl) return new Response(
      `<div data-ajax-link="/group-a/">Группа А-I</div>` +
      `<div data-ajax-link="/group-b/">Группа Б-I</div>`);
    if (url.endsWith("/group-a/")) return new Response(fixtureCalendar());
    throw new Error("FHR request timed out after 6000 ms");
  };
  const response = await request("/api/v1/matches");
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.matches.length, 1);
  assert.equal(data.matches[0].gameId, 25170469);
  assert.equal(data.matches[0].homeScore, 3);
  assert.equal(data.groupsFetched, 1);
  assert.equal(data.groupErrors.length, 1);
  assert.equal(data.partial, true);
  assert.equal(response.headers.get("cache-control"), "public, max-age=5");
  assert.match(data.groupErrors[0].error, /timed out/);
  assert.equal([...saved.values()][0].headers.get("cache-control"), "public, max-age=5");
});

test("edge cache failures do not hide a valid upstream response", async () => {
  fakeCache({ fail: true });
  globalThis.fetch = async (url) => new Response(url === calendarUrl
    ? `<div data-ajax-link="/group-a/">Группа А-I</div>`
    : fixtureCalendar());
  const response = await request("/api/v1/matches");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).matches.length, 1);
});

test("a calendar without its group catalog is explicitly partial", async () => {
  fakeCache();
  globalThis.fetch = async () => new Response(fixtureCalendar());
  const response = await request("/api/v1/matches");
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.partial, true);
  assert.equal(data.matches.length, 1);
  assert.ok(data.groups[0].error);
});

test("an HTTP 200 maintenance page cannot become a valid match protocol", async () => {
  globalThis.fetch = async () => new Response("<html>Maintenance</html>",
    { headers: { "content-type": "text/html" } });
  const response = await request("/api/v1/matches/25170469");
  const data = await response.json();
  assert.equal(response.status, 502);
  assert.equal(data.ok, false);
  assert.equal(data.gameId, 25170469);
  assert.match(data.detail, /both teams/);
});

test("valid native match details retain identity, final status and score", async () => {
  globalThis.fetch = async () => new Response(`
    <span class="team-title">ЦСКА</span><span class="team-city">Москва</span>
    <span class="team-title">Спартак</span><span class="team-city">Москва</span>
    <span class="match-result">Матч завершён</span>
    <div class="match-score"><span class="text-score">3</span><span class="text-score">1</span></div>
  `, { headers: { "content-type": "text/html" } });
  const response = await request("/api/v1/matches/25170469");
  const data = await response.json();
  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.gameId, 25170469);
  assert.equal(data.home, "ЦСКА Москва");
  assert.equal(data.away, "Спартак Москва");
  assert.equal(data.status, "FINAL");
  assert.equal(data.homeScore, 3);
  assert.equal(data.awayScore, 1);
});
