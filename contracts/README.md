# Example SAYMAN contracts

These are the exact contracts SAYFORGE deploys in its demo/tests. They follow the
SAYMAN **object-VM** shape — plain JavaScript, sandboxed, NOT the EVM.

> **Note:** SAYFORGE does not read these files at runtime. Contracts are generated
> on demand by Groq and deployed straight from the browser. These files exist so you
> can read, tweak, and reuse the reference contracts.

| File | What it does |
| --- | --- |
| `TipJar.js` | Anyone tips; first tipper is owner and can withdraw the pot. |
| `Counter.js` | Anyone increments a shared counter. |
| `Poll3.js` | 3-option poll; one vote per address. |

## Available sandbox globals (the ONLY identifiers a contract may use)

`msg.sender`, `msg.caller`, `args`, `blockTimestamp`, `getState(key)`,
`setState(key, value)`, `getBalance(address)`, `transfer(to, amount)`,
`emit(name, data)`, `require(cond, message)`, `hash(data)`, `generateAddress(seed)`.

Anything else (`fetch`, `process`, `eval`, a bare `caller`/`state`, …) is undefined
and crashes at call time — which is exactly what `client/src/lib/validator.ts` checks
for before you deploy.

## Deploying one manually

Paste any of these into the SAYFORGE prompt result editor, or POST a signed
`CONTRACT_DEPLOY` transaction to `${SAYMAN_RPC}/api/broadcast` (see
`client/src/lib/sayman.ts` for the signing scheme).
