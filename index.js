#!/usr/bin/env node
"use strict";

const { Server } = require("@modelcontextprotocol/sdk/server/index.js");
const { StdioServerTransport } = require("@modelcontextprotocol/sdk/server/stdio.js");
const { CallToolRequestSchema, ListToolsRequestSchema } = require("@modelcontextprotocol/sdk/types.js");
const { x402Client, x402HTTPClient } = require("@x402/core/client");
const { ExactEvmScheme } = require("@x402/evm/exact/client");
const { toClientEvmSigner } = require("@x402/evm");
const { privateKeyToAccount } = require("viem/accounts");
const { createGuard } = require("./x402-guard");

const VERSION = require("./package.json").version;
const BASE_URL = "https://notary.forgemesh.io";
// Highest listed price is notarize_batch at $0.005. X402_MAX_PRICE_USD / X402_SESSION_BUDGET_USD can only lower these caps.
const guard = createGuard({ baseUrl: BASE_URL, payTo: ["0x814EfE784709f5bF8dF47735D87602B01030e5D2"], maxPriceUsd: 0.01, sessionBudgetUsd: 10 });
const MAX_CONTENT_CHARS = 100_000; // prompts/responses are hashed, not interpreted, so the cap is larger than for free text
const ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const HASH_PATTERN = /^[A-Za-z0-9:_-]{1,128}$/;

const RECORD_PROPS = {
  prompt: { type: "string", maxLength: 100000, description: "The exact prompt/input that was sent to the model" },
  response: { type: "string", maxLength: 100000, description: "The exact model output you want a receipt for" },
  model_id: { type: "string", maxLength: 200, description: "Model identifier, e.g. 'openai/gpt-5' or 'claude-fable-5'" },
  client_timestamp: {
    type: "string",
    maxLength: 64,
    description: "Optional ISO-8601 time the inference ran. Included in the content hash if provided.",
  },
};

const TOOLS = [
  {
    name: "notarize_inference",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "Get a cryptographic receipt for one AI inference. Returns a signed Ed25519 attestation, sha256 content hash, and Merkle chain-anchor status for {prompt, response, model_id}. The notary does NOT store your prompt or response — only the hash is retained. Costs $0.001 USDC via x402 (requires WALLET_PRIVATE_KEY for a Base wallet).",
    inputSchema: {
      type: "object",
      properties: RECORD_PROPS,
      required: ["prompt", "response", "model_id"],
    },
  },
  {
    name: "notarize_batch",
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "Notarize up to 20 AI inferences in one call — one signed attestation per record. Ideal for audit trails and agent pipelines. Costs $0.005 USDC via x402 (requires WALLET_PRIVATE_KEY for a Base wallet).",
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
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "FREE — verify any attestation issued by the notary. Supply the attestation_id plus either the original content ({prompt, response, model_id}) or its content_hash. Returns the Ed25519 signature check, hash comparison, and a Merkle inclusion proof once the batch is sealed. No wallet needed.",
    inputSchema: {
      type: "object",
      properties: {
        attestation_id: { type: "string", maxLength: 128, pattern: "^[A-Za-z0-9_-]{1,128}$", description: "Attestation id (att_…) from a receipt" },
        ...RECORD_PROPS,
        content_hash: {
          type: "string",
          maxLength: 128,
          description: "Alternative to supplying full content: the sha256 content hash to compare directly",
        },
      },
      required: ["attestation_id"],
    },
  },
  {
    name: "get_receipt",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "FREE — fetch the public receipt for an attestation: content hash, model, timestamps, Ed25519 signature, and Merkle anchor proof. Raw prompt/response are never stored, so receipts contain proof material only. No wallet needed.",
    inputSchema: {
      type: "object",
      properties: {
        attestation_id: { type: "string", maxLength: 128, pattern: "^[A-Za-z0-9_-]{1,128}$", description: "Attestation id (att_…)" },
      },
      required: ["attestation_id"],
    },
  },
  {
    name: "notary_stats",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: true,
    },
    description:
      "FREE — live aggregate stats: total notarizations, 24h volume, top models by attestation count, sealed/anchored Merkle batches. No wallet needed.",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "notary_pubkey",
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: true,
    },
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
  const account = privateKeyToAccount(key.startsWith("0x") ? key : "0x" + key);
  const coreClient = new x402Client().register("eip155:*", new ExactEvmScheme(toClientEvmSigner(account))).registerPolicy(guard.policy);
  return new x402HTTPClient(coreClient);
}

function text(value, field, maxLength, { required = true, pattern } = {}) {
  if (value === undefined || value === null || value === "") {
    if (required) throw new Error(`${field} is required`);
    return undefined;
  }
  if (typeof value !== "string") throw new Error(`${field} must be a string`);
  if (value.length > maxLength) throw new Error(`${field} exceeds ${maxLength} characters`);
  if (pattern && !pattern.test(value)) throw new Error(`${field} has invalid characters`);
  return value;
}

function cleanRecord(rec, field) {
  if (!rec || typeof rec !== "object" || Array.isArray(rec)) throw new Error(`${field} must be an object`);
  const out = {
    prompt: text(rec.prompt, `${field}.prompt`, MAX_CONTENT_CHARS),
    response: text(rec.response, `${field}.response`, MAX_CONTENT_CHARS),
    model_id: text(rec.model_id, `${field}.model_id`, 200),
  };
  const ts = text(rec.client_timestamp, `${field}.client_timestamp`, 64, { required: false });
  if (ts !== undefined) out.client_timestamp = ts;
  return out;
}

function cleanVerify(args) {
  const out = { attestation_id: text(args.attestation_id, "attestation_id", 128, { pattern: ID_PATTERN }) };
  const hash = text(args.content_hash, "content_hash", 128, { required: false, pattern: HASH_PATTERN });
  if (hash !== undefined) out.content_hash = hash;
  if (args.prompt !== undefined || args.response !== undefined || args.model_id !== undefined) Object.assign(out, cleanRecord(args, "arguments"));
  return out;
}

async function freeFetch(path, init) {
  const res = await guard.fetchBounded(path, init);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.text.slice(0, 200)}`);
  try { return JSON.parse(res.text); } catch { throw new Error(`HTTP ${res.status}: non-JSON response`); }
}

async function main() {
  let httpClient;
  const getClient = () => (httpClient ||= buildHttpClient());

  const server = new Server({ name: "x402-notary-mcp", version: VERSION }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args = {} } = req.params;
    try {
      let data;
      switch (name) {
        case "notarize_inference":
          data = await guard.callPaid(getClient(), "/api/notarize", { method: "POST", body: cleanRecord(args, "arguments") });
          break;
        case "notarize_batch":
          if (!Array.isArray(args.records) || args.records.length < 1 || args.records.length > 20) throw new Error("records must contain 1-20 items");
          data = await guard.callPaid(getClient(), "/api/notarize/batch", { method: "POST", body: { records: args.records.map((r, i) => cleanRecord(r, `records[${i}]`)) } });
          break;
        case "verify_attestation":
          data = await freeFetch("/api/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(cleanVerify(args)),
          });
          break;
        case "get_receipt":
          data = await freeFetch(`/api/receipt/${encodeURIComponent(text(args.attestation_id, "attestation_id", 128, { pattern: ID_PATTERN }))}`);
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
