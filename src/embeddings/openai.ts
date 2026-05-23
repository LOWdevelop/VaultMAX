import OpenAI from 'openai';

/** Identifiers stored per-memory so vectors from incompatible spaces are never compared. */
export const OPENAI_EMBED_MODEL = 'text-embedding-3-small';
export const LOCAL_EMBED_MODEL = 'local-hash-v1';
export const OPENAI_CHAT_MODEL = 'gpt-4o-mini';

export interface EmbeddingResult {
  /** The 1536-dim embedding vector. */
  vector: Float32Array;
  /** Which model produced the vector — stored in memories.embedding_model. */
  model: string;
}

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'dummy' });
  }
  return _client;
}

function hasUsableKey(): boolean {
  const apiKey = process.env.OPENAI_API_KEY;
  return !!apiKey && apiKey.startsWith('sk-') && !apiKey.includes('INSIRA_SUA_CHAVE_OPENAI_AQUI');
}

/**
 * Generates an embedding for `text`, returning both the vector and the model
 * that produced it.
 *
 * If an OpenAI key is configured, the OpenAI model is used. A failed API call
 * is NOT silently downgraded to the local hash vectorizer: doing so would store
 * a vector in an incompatible space and permanently poison the index. Instead
 * the error is thrown so the caller can fail the write and the user can retry.
 *
 * If no key is configured, the local hash vectorizer is the intended offline
 * mode and is used directly.
 */
export async function generateEmbedding(text: string): Promise<EmbeddingResult> {
  const safeText = text.slice(0, 30000);
  if (hasUsableKey()) {
    const response = await getClient().embeddings.create({
      model: OPENAI_EMBED_MODEL,
      input: safeText,
    });
    return { vector: new Float32Array(response.data[0].embedding), model: OPENAI_EMBED_MODEL };
  }

  return { vector: localHashEmbedding(safeText), model: LOCAL_EMBED_MODEL };
}

/**
 * Offline / free fallback: a deterministic hashing vectorizer.
 * NOTE: vectors produced here live in a different space than OpenAI embeddings
 * and must never be compared against them — hence the LOCAL_EMBED_MODEL tag.
 */
function localHashEmbedding(text: string): Float32Array {
  const vector = new Float32Array(1536);
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0);

  const ngrams: string[] = [];
  for (let i = 0; i < text.length - 2; i++) {
    ngrams.push(text.substring(i, i + 3).toLowerCase());
  }

  const hashToIndex = (str: string): number => {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash << 5) - hash + str.charCodeAt(i);
      hash |= 0;
    }
    return Math.abs(hash) % 1536;
  };

  for (const word of words) {
    vector[hashToIndex(word)] += 2.0;
  }
  for (const ngram of ngrams) {
    vector[hashToIndex(ngram)] += 0.5;
  }

  let sumSq = 0;
  for (let i = 0; i < vector.length; i++) {
    sumSq += vector[i] * vector[i];
  }
  const norm = Math.sqrt(sumSq);
  if (norm > 0) {
    for (let i = 0; i < vector.length; i++) {
      vector[i] /= norm;
    }
  }

  return vector;
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

export function isModelCompatible(modelA: string, modelB: string): boolean {
  if (modelA === 'unknown' || modelB === 'unknown') return true;
  return modelA === modelB;
}
