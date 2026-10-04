// Minimal Gemini API client (REST) for Gemma models: JSON-schema output, thought parts stripped,
// retries that rotate through fallback models when one is overloaded (free-tier Gemma often returns 503).
const BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

function retryDelayMs(err, attempt) {
  const info = (err?.details || []).find((d) => String(d['@type'] || '').includes('RetryInfo'));
  const s = info && parseFloat(info.retryDelay);
  return Number.isFinite(s) ? Math.min(60_000, s * 1000 + 500) : [3000, 8000, 20000][attempt] || 20000;
}

// Free-tier Gemma has tight per-minute limits, so cap how many calls are in flight at once.
const MAX_INFLIGHT = Number(process.env.GEMINI_CONCURRENCY) || 2;
let inflight = 0;
const waiters = [];
export async function withGeminiSlot(fn, onWait) {
  if (inflight >= MAX_INFLIGHT) {
    onWait?.();
    await new Promise((r) => waiters.push(r));
  }
  inflight++;
  try { return await fn(); } finally {
    inflight--;
    waiters.shift()?.();
  }
}

export async function geminiGenerate({ model, system, user, schema, signal, timeoutMs = 60_000, attempts = 3, onRetry }) {
  const models = [].concat(model);
  const body = {
    contents: [{ role: 'user', parts: [{ text: user }] }],
    ...(system && { systemInstruction: { parts: [{ text: system }] } }),
    ...(schema && { generationConfig: { responseMimeType: 'application/json', responseSchema: schema } }),
  };
  let lastErr;
  for (let attempt = 0; attempt < attempts; attempt++) {
    const use = models[attempt % models.length];
    const next = models[(attempt + 1) % models.length];
    const timeout = AbortSignal.timeout(timeoutMs);
    let res;
    try {
      res = await fetch(`${BASE}/${use}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      });
    } catch (e) {
      if (signal?.aborted) throw e;
      lastErr = e;
      if (attempt < attempts - 1) { onRetry?.(`${use} ${e.name === 'TimeoutError' ? 'timed out' : e.message}, trying ${next}`); continue; }
      throw e;
    }
    const data = await res.json().catch(() => ({}));
    if (res.ok) {
      const cand = data.candidates?.[0];
      const text = (cand?.content?.parts || []).filter((p) => !p.thought && p.text).map((p) => p.text).join('');
      const u = data.usageMetadata || {};
      return {
        model: use,
        text,
        finish: cand?.finishReason,
        blocked: data.promptFeedback?.blockReason,
        usage: { input: u.promptTokenCount || 0, output: (u.candidatesTokenCount || 0) + (u.thoughtsTokenCount || 0) },
      };
    }
    const err = data.error || { code: res.status, message: res.statusText };
    lastErr = Object.assign(new Error(`${use} ${err.code}: ${err.message}`), { status: res.status });
    if (!RETRYABLE.has(res.status) || attempt === attempts - 1) throw lastErr;
    // quotas are per model: switching models needs only a short pause; the same model again backs off properly
    const wait = next !== use ? 1500 : retryDelayMs(err, attempt);
    onRetry?.(`${use} HTTP ${res.status}, trying ${next} in ${Math.round(wait / 1000)}s`);
    await new Promise((r, j) => {
      const t = setTimeout(r, wait);
      signal?.addEventListener('abort', () => { clearTimeout(t); j(signal.reason); }, { once: true });
    });
  }
  throw lastErr;
}
