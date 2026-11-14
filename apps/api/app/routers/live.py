"""WS /live: Gemini Live session bridge.

TODO(Mick Ola): build order step 7. Inject page/book context server-side at session start
and on every page change; auto-reconnect on session expiry.

Origin check: CORSMiddleware does not apply to WebSockets, so the endpoint must check the
handshake Origin itself before accepting, e.g.

    if not is_origin_allowed(websocket.headers.get("origin"), get_settings().cors_origin_list):
        await websocket.close(code=1008)  # policy violation
        return

`is_origin_allowed` lives in app/middleware.py; allowed origins come from CORS_ORIGINS, which
includes the web app's dev origin (http://localhost:5173) by default.
"""
