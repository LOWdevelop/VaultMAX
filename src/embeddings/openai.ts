import OpenAI from 'openai';

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

export async function generateEmbedding(text: string): Promise<Float32Array> {
  try {
    const response = await getClient().embeddings.create({
      model: 'text-embedding-3-small',
      input: text,
    });
    return new Float32Array(response.data[0].embedding);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`OpenAI embedding failed: ${msg}`);
  }
}

export function serializeEmbedding(embedding: Float32Array): string {
  return JSON.stringify(Array.from(embedding));
}

export function deserializeEmbedding(json: string): Float32Array {
  return new Float32Array(JSON.parse(json) as number[]);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
