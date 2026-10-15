import ast
import json
from pathlib import Path
from urllib.parse import parse_qs, urlsplit
from contextlib import contextmanager
from types import SimpleNamespace

class AsyncMock:
    def __init__(self, return_value=None, side_effect=None):
        self.return_value = return_value
        self.side_effect = list(side_effect) if side_effect is not None else None
        self.call_args_list = []
        self.await_count = 0

    @property
    def call_args(self):
        return self.call_args_list[-1]

    async def __call__(self, *args, **kwargs):
        self.await_count += 1
        self.call_args_list.append(SimpleNamespace(args=args, kwargs=kwargs))
        return self.side_effect.pop(0) if self.side_effect is not None else self.return_value

class patch:
    @staticmethod
    @contextmanager
    def object(obj, attribute, replacement):
        original = getattr(obj, attribute)
        setattr(obj, attribute, replacement)
        try:
            yield replacement
        finally:
            setattr(obj, attribute, original)

import executor
import superset_query as helper
from executor import aio


async def main():
    count = 0
    async def check(name, function):
        nonlocal count
        await function()
        count += 1
        executor.print("PASS " + name)

    async def valid_url():
        with patch.object(helper, "query_graphql", AsyncMock(return_value={"saas_integrations_project_integrations":[{"base_url_override":"https://superset.example.org","config_values":{}}]})):
            assert await helper.get_base_url() == "https://superset.example.org/api/v1"

    async def suffix_url():
        with patch.object(helper, "query_graphql", AsyncMock(return_value={"saas_integrations_project_integrations":[{"base_url_override":None,"config_values":{"base_url":"https://superset.example.org/api/v1/"}}]})):
            assert await helper.get_base_url() == "https://superset.example.org/api/v1"

    async def absent_connection():
        with patch.object(helper,"query_graphql",AsyncMock(return_value={"saas_integrations_project_integrations":[]})):
            try: await helper.get_base_url()
            except RuntimeError: return
            raise AssertionError("Missing connection accepted")

    async def token_request():
        mock=AsyncMock(return_value={"status":200,"body":json.dumps({"access_token":"MOCK_ACCESS_TOKEN"})})
        with patch.object(helper.aio,"run_http",mock):
            assert await helper.mint_access_token("https://superset.example.org/api/v1") == "MOCK_ACCESS_TOKEN"
        assert mock.call_args.kwargs["integration"] == "__superset"

    async def safe_auth_error():
        with patch.object(helper.aio,"run_http",AsyncMock(return_value={"status":401,"body":{"access_token":"DO_NOT_ECHO"}})):
            try: await helper.mint_access_token("https://superset.example.org/api/v1")
            except RuntimeError as e:
                assert "DO_NOT_ECHO" not in str(e)
                return
            raise AssertionError("Invalid refresh accepted")

    async def paginated_read():
        mock=AsyncMock(side_effect=[{"status":200,"body":{"count":2,"result":[{"id":1}]}},{"status":200,"body":{"count":2,"result":[{"id":2}]}}])
        with patch.object(helper.aio,"run_http",mock):
            status,body=await helper.fetch_all("https://superset.example.org/api/v1","MOCK_ACCESS_TOKEN","/dashboard/")
        assert status == 200 and len(body["result"]) == 2
        assert all("integration" not in call.kwargs for call in mock.call_args_list)
        assert parse_qs(urlsplit(mock.call_args_list[1].kwargs["url"]).query)["q"] == ["(page_size:100,page:1)"]

    async def empty_collection():
        with patch.object(helper.aio,"run_http",AsyncMock(return_value={"status":200,"body":{"count":0,"result":[]}})):
            _,body=await helper.fetch_all("https://superset.example.org/api/v1","MOCK_ACCESS_TOKEN","/dashboard/")
        assert body["result"] == []

    async def unauthorized_retry():
        mock=AsyncMock(side_effect=[{"status":401,"body":{}},{"status":200,"body":{"result":[]}}])
        refresh=AsyncMock(return_value="MOCK_RENEWED_TOKEN")
        with patch.object(helper.aio,"run_http",mock),patch.object(helper,"mint_access_token",refresh):
            await helper.call("https://superset.example.org/api/v1","MOCK_ACCESS_TOKEN","/chart/")
        assert refresh.await_count == 1 and mock.call_args.kwargs["headers"]["Authorization"] == "Bearer MOCK_RENEWED_TOKEN"

    async def forbidden_read():
        with patch.object(helper.aio,"run_http",AsyncMock(return_value={"status":403,"body":{"result":[]}})):
            try: await helper.call("https://superset.example.org/api/v1","MOCK_ACCESS_TOKEN","/dashboard/")
            except RuntimeError: return
            raise AssertionError("403 accepted")

    async def incomplete_pages():
        mock=AsyncMock(side_effect=[{"status":200,"body":{"count":2,"result":[{"id":1}]}},{"status":200,"body":{"count":2,"result":[]}}])
        with patch.object(helper.aio,"run_http",mock):
            try: await helper.fetch_all("https://superset.example.org/api/v1","MOCK_ACCESS_TOKEN","/dashboard/")
            except RuntimeError: return
            raise AssertionError("Partial pagination accepted")

    async def page_cap():
        with patch.object(helper.aio,"run_http",AsyncMock(return_value={"status":200,"body":{"count":2,"result":[{"id":1}]}})):
            try: await helper.fetch_all("https://superset.example.org/api/v1","MOCK_ACCESS_TOKEN","/dashboard/",max_pages=1)
            except RuntimeError: return
            raise AssertionError("Page cap accepted")

    async def endpoint_safety():
        for endpoint in ["https://evil.example/chart/","//evil.example/chart/","/chart/../security/login","/chart/%2e%2e","/security/refresh"]:
            try: helper.endpoint_url("https://superset.example.org/api/v1",endpoint)
            except ValueError: continue
            raise AssertionError("Unsafe endpoint accepted: "+endpoint)
        try: helper.endpoint_url("https://superset.example.org/api/v1","/chart/?q=(page:0)",page=0)
        except ValueError: return
        raise AssertionError("Existing q pagination accepted")

    for name,func in [
        ("instance URL","valid_url"),("API suffix not duplicated","suffix_url"),("missing integration","absent_connection"),
        ("refresh token injection and JSON response","token_request"),("authentication errors redact response","safe_auth_error"),
        ("complete pagination and fresh-token data call","paginated_read"),("empty dashboard inventory","empty_collection"),
        ("401 retries once","unauthorized_retry"),("403 stays a failure","forbidden_read"),
        ("incomplete pagination fails","incomplete_pages"),("page cap fails","page_cap"),("endpoint safety","endpoint_safety")
    ]:
        await check(name,locals()[func])
    ast.parse(Path(__file__).with_name("superset_query.py").read_text())
    await aio.store_artifact(identifier="superset_test_results",title="Superset helper mock test results",artifact_type="text",data=json.dumps({"passed":count,"live_superset_tested":False}),metadata={"text":{"content_type":"text/plain"}},hidden=True)
    executor.print(f"{count} mocked checks passed; no live Superset connection was tested.")