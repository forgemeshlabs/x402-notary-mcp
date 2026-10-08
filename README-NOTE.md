# STALE COPY — do not edit here

This directory is a drifted, older copy of the x402 Notary service and has no
test script. It is NOT what runs in production.

Canonical source: `/home/ubuntu/repos/x402-notary`
Systemd unit `x402-notary` uses that path (`systemctl cat x402-notary`):

    WorkingDirectory=/home/ubuntu/repos/x402-notary
    ExecStart=.../node /home/ubuntu/repos/x402-notary/server.js

Make all changes, run tests (`npm test`) and commit in `~/repos/x402-notary`.
Noted 2026-09-23 during the fleet test audit. Nothing here was deleted.
