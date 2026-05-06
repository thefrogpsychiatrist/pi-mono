# PI Studio Desktop (Windows Prerelease Track)

This package contains the Electron desktop shell for PI Studio.

Current scope:

- Wraps the PI Studio web UI surface.
- Exposes coding-agent RPC to the renderer for plugin/skill settings.
- Targets Windows prerelease distribution first (`.exe` + `.zip`).

Environment variables:

- `PI_STUDIO_RENDERER_URL` (optional): renderer URL (default `http://127.0.0.1:4173/`).
- `PI_STUDIO_RPC_CLI_PATH` (optional): path to coding-agent RPC CLI entrypoint.
