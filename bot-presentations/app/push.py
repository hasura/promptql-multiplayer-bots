"""Sends the deck to the visitor's own account: Google Drive (converted to native Google Slides) or OneDrive (.pptx).

Every call goes through the PromptQL Platform API integration proxy with the visitor's X-PromptQL-Visitor-Token,
so it runs with the credentials of whoever clicked the button. The bot's PROMPTQL_USER_JWT is never used here.
"""
import json
import os
import re
import urllib.error
import urllib.request
import uuid
from urllib.parse import quote

PLATFORM = os.environ.get('PROMPTQL_PLATFORM_API_URL', '').rstrip('/')
PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
GDRIVE, MSPPT = '__google-drive-v2', '__microsoft-powerpoint'
NAMES = {GDRIVE: 'Google Drive', MSPPT: 'Microsoft PowerPoint'}


class PushError(Exception):
    def __init__(self, status, msg):
        super().__init__(msg)
        self.status = status


def _call(token, provider, host_path, method, data=None, headers=None, timeout=300):
    """Integration-authenticated request. Returns (status, headers, json body)."""
    if not PLATFORM:
        raise PushError(500, 'The editor is missing PROMPTQL_PLATFORM_API_URL in its service environment.')
    req = urllib.request.Request(f'{PLATFORM}/v1/integration/{provider}/{host_path}', data=data, method=method,
                                 headers={'Authorization': f'Bearer {token}', **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            raw = r.read()
            return r.status, r.headers, (json.loads(raw) if raw.strip() else {})
    except urllib.error.HTTPError as e:
        raw = e.read()
        try:
            err = json.loads(raw).get('error') or {}
        except Exception:
            err = {}
        msg = err.get('message') if isinstance(err, dict) else str(err)
        msg = msg or raw.decode('utf-8', 'replace')[:300] or f'HTTP {e.code}'
        name = NAMES.get(provider, provider)
        if 'not connected' in msg.lower():
            raise PushError(409, f'Your {name} account is not connected to PromptQL. Connect it in PromptQL under '
                                 f'Settings › Integrations ({name}), then try again.')
        platform_envelope = isinstance(err, dict) and 'retryable' in err
        if platform_envelope and e.code in (401, 403):
            raise PushError(403, f'This editor does not have your permission to use {name} yet. Reload the editor '
                                 f'and approve the permission prompt, then try again.')
        raise PushError(502, f'{name} said: {msg}')
    except (urllib.error.URLError, TimeoutError) as e:
        raise PushError(504, f'Could not reach {NAMES.get(provider, provider)}: {e}')


def safe_name(title):
    s = re.sub(r'[\\/:*?"<>|#%]+', ' ', title or 'Untitled deck').strip()
    return re.sub(r'\s+', ' ', s)[:120] or 'Untitled deck'


def to_google_slides(token, title, pptx):
    """Upload the .pptx to Drive with target mimeType google-apps.presentation, so Drive converts it to native Slides."""
    name = safe_name(title)
    meta = {'name': name, 'mimeType': 'application/vnd.google-apps.presentation'}
    desc = {'X-PromptQL-Description': 'Create an editable Google Slides copy of the deck in your Google Drive'}
    fields = 'fields=id,name,webViewLink'
    if len(pptx) <= 5 * 1024 * 1024:
        b = 'pql' + uuid.uuid4().hex
        body = (f'--{b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n{json.dumps(meta)}\r\n'
                f'--{b}\r\nContent-Type: {PPTX_MIME}\r\n\r\n').encode() + pptx + f'\r\n--{b}--\r\n'.encode()
        _, _, d = _call(token, GDRIVE, f'www.googleapis.com/upload/drive/v3/files?uploadType=multipart&{fields}', 'POST',
                        body, {'Content-Type': f'multipart/related; boundary={b}', **desc})
    else:  # resumable upload for large decks
        _, hdrs, _ = _call(token, GDRIVE, f'www.googleapis.com/upload/drive/v3/files?uploadType=resumable&{fields}', 'POST',
                           json.dumps(meta).encode(), {'Content-Type': 'application/json; charset=UTF-8',
                                                       'X-Upload-Content-Type': PPTX_MIME,
                                                       'X-Upload-Content-Length': str(len(pptx)), **desc})
        loc = hdrs.get('Location') or ''
        if not loc.startswith('https://'):
            raise PushError(502, 'Google Drive did not return an upload address.')
        _, _, d = _call(token, GDRIVE, loc[len('https://'):], 'PUT', pptx, {'Content-Type': PPTX_MIME, **desc})
    return {'name': d.get('name', name),
            'url': d.get('webViewLink') or f"https://docs.google.com/presentation/d/{d['id']}/edit"}


def to_powerpoint(token, title, pptx):
    """Save the .pptx into OneDrive › PromptQL Slides (renamed on conflict); the webUrl opens PowerPoint for the web."""
    fname = safe_name(title) + '.pptx'
    base = 'graph.microsoft.com/v1.0/me/drive/root:/' + quote(f'PromptQL Slides/{fname}', safe='/') + ':'
    desc = {'X-PromptQL-Description': 'Save the deck as a .pptx in your OneDrive (PromptQL Slides folder)'}
    if len(pptx) <= 4 * 1024 * 1024:
        _, _, d = _call(token, MSPPT, base + '/content?@microsoft.graph.conflictBehavior=rename', 'PUT', pptx,
                        {'Content-Type': PPTX_MIME, **desc})
    else:  # upload session; the returned uploadUrl is pre-authenticated, so chunks go to it directly
        _, _, s = _call(token, MSPPT, base + '/createUploadSession', 'POST',
                        json.dumps({'item': {'@microsoft.graph.conflictBehavior': 'rename'}}).encode(),
                        {'Content-Type': 'application/json', **desc})
        up, step, d, n = s['uploadUrl'], 320 * 1024 * 16, {}, len(pptx)
        for start in range(0, n, step):
            chunk = pptx[start:start + step]
            req = urllib.request.Request(up, data=chunk, method='PUT', headers={
                'Content-Length': str(len(chunk)), 'Content-Range': f'bytes {start}-{start + len(chunk) - 1}/{n}'})
            try:
                with urllib.request.urlopen(req, timeout=300) as r:
                    raw = r.read()
                    if r.status in (200, 201):
                        d = json.loads(raw)
            except urllib.error.HTTPError as e:
                raise PushError(502, f'OneDrive upload failed: HTTP {e.code} {e.read()[:200]!r}')
    return {'name': d.get('name', fname), 'url': d.get('webUrl')}
