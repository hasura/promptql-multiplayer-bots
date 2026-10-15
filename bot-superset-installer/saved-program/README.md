# superset_query

Reusable read-only Superset object discovery for PromptQL's program runtime.

## Install

The installer bot creates this saved program after you securely connect `__superset`. The installer request authorizes creating it; it must inspect an existing package before reuse and ask before overwriting unrelated code.

Copy this directory's `superset_query.py`, `default.run.json` and `README.md` into package `superset_query`. Verify project sharing through PromptQL's supported saved-program permissions; never assume creation made the package shared.

## Requirements

- The built-in `__superset` integration connected with a **refresh token**.
- An HTTPS instance URL in the connection's `base_url_override` or `config_values.base_url`.
- Account permissions to read the requested Superset objects.

The helper reads connection configuration, mints a fresh access token for each run and keeps it in memory. It sends data reads with that access token without reusing the integration's refresh-token header. It retries an unauthorized data read once. Authentication responses and tokens are never printed or stored.

## Arguments

- `--endpoint` (required): relative read-only API path, such as `/dashboard/`, `/chart/`, `/dataset/` or `/chart/123`.
- `--paginate`: fetch a collection's pages to its reported count. Do not combine with an existing `q` filter.
- `--max-pages`: pagination safety cap, default 1000. Exceeding the cap is an error, not a successful partial inventory.
- `--artifact`: output identifier, default `superset_result`.

The run config defaults to a paginated dashboard read and artifact `superset_dashboards`.

```xml
<run_program package="superset_query" entrypoint="superset_query.py">
  <argument>--endpoint</argument>
  <argument>/dashboard/</argument>
  <argument>--paginate</argument>
  <argument>--artifact</argument>
  <argument>superset_dashboards</argument>
</run_program>
```

Successful collections become table artifacts; detail results become JSON text artifacts. Failures save no partial result. An artifact left from an earlier successful run is not evidence that a later run succeeded.

## Scope and limitations

This helper supports GET discovery of dashboards, charts and datasets. It does not implement chart-data POST requests or modify Superset objects. Pagination is not an atomic snapshot: do not treat changing collections as transactionally consistent. Permissions are those of the connected Superset credential, which may be shared; be deliberate about where results are displayed.

## Tests

`../TESTS.md` describes mocked helper checks and live acceptance. Mocked checks do not establish a live Superset connection.