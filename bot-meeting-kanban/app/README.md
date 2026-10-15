# Meeting Kanban — app

Reference implementation deployed by the Meeting Kanban bot. See [SPEC.md](SPEC.md) for the data model, API and look-and-feel.

```
cd web && npm ci && npm run build && cd ..   # emits ../dist
uv run --script server.py                    # serves dist/ and the API on $PORT (default 8080)
```

On first start, if `data/board.json` is absent the server copies `data/board.sample.json` (fictional data). For a real board write `data/board.json` yourself: the extracted plan, or `data/board.empty.json` with the title and members filled when there is no meeting yet. The server keeps the board in memory, so restart it after editing the file by hand. `/readyz` returns 204 when the app is ready.