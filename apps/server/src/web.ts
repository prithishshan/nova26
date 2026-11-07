import * as cheerio from "cheerio";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

async function get(url: string, ms = 15000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": UA, Accept: "text/html,*/*", "Accept-Language": "en-US,en;q=0.9" },
    });
  } finally {
    clearTimeout(t);
  }
}

export type SearchResult = { title: string; url: string; snippet: string };

export async function webSearch(query: string): Promise<SearchResult[]> {
  const res = await get(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
  const $ = cheerio.load(await res.text());
  const out: SearchResult[] = [];
  $(".result").each((_, el) => {
    if (out.length >= 8) return;
    const a = $(el).find("a.result__a").first();
    let href = a.attr("href") || "";
    const m = href.match(/[?&]uddg=([^&]+)/);
    if (m) href = decodeURIComponent(m[1]);
    if (href.startsWith("//")) href = "https:" + href;
    if (!href || href.includes("duckduckgo.com/y.js")) return; // ads
    out.push({ title: a.text().trim(), url: href, snippet: $(el).find(".result__snippet").text().trim() });
  });
  if (!out.length) throw new Error(`no results (DuckDuckGo status ${res.status}; may be rate-limited)`);
  return out;
}

export async function fetchPage(url: string, max = 8000): Promise<string> {
  try {
    const r = await get(`https://r.jina.ai/${url}`, 20000);
    if (r.ok) {
      const t = await r.text();
      if (t.trim().length > 200) return t.slice(0, max);
    }
  } catch {}
  const r = await get(url);
  const $ = cheerio.load(await r.text());
  $("script,style,noscript,svg,iframe").remove();
  const title = $("title").text().trim();
  const text = $("body").text().replace(/\s+/g, " ").trim();
  return `${title}\n\n${text}`.slice(0, max);
}
