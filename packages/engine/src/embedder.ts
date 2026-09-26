// Text embeddings for semantic element matching.
// Default: the ML service's MiniLM model (sentence-transformers). Fallback: a deterministic
// character n-gram hashing embedder, so the engine still heals selectors fully offline.

export interface Embedder {
  readonly name: string;
  embed(texts: string[]): Promise<number[][]>;
  /** Resolves once the embedder knows which backend it will use, so `name` is accurate. */
  ready?(): Promise<void>;
}

const DIM = 512;

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export class HashingEmbedder implements Embedder {
  readonly name = 'hashing-ngram';
  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => {
      const v = new Array<number>(DIM).fill(0);
      const norm = ` ${t
        .toLowerCase()
        .replace(/[^a-z0-9 ]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()} `;
      for (let i = 0; i + 3 <= norm.length; i++) v[fnv1a(norm.slice(i, i + 3)) % DIM] += 1;
      for (const w of norm.trim().split(' ')) if (w) v[fnv1a('w:' + w) % DIM] += 2;
      const len = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
      return v.map((x) => x / len);
    });
  }
}

export class RemoteEmbedder implements Embedder {
  private readonly fallback = new HashingEmbedder();
  private healthy = true;
  constructor(private readonly baseUrl: string) {}

  /** Reports the backend actually in use: the service's model, or the local fallback. */
  get name() {
    return this.healthy ? 'minilm' : `${this.fallback.name} (offline fallback)`;
  }

  async ready() {
    await this.embed(['probe']);
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (!this.healthy) return this.fallback.embed(texts);
    try {
      const res = await fetch(`${this.baseUrl}/embed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ texts }),
        signal: AbortSignal.timeout(5000),
      });
      if (!res.ok) throw new Error(`embed ${res.status}`);
      const body = (await res.json()) as { vectors: number[][] };
      return body.vectors;
    } catch {
      this.healthy = false; // stay on the local fallback for the rest of the run
      return this.fallback.embed(texts);
    }
  }
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0,
    na = 0,
    nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export function makeEmbedder(mlUrl?: string): Embedder {
  return mlUrl ? new RemoteEmbedder(mlUrl) : new HashingEmbedder();
}
