# Frontend Quick Start

This folder contains the Phase 2 Role B dashboard frontend.

## Run locally
Because the page loads JSON files with `fetch()`, open it through a local HTTP server instead of double-clicking the HTML file.

### Option 1: Python
```bash
cd "/Users/Richard/Downloads/Cloud Computing/Project1/diet-analysis/phase2"
python3 -m http.server 8000
```

Then open:

- `http://localhost:8000/frontend/`

## Data files used
- `data/avg_macros.json`
- `data/top_protein.json`

## Future Azure integration
Replace the JSON fetch URLs in `frontend/app.js` with Azure Function API endpoints when the backend is deployed.

