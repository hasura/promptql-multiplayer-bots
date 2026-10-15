# Private Superset login

Use a reachable existing Superset instance. This bot does not deploy a server.

Mint a refresh token locally using the API login method your instance supports. For example, on a username/password (`db`) installation, enter the password in the interactive prompt below. It is not placed in command history or command-line arguments.

```python
import getpass
import json
import urllib.request
from urllib.parse import urlsplit

base = input("Superset HTTPS origin: ").strip().rstrip("/")
parts = urlsplit(base)
if parts.scheme != "https" or not parts.netloc or parts.username or parts.password or parts.query or parts.fragment:
    raise SystemExit("Use a valid HTTPS instance URL without credentials, query or fragment.")

username = input("Superset username: ")
password = getpass.getpass("Superset password (not echoed): ")
provider = input("Supported API provider (db or ldap; ask your admin if unsure): ").strip()
if provider not in {"db", "ldap"}:
    raise SystemExit("This example only supports db/ldap API login.")
request = urllib.request.Request(
    base + "/api/v1/security/login",
    data=json.dumps({
        "username": username, "password": password,
        "provider": provider, "refresh": True
    }).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(request, timeout=30) as response:
    payload = json.load(response)
token = payload.get("refresh_token")
if not token:
    raise SystemExit("No refresh token returned; ask your Superset administrator.")
print("Refresh token — paste only into the PromptQL Connect card, not chat:")
print(token)
```

Run this **on your own trusted computer**, not in a shared bot runtime or shared terminal, and do not record the output. The final value is a secret displayed locally so you can copy it into the Connect card. Clear the local terminal after use.

- Set the Connect card's base URL to the instance origin.
- Copy **only `refresh_token`**, not `access_token`.
- Paste the raw token with no `Bearer ` prefix.
- Never paste the login response, password or token into a bot's chat.
- `ldap` is not a generic SSO setting. OAuth/OIDC/SAML installations may not support this login route; ask your administrator for a supported API login account or flow.
- Refresh-token lifetime is instance-configurable. Reconnect when it expires or is revoked.

Subsequent requests exchange the securely stored refresh token for a short-lived access token held only in runtime memory.