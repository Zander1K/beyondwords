# Verda (Nemotron serving)

Junction 2026 hosts Nemotron 3.5 Super VL for teams (vLLM, NVFP4 on B300, 1M context), so we
do not self-host. Endpoint: `NEMOTRON_BASE_URL` in `.env.example`; key in `NEMOTRON_API_KEY`
(starts with `dc_`, ask Matthew). Model id: `nemotron-3.5-super-vl`. Organisers' opencode
config lists tool calling as supported and the reasoning field as `reasoning_content`.

Health check: `make nemotron-check` (add `IMAGE=page.jpg` to test vision).

Behaviour seen 2026-11-14: a wrong key gets an instant 404 from the gateway; the right key is
routed to the container, which did not answer for 10+ minutes (cold start or overload). The
brain retries 3 times, then falls back to NVIDIA Build if `NVIDIA_BUILD_API_KEY` is set, and
otherwise the API serves `fallback_page()` so reading continues. See docs/BRAIN.md.

OPEN QUESTION: rate limits on the shared endpoint.
