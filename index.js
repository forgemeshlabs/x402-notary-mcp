#!/usr/bin/env node
"use strict";

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const { x402Client, x402HTTPClient } = require("@x402/core/client");
const { ExactEvmScheme } = require("@x402/evm/exact/client");
const { toClientEvmSigner } = require("@x402/evm");
const { privateKeyToAccount } = require("viem/accounts");
const { createPublicClient, http } = require("viem");
const { base } = require("viem/chains");

const VERSION = "0.1.0";
const BASE_URL = (process.env.NOTARY_BASE_URL || "https://notary.forgemesh.io").replace(/\/$/, "");
const BASE_RPC_URL = process.env.BASE_RPC_URL || "https://mainnet.base.org";

const RECORD_PROPS = {
  prompt: { type: "string", description: "The exact prompt/input that was sent to the model" },
  response: { type: "string", description: "The exact model output you want a receipt for" },
  model_id: { type: "string", description: "Model identifier, e.g. 'openai/gpt-5' or 'claude-fable-5'" },
  client_timestamp: {
    type: "string",
    description: "Optional ISO-8601 time the inference ran. Included in the content hash if provided.",
  },
};

const TOOLS = [
  {
    name: "notarize_inference",
    description:
      "Get a cryptographic receipt for one AI inference. Returns a signed Ed25519 attestation, sha256 content hash, and Merkle chain-anchor status for {prompt, response, model_id}. The notary does NOT store your prompt or response — only the hash is retained. Costs $0.001 USDC via x402 (requires WALLET_PRIVATE_KEY).",
    inputSchema: {
      type: "object",
      properties: RECORD_PROPS,
      required: ["prompt", "response", "model_id"],
    },
  },
  {
    name: "notarize_batch",
    description:
      "Notarize up to 20 AI inferences in one call — one signed attestation per record. Ideal for audit trails and agent pipelines. Costs $0.005 USDC via x402 (requires WALLET_PRIVATE_KEY).",
    inputSchema: {
      type: "object",
      properties: {
        records: {
          type: "array",
          description: "1-20 records of {prompt, response, model_id, client_timestamp?}",
          items: { type: "object", properties: RECORD_PROPS, required: ["prompt", "response", "model_id"] },
          minItems: 1,
          maxItems: 20,
        },
      },
      required: ["records"],
    },
  },
  {
    name: "verify_attestation",
    description:
      "FREE — verify any attestation issued by the notary. Supply the attestation_id plus either the original content ({prompt, response, model_id}) or its content_hash. Returns the Ed25519 signature check, hash comparison, and a Merkle inclusion proof once the batch is sealed. No wallet needed.",
    inputSchema: {
      type: "object",
      properties: {
        attestation_id: { type: "string", description: "Attestation id (att_…) from a receipt" },
        ...RECORD_PROPS,
        content_hash: {
          type: "string",
          description: "Alternative to supplying full content: the sha256 content hash to compare directly",
        },
      },
      required: ["attestation_id"],
    },
  },
  {
    name: "get_receipt",
    description:
      "FREE — fetch the public receipt for an attestation: content hash, model, timestamps, Ed25519 signature, and Merkle anchor proof. Raw prompt/response are never stored, so receipts contain proof material only. No wallet needed.",
    inputSchema: {
      type: "object",
      properties: {
        attestation_id: { type: "string", description: "Attestation id (att_…)" },
      },
      required: ["attestation_id"],
    },
  },
  {
    name: "notary_stats",
    description:
      "FREE — live aggregate stats: total notarizations, 24h volume, top models by attestation count, sealed/anchored Merkle batches. No wallet needed.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "notary_pubkey",
    description:
      "FREE — the notary's Ed25519 public key (base64, raw 32 bytes) for fully offline signature verification. No wallet needed.",
    inputSchema: { type: "object", properties: {} },
  },
];

function buildHttpClient() {
  const key = process.env.WALLET_PRIVATE_KEY;
  if (!key) {
    throw new Error(
      "WALLET_PRIVATE_KEY is not set. Notarization costs $0.001 USDC via x402 — set a dedicated low-balance Base wallet private key (never your primary wallet). Verification tools work without it."
    );
  }
  const pk = key.startsWith("0x") ? key : "0x" + key;
  const account = privateKeyToAccount(pk);
  const coreClient = new x402Client().register("eip155:*", new ExactEvmScheme(toClientEvmSigner(account)));
  return { httpClient: new x402HTTPClient(coreClient), account };
}

// x402 derives EIP-3009 validity windows from Date.now; choose a timestamp
// valid for both Base block time and facilitator wall-clock checks.
async function createChainTimedPaymentPayload(httpClient, paymentRequired) {
  try {
    const publicClient = createPublicClient({ chain: base, transport: http(BASE_RPC_URL) });
    const block = await publicClient.getBlock();
    const chainNow = Number(block.timestamp);
    const originalNow = Date.now;
    const localNow = Math.floor(originalNow() / 1000);
    const timeout = Number(paymentRequired.accepts?.[0]?.maxTimeoutSeconds || 300);
    const lowerBound = localNow + 30 - timeout;
    const upperBound = chainNow + 600;
    const signingNow = Math.min(Math.max(chainNow, lowerBound), upperBound);
    Date.now = () => signingNow * 1000;
    try {
      return await httpClient.createPaymentPayload(paymentRequired);
    } finally {
      Date.now = originalNow;
    }
  } catch (_) {
    return httpClient.createPaymentPayload(paymentRequired);
  }
}

async function freeFetch(path, init) {
  const res = await fetch(BASE_URL + path, init);
  const raw = await res.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch (_) {
    data = { raw: raw.slice(0, 500) };
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
  return data;
}

async function paidPost(ctx, path, body) {
  const { httpClient } = ctx;
  const url = BASE_URL + path;
  const init = { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) };
  const res = await fetch(url, init);

  if (res.status === 402) {
    let challengeBody;
    try {
      challengeBody = await res.clone().json();
    } catch (_) {}
    const paymentRequired = httpClient.getPaymentRequiredResponse((name) => res.headers.get(name), challengeBody);
    const paymentPayload = await createChainTimedPaymentPayload(httpClient, paymentRequired);
    const paidRes = await fetch(url, {
      ...init,
      headers: { ...init.headers, ...httpClient.encodePaymentSignatureHeader(paymentPayload) },
    });
    if (!paidRes.ok) {
      const errBody = await paidRes.text().catch(() => paidRes.statusText);
      throw new Error(`HTTP ${paidRes.status}: ${errBody.slice(0, 200)}`);
    }
    const data = await paidRes.json();
    try {
      const settleResponse = httpClient.getPaymentSettleResponse((name) => paidRes.headers.get(name));
      if (settleResponse && data && typeof data === "object" && !Array.isArray(data)) {
        return { ...data, _payment: settleResponse };
      }
    } catch (_) {}
    return data;
  }

  if (!res.ok) {
    const errBody = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${errBody.slice(0, 200)}`);
  }
  return res.json();
}

async function main() {
  let ctx;
  function getPaymentContext() {
    if (!ctx) ctx = buildHttpClient();
    return ctx;
  }

  const server = new Server({ name: "x402-notary-mcp", version: VERSION }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    try {
      let data;
      switch (name) {
        case "notarize_inference":
          data = await paidPost(getPaymentContext(), "/api/notarize", args);
          break;
        case "notarize_batch":
          data = await paidPost(getPaymentContext(), "/api/notarize/batch", { records: args.records });
          break;
        case "verify_attestation":
          data = await freeFetch("/api/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(args),
          });
          break;
        case "get_receipt":
          data = await freeFetch(`/api/receipt/${encodeURIComponent(args.attestation_id)}`);
          break;
        case "notary_stats":
          data = await freeFetch("/api/stats");
          break;
        case "notary_pubkey":
          data = await freeFetch("/api/pubkey");
          break;
        default:
          throw new Error(`Unknown tool: ${name}`);
      }
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (e) {
      return { content: [{ type: "text", text: `Error: ${e.message}` }], isError: true };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`x402-notary-mcp v${VERSION} ready — ${BASE_URL}`);
}

main().catch((e) => {
  console.error("Fatal:", e.message);
  process.exit(1);
});
