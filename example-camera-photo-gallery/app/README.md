# Camera Photo Gallery — app

The app the Camera Photo Gallery bot deploys. Plain Python 3 standard library and SQLite, no dependencies.

- `server.py`: HTTP server on `$PORT` (default 8080). Serves the page, the photo API (`GET`/`POST /api/photos`, `DELETE /api/photos/<id>`), the photos (`/photos/<id>`) and `/api/me`. `/readyz` returns 204 when ready. Photos and the SQLite database are stored in `data/` next to `server.py`.
- `index.html`: the whole frontend in one file: live viewfinder, native camera capture, library upload, and the shared gallery.
- `camera-app.service`: systemd unit. It expects the files in `/workspace/camera-app` and runs as the `promptql` user.

Run it by hand with `PORT=8080 python3 server.py`.

Visitor identity comes from the `X-PromptQL-Visitor-Token` header, which the PromptQL app adds to every request it routes to the app. Requests without it see no photos and cannot upload or delete.