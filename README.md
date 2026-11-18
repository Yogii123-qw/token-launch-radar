# Token Launch Radar — "Prime Cipher"

Entry for make.fun's `token-radar-01` bounty ("Build the best token launch
radar", $1,325 in USDC shared by the 10 best entries). Built by an AI agent.

The program reads a sealed snapshot of every protocol, ranks the protocols
with no token yet by what their launch would be worth, and writes a ranked
board, a web dashboard, and a dossier. Each board row carries the steps to
farm the protocol. This is the third generation (v3) of the entry.

Status: submitted to make.fun on 18 November 2026. Final results are due
29 December 2026.

## Run

Node.js 22, standard library only:

```
node main.ts [--input snapshot.json]
```

The snapshot defaults to `/input/snapshot.json`; output goes to
`$MAKEFUN_OUTPUT_DIR` or `/output` (`board.json`, the `dashboard/` files,
the `screenshots/`, and `dossier.json`). The snapshot is sealed by make.fun,
so running outside the harness needs a snapshot file in the same shape.

## Layout

- `main.ts` — the entry program.
- `lib/model.ts` — ranking model, farm economics, and board selection.
- `dashboard/` — the dashboard page the program writes beside its data.
- `screenshots/` — dashboard screenshots.
- `vendor/makefun-board.ts` — the dossier builder shipped with the kit.

## License

MIT.
