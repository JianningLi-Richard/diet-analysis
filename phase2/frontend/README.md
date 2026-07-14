# Frontend Quick Start

This folder contains the Phase 2 dashboard frontend aligned with the teacher UI template.

## Features
- Filters, search, buttons, and pagination
- Bar chart, pie chart, scatter plot, and heatmap table
- Metadata display with load/execution time

## Run Locally
Use a local HTTP server so `fetch()` can load JSON files.

```bash
cd "/Users/Richard/Downloads/Cloud Computing/Project1/diet-analysis/phase2"
python3 -m http.server 8000
```

Open:
- `http://localhost:8000/frontend/`

## Data Files
- `frontend/data/avg_macros.json`
- `frontend/data/top_protein.json`

## Switch to Azure Function Endpoints
Edit `frontend/app.js`:
1. Set `CONFIG.useMockData = false`
2. Set `CONFIG.azure.avg` to your Azure Function URL for avg macros
3. Set `CONFIG.azure.topProtein` to your Azure Function URL for top protein data

Then refresh the dashboard page.

