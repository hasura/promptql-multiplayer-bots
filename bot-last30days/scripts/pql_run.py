#!/usr/bin/env python3
"""last30days-skill engine, run inside a PromptQL bot VM.

Zero-key sources (Hacker News, Polymarket, arXiv, Reddit-if-reachable) run as-is.
Exa (web / YouTube / Reddit fallback), xAI (X search) and GitHub are routed
through the PromptQL integration proxy, so no API keys ever live on the VM:
the engine thinks it has keys, but every call to api.exa.ai / api.x.ai /
api.github.com is rewritten to

    $PROMPTQL_PLATFORM_API_URL/v1/integration/<provider>/<host>/<path>

with the user's PromptQL JWT, and PromptQL injects the real credentials
server-side. The upstream engine is not modified.

Usage: python3 pql_run.py "<topic>" [any last30days.py flags]
"""
import os
import sys
from urllib.parse import urlsplit

ENGINE = os.environ.get("LAST30DAYS_ENGINE", "/workspace/last30days-skill/skills/last30days/scripts")
sys.path.insert(0, ENGINE)

PLATFORM = os.environ["PROMPTQL_PLATFORM_API_URL"].rstrip("/")
JWT = os.environ["PROMPTQL_USER_JWT"]

# upstream host -> PromptQL integration provider id
PROXIED = {
    "api.exa.ai": "__exa-web-search",
    "api.x.ai": "__xai-responses",
    "api.github.com": "__github",
}
# headers the engine sets that must NOT be forwarded (PromptQL injects the real ones)
STRIP = {"x-api-key", "authorization"}

# Make the engine believe the keys exist so it enables those sources.
# These values are never sent anywhere: the wrapper strips them before the
# request leaves the VM.
os.environ.setdefault("EXA_API_KEY", "exa-proxied-by-promptql")
os.environ.setdefault("XAI_API_KEY", "xai-proxied-by-promptql")
os.environ.setdefault("GITHUB_TOKEN", "ghp_proxied_by_promptql")
os.environ.setdefault("LAST30DAYS_MEMORY_DIR", "/workspace/last30days-out")
os.environ.setdefault("LAST30DAYS_CONFIG_DIR", "/workspace/last30days-pql/config")

from lib import http as l30_http  # noqa: E402

_orig_request = l30_http.request


def _proxied_request(method, url, headers=None, json_data=None, params=None, **kw):
    parts = urlsplit(url)
    provider = PROXIED.get(parts.hostname or "")
    if provider:
        path = parts.path.lstrip("/")
        qs = f"?{parts.query}" if parts.query else ""
        url = f"{PLATFORM}/v1/integration/{provider}/{parts.hostname}/{path}{qs}"
        headers = {k: v for k, v in (headers or {}).items() if k.lower() not in STRIP}
        headers["Authorization"] = f"Bearer {JWT}"
        headers.setdefault(
            "X-PromptQL-Description",
            f"last30days research: {method} {parts.hostname}{parts.path}",
        )
    return _orig_request(method, url, headers=headers, json_data=json_data, params=params, **kw)


l30_http.request = _proxied_request

import last30days  # noqa: E402

if __name__ == "__main__":
    sys.exit(last30days.main())