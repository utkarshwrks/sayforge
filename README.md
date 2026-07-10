# SAYFORGE

**AI smart-contract studio for the SAYMAN blockchain.**

> *Describe it. Deploy it. On-chain in 30 seconds — no Solidity, no setup.*

Type what you want in plain English → **Groq** generates a valid SAYMAN JavaScript
contract → a static **safety validator** checks it → SAYFORGE deploys it to the
SAYMAN public testnet in one click → an **interaction console** is auto-generated
to call the contract's methods and read its state.

One sentence in, a live on-chain dApp out.

---

## Architecture (one deployable unit)

```
Browser (React/Vite)
  ├── POST /api/generate ──► Express ──► Groq API      (key stays server-side)
  └── /api/rpc/* ──────────► Express ──► SAYMAN testnet (no key; signing is client-side)
```

- **Frontend:** React + Vite + TypeScript + Tailwind, Monaco editor (with a
  `<textarea>` fallback).
- **Backend:** a thin Express server that (a) serves the built client and
  (b) proxies Groq so the API key never reaches the browser. It also forwards
  SAYMAN RPC calls (`/api/rpc/*`) to avoid CORS — no secrets are involved; the
  transaction is already signed in the browser.
- **Signing:** `@noble/secp256k1` + `@noble/hashes` in the browser. The private
  key never leaves the client.

### Repo layout

```
sayforge/
  server/
    index.js          # Express: static hosting + /api/generate + /api/rpc proxy
    groq.js           # Groq request + the contract-generation system prompt
  client/
    src/
      lib/sayman.ts    # SAYMAN client: wallet, sign, broadcast, deploy, call, read
      lib/validator.ts # deterministic static contract validator
      components/...    # UI
      App.tsx
    index.html
  package.json
  .env.example
  README.md
```

---

## Run locally

```bash
# 1. install
npm install

# 2. configure
cp .env.example .env        # then edit .env and set GROQ_API_KEY=...

# 3a. dev (Vite on :5173 + Express on :3001, hot reload)
npm run dev
#   open http://localhost:5173

# 3b. OR production-style (build the client, serve everything on one port)
npm run build
npm start
#   open http://localhost:3001
```

Environment variables (`.env`):

| var             | default                        | notes                                   |
| --------------- | ------------------------------ | --------------------------------------- |
| `GROQ_API_KEY`  | —                              | **required**, server-side only          |
| `GROQ_MODEL`    | `openai/gpt-oss-120b`          | fallback `llama-3.3-70b-versatile`      |
| `SAYMAN_RPC`    | `https://sayman.onrender.com`  | REST API lives under `/api`             |
| `PORT`          | `3001`                         | Render sets this automatically          |

---

## Deploy to Render (single Node web service)

1. Push this repo to GitHub.
2. In Render: **New → Web Service**, point it at the repo.
3. Settings:
   - **Environment:** Node
   - **Build Command:** `npm install && npm run build`
   - **Start Command:** `npm start`
4. **Environment variables:** set `GROQ_API_KEY` (required),
   optionally `GROQ_MODEL` and `SAYMAN_RPC`. Do **not** set `PORT` — Render
   injects it and `npm start` reads `process.env.PORT`.
5. Deploy. The Express server serves the built client and the API on one port.

**Alternatives:** the same single-service setup works on **Railway**
(add the repo, set the build/start commands and env vars) or **Fly.io**
(`fly launch`, set the same commands, `fly secrets set GROQ_API_KEY=...`).

---

## How the SAYMAN integration works

- **Denomination:** `1 SAYN = 100,000,000` base units. All on-chain amounts are
  integers in base units. The app also reads `GET /api/denomination` on load.
- **Wallet:** secp256k1, generated client-side. Address = first 40 hex chars of
  `SHA-256(publicKeyHex)`. Persisted in `localStorage`; import your own key any time.
- **Signing:** ECDSA over `SHA-256(payloadString)` where
  `payloadString = JSON.stringify({ type, timestamp, data, gasLimit, gasPrice, nonce })`
  in that exact key order. The broadcast body includes the `publicKey` so the node
  re-derives and checks the address.
- **Writes** go through `POST /api/broadcast` and only **queue** in the mempool;
  they land on the **next block (~5s)**. There is no events API — the app polls.
- **Faucet:** `POST /api/faucet { address }` drips 1000 SAYN on the next block;
  the app polls the balance until it's non-zero before enabling Deploy.
- **Reading state:** `GET /api/contracts/:address` returns the whole contract
  object including `state`; the app diffs it after each call.

> **Signing note:** the wallet uses the compressed-secp256k1 public-key encoding
> for both the address derivation and the broadcast `publicKey`. If the live
> SAYMAN node expects a different encoding, flip `PUBKEY_COMPRESSED` in
> `client/src/lib/sayman.ts` (one line). Verify a real `TRANSFER` lands before
> relying on deploy.

---

## The validator

`client/src/lib/validator.ts` is deterministic and runs in the browser. It
**FAIL**s on forbidden globals (`fetch`, `process`, `eval`, `import`, …) and on
the documented undefined-global bug — a bare `caller` or bare `state` — that
shipped in SAYMAN's own reference contracts. It **WARN**s on `Math.random`,
unguarded privileged methods, unbounded loops, and unvalidated inputs. Deploy is
allowed on `pass`/`warn` and blocked on `fail`.
