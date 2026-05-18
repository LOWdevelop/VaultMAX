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

export function serializeEmbedding(embedding: Float32Array): Buffer {
  return Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength);
}

export function deserializeEmbedding(buf: Buffer | Uint8Array): Float32Array {
  // Copy into a fresh ArrayBuffer to guarantee 4-byte alignment for Float32Array view
  const src = buf instanceof Buffer ? buf : Buffer.from(buf);
  const ab = new ArrayBuffer(src.byteLength);
  new Uint8Array(ab).set(src);
  return new Float32Array(ab);
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  let dot = 0,
    normA = 0,
    normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
