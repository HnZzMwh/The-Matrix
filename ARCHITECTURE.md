# Architecture Memory (Persisted)

## ADRs (Architecture Decision Records)
1. **Use ThreadingHTTPServer over HTTPServer**: Prevents external API timeouts (e.g., Seniverse weather) from blocking the single-threaded main event loop.
2. **Dashboard rendering must use setInterval**: Avoids `requestAnimationFrame` CPU contention with the existing 60FPS LetterGlitch canvas. Polling interval set to 1500ms.

## Module Boundaries
- **Dashboard**: Frontend dashboard logic resides in `renderer/js/dashboard.js` and `renderer/css/dashboard.css`. It uses `renderer/js/api.js` for network calls. It MUST NOT directly access the filesystem or environment variables.
- **Security**: Seniverse API key is stored in `.env` and read by the Python backend. Frontend calls the backend proxy (`/api/weather`), never Seniverse directly.

## File Ownership
- `server.py` and backend routes: Anderson
- `renderer/js/dashboard.js` and frontend integration: Trinity/Neo
