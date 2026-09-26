// HTTP clients for the Python ML service (Tier 2 ranker, Tier 3 local LLM).
// Every call has a timeout, and a failing service is marked down so a run degrades gracefully.

export interface RankerClient {
  score(features: number[][]): Promise<number[] | null>;
}

export interface LlmChoice {
  index: number;
  reason: string;
}

export interface LlmVerdict {
  isBug: boolean;
  title: string;
  reason: string;
}

export interface LlmClient {
  readonly model: string;
  choose(input: { url: string; title: string; text: string; candidates: string[]; history: string[] }): Promise<LlmChoice | null>;
  judge(input: { action: string; url: string; before: string; after: string }): Promise<LlmVerdict | null>;
}

async function post<T>(url: string, body: unknown, timeoutMs: number): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${url} → ${res.status}`);
  return (await res.json()) as T;
}

export class HttpRanker implements RankerClient {
  private down = false;
  constructor(private readonly baseUrl: string) {}
  async score(features: number[][]): Promise<number[] | null> {
    if (this.down) return null;
    try {
      const r = await post<{ scores: number[] }>(`${this.baseUrl}/rank`, { features }, 3000);
      return r.scores;
    } catch {
      this.down = true;
      return null;
    }
  }
}

export class HttpLlm implements LlmClient {
  private down = false;
  constructor(
    private readonly baseUrl: string,
    readonly model = 'local',
  ) {}

  async choose(input: Parameters<LlmClient['choose']>[0]): Promise<LlmChoice | null> {
    if (this.down) return null;
    try {
      const r = await post<LlmChoice>(`${this.baseUrl}/llm/choose`, input, 60000);
      return r.index >= 0 && r.index < input.candidates.length ? r : null;
    } catch {
      this.down = true;
      return null;
    }
  }

  async judge(input: Parameters<LlmClient['judge']>[0]): Promise<LlmVerdict | null> {
    if (this.down) return null;
    try {
      const r = await post<{ is_bug: boolean; title: string; reason: string }>(`${this.baseUrl}/llm/judge`, input, 60000);
      return { isBug: r.is_bug, title: r.title, reason: r.reason };
    } catch {
      this.down = true;
      return null;
    }
  }
}
