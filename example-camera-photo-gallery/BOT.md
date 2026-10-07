# Camera Photo Gallery

Run a shared phone-camera app with a photo gallery as an app artifact on your VM. Everyone in this bot opens the same app, takes photos with their phone camera, and sees each other's photos.

## Rules

- Deploy the reference app in the `app/` folder of this bot exactly as it is. Do not rewrite or redesign it.
- You need a v2 VM, because the app runs as a systemd service. If your VM is not v2, tell the user and stop.
- Photos stay on the VM disk. Do not send them to any third-party service.

## Steps

### 1. Get a VM

If you do not have a VM yet, provision one with the default size.

### 2. Download the app

```sh
mkdir -p /workspace/camera-app && cd /workspace/camera-app
BASE=https://raw.githubusercontent.com/hasura/promptql-multiplayer-bots/main/example-camera-photo-gallery/app
for f in server.py index.html camera-app.service; do curl -fsSLO "$BASE/$f"; done
```

The app is plain Python 3 with SQLite. It has no dependencies to install.

### 3. Install and start the service

```sh
cd /workspace/camera-app
sudo cp camera-app.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now camera-app
curl -s -o /dev/null -w "%{http_code}\n" localhost:8080/readyz   # expect 204
```

The service restarts on failure and survives VM restarts. Photos and their metadata live in `/workspace/camera-app/data/`.

### 4. Publish the app artifact

Register an app artifact with the identifier `camera` and the title "Camera", following the App Artifacts product wiki page. Use this declaration, with your own sandbox id:

```json
{"version": 2, "host": "vm", "sandbox_id": "<your sandbox id>", "kind": "web", "port": 8080, "protocol": "http", "readiness": {"path": "/readyz"}}
```

### 5. Hand it over

Show the app artifact in chat and tell the users:

- Open the app on a phone. Tap **Start live camera** for the in-app viewfinder, 🔄 to switch between the front and back camera, and the shutter to take a photo.
- The live camera does not work inside the embedded view in the chat. The embedding frame does not grant camera permission, so the browser blocks it. Tap **Open full screen ↗**, or tap 📱 to take the photo with the phone's own camera app.
- **Upload from library** adds existing photos. HEIC photos from an iPhone are converted to JPEG.
- The gallery is shared by everyone in the bot. Tap a photo for **Save / Share** (the phone's share sheet) and **Download**. Only the person who took a photo can delete it.

## How identity works

The app recognises each visitor from their PromptQL identity, which the PromptQL app sends with every request. Visitors without a PromptQL identity cannot see, upload or delete photos.