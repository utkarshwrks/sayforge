// Groq contract-generation proxy.
// Verify current model IDs at console.groq.com/docs/models — Groq deprecates models fast.

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEFAULT_MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
const FALLBACK_MODEL = 'llama-3.3-70b-versatile';

// System prompt — used verbatim as the system message.
const SYSTEM_PROMPT = `You are a SAYMAN smart-contract generator. SAYMAN runs plain JavaScript contracts in a sandboxed vm — NOT the EVM, NOT Solidity.

Output ONLY a JSON object (no markdown, no backticks, no prose) with this exact schema:
{
  "contractName": "PascalCaseName",
  "code": "const contract = { methods: { ... } };",
  "summary": "one sentence describing what it does",
  "methods": [
    { "name": "methodName", "description": "...", "stateChanging": true,
      "args": [ { "name": "x", "type": "number|string|boolean|address" } ] }
  ]
}

CONTRACT RULES — follow every one:
- Always use the object shape: const contract = { methods: { ... } };
- The ONLY identifiers you may use inside methods are: msg.sender, msg.caller, args, blockTimestamp, getState(key), setState(key, value), getBalance(address), transfer(to, amount), emit(name, data), require(cond, message), hash(data), generateAddress(seed). Anything else is undefined and will crash.
- NEVER use: fetch, import, module require, process, fs, eval, Function, setTimeout, setInterval, window, document, globalThis, Math.random, or a bare \`caller\`/\`state\`.
- Persist all cross-call data (including any owner address) via getState/setState. There is no ambient state.
- Validate all inputs with require(...) at the top of each state-changing method.
- For any privileged/admin method (mint, withdraw, setOwner, pause, etc.), require(msg.sender === getState('owner')). If the contract needs an owner, set it on first call if unset.
- All token/coin amounts are integer base units (1 SAYN = 100,000,000). Never use decimals.
- No unbounded loops — execution is killed after 5 seconds.
- Read-only methods must not call setState/transfer/emit and should have stateChanging=false.`;

/**
 * Call Groq and return the parsed JSON contract object.
 * Retries once on parse failure, then falls back to a second model.
 */
export async function generateContract(description) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    const err = new Error('GROQ_API_KEY is not set on the server.');
    err.status = 500;
    err.code = 'NO_KEY';
    throw err;
  }

  const models = [DEFAULT_MODEL, FALLBACK_MODEL];
  let lastError;

  for (const model of models) {
    // Two attempts per model: one normal, one "return valid JSON only" retry.
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const body = {
          model,
          temperature: 0.2,
          max_completion_tokens: 2000,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            {
              role: 'user',
              content:
                attempt === 0
                  ? description
                  : `${description}\n\nYour previous reply was not valid JSON. Reply with ONLY the JSON object described in the schema.`,
            },
          ],
        };

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        let res;
        try {
          res = await fetch(GROQ_URL, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(body),
            signal: controller.signal,
          });
        } finally {
          clearTimeout(timeout);
        }

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          if (res.status === 401) {
            const e = new Error('Groq rejected the API key (401). Check GROQ_API_KEY.');
            e.status = 401;
            e.code = 'BAD_KEY';
            throw e;
          }
          if (res.status === 429) {
            const e = new Error('Groq rate limit hit (429). Wait a moment and try again.');
            e.status = 429;
            e.code = 'RATE_LIMIT';
            throw e;
          }
          // 404/400 often means the model id is stale — let the loop try the fallback.
          lastError = new Error(`Groq error ${res.status} for model "${model}": ${text.slice(0, 300)}`);
          break; // break attempt loop, move to next model
        }

        const json = await res.json();
        const content = json?.choices?.[0]?.message?.content;
        if (!content) {
          lastError = new Error('Groq returned an empty completion.');
          continue;
        }

        const parsed = safeParse(content);
        if (!parsed) {
          lastError = new Error('Groq returned unparseable JSON.');
          continue; // retry once within same model
        }

        const normalized = normalizeContract(parsed);
        if (!normalized) {
          lastError = new Error('Groq JSON was missing required fields (contractName/code).');
          continue;
        }
        return normalized;
      } catch (e) {
        if (e.code === 'BAD_KEY') throw e; // no point retrying a bad key
        if (e.name === 'AbortError') {
          lastError = new Error('Groq request timed out after 30s.');
          continue;
        }
        lastError = e;
      }
    }
  }

  const err = new Error(lastError?.message || 'Groq generation failed.');
  err.status = 502;
  err.code = 'GROQ_FAILED';
  throw err;
}

function safeParse(content) {
  try {
    return JSON.parse(content);
  } catch {
    // Some models wrap JSON in prose/backticks despite instructions — salvage it.
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        return null;
      }
    }
    return null;
  }
}

function normalizeContract(parsed) {
  const code = typeof parsed.code === 'string' ? parsed.code : null;
  const contractName =
    typeof parsed.contractName === 'string' && parsed.contractName.trim()
      ? parsed.contractName.trim()
      : 'GeneratedContract';
  if (!code) return null;

  const methods = Array.isArray(parsed.methods)
    ? parsed.methods
        .filter((m) => m && typeof m.name === 'string')
        .map((m) => ({
          name: m.name,
          description: typeof m.description === 'string' ? m.description : '',
          stateChanging: m.stateChanging !== false,
          args: Array.isArray(m.args)
            ? m.args
                .filter((a) => a && typeof a.name === 'string')
                .map((a) => ({ name: a.name, type: normalizeType(a.type) }))
            : [],
        }))
    : [];

  return {
    contractName,
    code,
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    methods,
  };
}

function normalizeType(t) {
  const allowed = ['number', 'string', 'boolean', 'address'];
  return allowed.includes(t) ? t : 'string';
}
