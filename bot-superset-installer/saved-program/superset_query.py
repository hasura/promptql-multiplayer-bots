import argparse
import json
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import executor
from executor import aio
from promptql.playground import query_graphql


def response_json(response):
    body = response.get("body")
    if isinstance(body, str):
        try:
            return json.loads(body)
        except (TypeError, ValueError):
            return None
    return body


async def get_base_url():
    result = await query_graphql(
        'query { saas_integrations_project_integrations(where: {provider_id: {_eq: "__superset"}}) '
        '{ base_url_override config_values } }',
        description="Read the connected Superset instance URL, without credentials",
    )
    rows = result["saas_integrations_project_integrations"]
    if len(rows) != 1:
        raise RuntimeError("Expected one connected __superset integration; connect or check its configuration.")
    row = rows[0]
    config = row.get("config_values") or {}
    if isinstance(config, str):
        try:
            config = json.loads(config)
        except ValueError:
            config = {}
    base = row.get("base_url_override") or config.get("base_url")
    if not isinstance(base, str) or not base.strip():
        raise RuntimeError("The __superset integration has no instance URL.")
    parts = urlsplit(base.strip())
    if parts.scheme != "https" or not parts.netloc or parts.username or parts.password or parts.query or parts.fragment:
        raise RuntimeError("Superset requires a valid HTTPS instance URL without credentials, query or fragment.")
    path = parts.path.rstrip("/")
    if not path.endswith("/api/v1"):
        path += "/api/v1"
    return urlunsplit((parts.scheme, parts.netloc, path, "", ""))


async def mint_access_token(api_base):
    response = await aio.run_http(
        url=api_base + "/security/refresh", method="POST", integration="__superset",
        description="Superset: exchange the securely stored refresh token for an in-memory access token",
    )
    body = response_json(response)
    if response["status"] != 200 or not isinstance(body, dict) or not isinstance(body.get("access_token"), str) or not body["access_token"]:
        # Never print the authentication response: it can contain token material.
        raise RuntimeError(f"Superset refresh failed (HTTP {response['status']}); check the stored refresh token and reconnect.")
    return body["access_token"]


def endpoint_url(api_base, endpoint, page=None):
    parts = urlsplit(endpoint)
    if not endpoint.startswith("/") or endpoint.startswith("//") or parts.scheme or parts.netloc or parts.fragment:
        raise ValueError("Endpoint must be a relative API path beginning with one slash.")
    # Limit this helper to read-only BI discovery endpoints; prevent requests to arbitrary hosts.
    segments = parts.path.strip("/").split("/")
    if segments[0] not in {"dashboard", "chart", "dataset"} or any(s in {".", ".."} or "%" in s or "\\" in s for s in segments):
        raise ValueError("Only dashboard, chart and dataset API paths are supported.")
    pairs = parse_qsl(parts.query, keep_blank_values=True)
    if page is not None:
        if any(k == "q" for k, _ in pairs):
            raise ValueError("Pagination cannot be combined with an existing q filter; omit --paginate for filtered requests.")
        pairs.append(("q", f"(page_size:100,page:{page})"))
    query = urlencode(pairs)
    return api_base + parts.path + ("?" + query if query else "")


async def call(api_base, token, endpoint, page=None):
    url = endpoint_url(api_base, endpoint, page)
    response = await aio.run_http(
        url=url, method="GET", headers={"Authorization": "Bearer " + token},
        description=f"Superset: read {urlsplit(endpoint).path}",
    )
    if response["status"] == 401:
        token = await mint_access_token(api_base)
        response = await aio.run_http(
            url=url, method="GET", headers={"Authorization": "Bearer " + token},
            description=f"Superset: retry {urlsplit(endpoint).path} once with renewed access",
        )
    status = response["status"]
    if status < 200 or status >= 300:
        raise RuntimeError(f"Superset read failed (HTTP {status}); check account permissions, token validity and instance availability.")
    body = response_json(response)
    if not isinstance(body, dict) or "result" not in body:
        raise RuntimeError("Superset returned an unexpected response; no result has been saved.")
    return status, body


async def fetch_all(api_base, token, endpoint, max_pages=1000):
    if max_pages < 1:
        raise ValueError("--max-pages must be positive.")
    if len(urlsplit(endpoint).path.strip("/").split("/")) != 1:
        raise ValueError("--paginate is only supported for collection endpoints.")
    status, body = await call(api_base, token, endpoint, page=0)
    if not isinstance(body.get("result"), list) or not isinstance(body.get("count"), int) or body["count"] < 0:
        raise RuntimeError("Superset collection response must include a list result and a non-negative count.")
    results = list(body["result"])
    target = body["count"]
    for page in range(1, max_pages):
        if len(results) >= target:
            break
        _, next_body = await call(api_base, token, endpoint, page=page)
        batch = next_body.get("result")
        if not isinstance(batch, list) or not batch:
            raise RuntimeError("Superset pagination ended before the reported count; no partial result has been saved.")
        results.extend(batch)
    if len(results) < target:
        raise RuntimeError("Superset pagination reached --max-pages; no partial result has been saved.")
    return status, {**body, "result": results}


def format_rows(rows):
    return [{key: round(value, 2) if isinstance(value, float) else value for key, value in row.items()} for row in rows]


async def main():
    parser = argparse.ArgumentParser(description="Read Superset BI objects using securely stored refresh-token authentication.")
    parser.add_argument("--endpoint", required=True)
    parser.add_argument("--paginate", action="store_true")
    parser.add_argument("--max-pages", type=int, default=1000)
    parser.add_argument("--artifact", default="superset_result")
    args = parser.parse_args()
    api_base = await get_base_url()
    # Validate before any authentication request.
    endpoint_url(api_base, args.endpoint, page=0 if args.paginate else None)
    token = await mint_access_token(api_base)
    if args.paginate:
        status, body = await fetch_all(api_base, token, args.endpoint, args.max_pages)
    else:
        status, body = await call(api_base, token, args.endpoint)
    result = body["result"]
    if isinstance(result, list) and all(isinstance(row, dict) for row in result):
        await aio.store_artifact(
            identifier=args.artifact, title=f"Superset {urlsplit(args.endpoint).path}",
            artifact_type="table", data=format_rows(result), hidden=False,
        )
    else:
        await aio.store_artifact(
            identifier=args.artifact, title=f"Superset {urlsplit(args.endpoint).path}",
            artifact_type="text", data=json.dumps(result, indent=2),
            metadata={"text": {"content_type": "text/plain"}}, hidden=False,
        )
    executor.print(f"HTTP {status}: {len(result) if isinstance(result, list) else 'detail'} rows saved to '{args.artifact}'.")