import OpenAI from 'openai';

let _client: OpenAI | null = null;

function getClient(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'dummy' });
  }
  return _client;
}

export async function generateEmbedding(text: string): Promise<Float32Array> {
  const apiKey = process.env.OPENAI_API_KEY;
  const isKeyValid = apiKey && apiKey.startsWith('sk-') && !apiKey.includes('INSIRA_SUA_CHAVE_OPENAI_AQUI');

  if (isKeyValid) {
    try {
      const response = await getClient().embeddings.create({
        model: 'text-embedding-3-small',
        input: text,
      });
      return new Float32Array(response.data[0].embedding);
    } catch (err) {
      console.warn("OpenAI API call failed, falling back to local string matching:", err);
    }
  }

  // Local Hashing Vectorizer (Offline / Free Fallback)
  const vector = new Float32Array(1536);
  const words = text.toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0);
  
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
    const idx = hashToIndex(word);
    vector[idx] += 2.0;
  }

  for (const ngram of ngrams) {
    const idx = hashToIndex(ngram);
    vector[idx] += 0.5;
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
