# x402 Notary — Cryptographic Receipts for AI Outputs

**Prove what your AI said, when it said it, and which model said it.**

Every AI output is just text. There's no proof a specific model produced a specific response at a specific time — and as agents start hiring other agents, that trust gap gets expensive. x402 Notary closes it: submit any inference, pay **$0.001** in USDC (automatic, via [x402](https://x402.org) on Base — no API key, no account), and get back a **signed, timestamped, chain-anchored receipt** that anyone can verify, free, forever.

> **We notarize the hash, not your secrets.** Your prompt and response are hashed and signed — never stored. Private signed receipts, publicly anchored by batch root on Base.

## Quick start (Claude Desktop / Claude Code / any MCP client)

```json
{
  "mcpServers": {
    "x402-notary": {
      "command": "npx",
      "args": ["-y", "@forgemeshlabs/x402-notary-mcp"],
      "env": {
        "WALLET_PRIVATE_KEY": "0x..."
      }
    }
  }
}
```

`WALLET_PRIVATE_KEY` is a **dedicated low-balance Base wallet** for x402 micropayments — never your primary wallet. $1 of USDC notarizes 1,000 outputs.

**Verification needs no wallet at all.** Skip the `env` block entirely and you can still verify receipts, inspect attestations, and read live stats.

## Tools

| Tool | Cost | What it does |
|---|---|---|
| `notarize_inference` | $0.001 | Signed receipt for one `{prompt, response, model_id}` |
| `notarize_batch` | $0.005 | Up to 20 receipts in one call — built for audit trails |
| `verify_attestation` | **free** | Check any receipt: signature, content hash, Merkle proof |
| `get_receipt` | **free** | Fetch the public proof material for an attestation |
| `notary_stats` | **free** | Live volume, top models, anchored batches |
| `notary_pubkey` | **free** | The notary's Ed25519 key — verify receipts fully offline |

## What a receipt proves

When you notarize an inference you get an attestation:

```json
{
  "attestation_id": "att_64d22f5f5c95d0e759ad54dc",
  "content_hash": "sha256 of {prompt, response, model_id, timestamp}",
  "signature": "Ed25519 — verifiable offline against the public notary key",
  "notarized_at": "2026-07-03T02:47:11.000Z",
  "anchor": { "status": "sealed", "merkle_root": "…", "proof": ["…"] }
}
```

That's proof of three things:

1. **Existence** — this exact content existed at this exact time.
2. **Integrity** — change one character of the prompt or response and verification fails.
3. **Independence** — signatures verify offline with the published key; Merkle roots anchor batches on Base. You don't have to trust the notary's word after the fact.

## Verify anything, free, from anywhere

Any agent (or human, or CI job) can check a receipt before acting on the output behind it:

```bash
curl -s https://notary.forgemesh.io/api/verify \
  -H 'content-type: application/json' \
  -d '{"attestation_id":"att_…","prompt":"…","response":"…","model_id":"openai/gpt-5"}'
```

`"valid": true` means the content matches the notarized hash **and** the notary's Ed25519 signature checks out. Tampered content is rejected with the exact failing check.

## When should an agent notarize?

Not every call — the outputs that matter:

- **Agent-to-agent handoffs** — prove what you passed downstream came from this model, unmodified
- **Paid deliverables** — research, reports, recommendations someone is paying for
- **Compliance & audit trails** — decisions that affect money, legal exposure, or reputation
- **Dispute prevention** — "this is exactly what was generated, at exactly this time"
- **Marketplace reputation** — build a public, verifiable reliability trail for your agent or service

Casual chat and scratchpad reasoning don't need receipts. Externalized outputs do.

## Privacy, by design

- Raw prompts, responses, and metadata are **not persisted** — the notary computes the hash, signs it, and discards the content.
- Receipts contain proof material only: hash, signature, timestamps, model id, Merkle proof.
- Only Merkle **batch roots** are anchored on-chain. Your content never touches a public chain.
- Verification works by *you* supplying your original content — the notary can't reveal what it never kept.

## How payment works

No signup, no API key, no subscription. The first request returns an HTTP 402 challenge; your MCP client signs a USDC payment authorization (EIP-3009) and retries. Settlement happens on Base in seconds and the receipt lands in the same response — including the payment transaction hash under `_payment`.

## Direct API

Prefer raw HTTP? The full agent-readable surface:

- `https://notary.forgemesh.io/llms.txt` — one-page summary for agents
- `https://notary.forgemesh.io/openapi.json` — OpenAPI 3.1 with x402 payment metadata
- `https://notary.forgemesh.io/.well-known/x402.json` — x402 discovery manifest

## FAQ

**Is my prompt stored anywhere?** No. The hash is computed, signed, and the raw text is discarded. This is the default and only mode.

**Do I need an account or API key?** No. x402 payments are the only credential.

**What does verification cost?** Nothing, for anyone, forever. Charging to verify would defeat the point of a trust primitive.

**What chain and token?** USDC on Base mainnet (`eip155:8453`).

**Can I verify receipts without contacting the notary?** Yes — fetch the Ed25519 public key once (`notary_pubkey`) and verify signatures offline.

---

Built by [ForgeMesh Labs](https://forgemesh.io) · Powered by the [x402 protocol](https://x402.org) · MIT License
