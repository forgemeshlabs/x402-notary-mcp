# Glama Build Notes

Durable source for Glama admin fields. Keep this in the public MCP repo so the
next refresh does not depend on chat history.

## Repository

- GitHub: https://github.com/forgemeshlabs/x402-notary-mcp
- npm: @forgemeshlabs/x402-notary-mcp
- Hosted API: https://notary.forgemesh.io (Base) / https://notary-solana.forgemesh.io (Solana)

## Build Steps

Plain JavaScript with lockfile:

```json
["npm ci --omit=dev"]
```

`package.json` also defines a no-op `"build"` script (`echo "no build step required"`).
Glama's generic build pipeline runs `npm install && npm run build` regardless of
the custom steps above — without this no-op script the build fails with
`npm error Missing script: "build"`. Keep this script in every future MCP package
even when there is nothing to compile.

## Command Arguments

```json
["node", "index.js"]
```

If Glama shows a full proxy wrapper, it may render something like:

```json
["mcp-proxy", "--", "node", "index.js"]
```

In the manual command field, enter only the server startup command unless Glama
explicitly asks for the wrapped command.

## Placeholder Arguments

```json
{}
```

## Environment Variables

Canonical env schema belongs in `server.json`, not `glama.json`.

- `WALLET_PRIVATE_KEY` - optional low-balance Base wallet for paid x402 calls.
- `SOLANA_PRIVATE_KEY` - optional low-balance Solana keypair for paid x402 calls.
- `NOTARY_RAIL` - `base` or `solana`. Defaults to `base`.
- `NOTARY_BASE_URL` - optional hosted API base URL override.

## Dockerfile

Glama generates its own server runtime from admin fields. The repo Dockerfile is
a reference and local smoke-test target only.

```bash
docker build -t x402-notary-mcp .
docker run --rm -i x402-notary-mcp
```

Do not bake wallet private keys, API keys, `.env`, runtime databases, or test
wallet files into the image.
