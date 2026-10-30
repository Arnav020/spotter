export type TavilyHit = { title: string; url: string; content: string };

export async function searchProcedure(task: string): Promise<{ hits: TavilyHit[]; ms: number }> {
  const key = process.env.TAVILY_API_KEY;
  if (!key) return { hits: [], ms: 0 };

  const started = Date.now();
  const res = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      query: `${task} step by step procedure official safety guidelines`,
      search_depth: "advanced",
      max_results: 5,
      include_answer: false,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) return { hits: [], ms: Date.now() - started };
  const data = await res.json();
  const hits: TavilyHit[] = (data.results ?? []).map((r: TavilyHit) => ({
    title: r.title,
    url: r.url,
    content: String(r.content ?? "").slice(0, 1500),
  }));
  return { hits, ms: Date.now() - started };
}
