# Frontend Documentation - Phase 2

## Overview
This frontend is built from the provided Phase 2 UI template and follows the teacher rubric: interactive dashboard controls, multiple visualizations, metadata display, and backend-ready integration points.

## Implemented Files
- `frontend/index.html`: UI template layout (charts, controls, API actions, pagination section)
- `frontend/app.js`: data loading, filtering, charts, metadata, table, pagination
- `frontend/data/avg_macros.json`: average macro data by diet type (Phase 1 output)
- `frontend/data/top_protein.json`: top-protein recipe data (Phase 1 output)

## Dashboard UI (Template-Aligned)
The page includes the same main sections from the teacher template:
- Explore Nutritional Insights
- Filters and Data Interaction
- API Data Interaction
- Top Protein Recipes table
- Pagination

Implemented controls:
- Search input (`Diet Type / Recipe / Cuisine`)
- Diet type dropdown filter
- Buttons: `Get Nutritional Insights`, `Get Recipes`, `Get Clusters`, `Reset Filters`
- Previous/Next pagination controls

## Visualizations
Implemented visualizations:
1. **Bar Chart**: average `Protein(g)`, `Carbs(g)`, `Fat(g)` by diet type
2. **Pie Chart**: recipe distribution by diet type
3. **Scatter Plot**: `Protein(g)` vs `Carbs(g)` (bubble size from `Fat(g)`)
4. **Heatmap table**: macro intensity by diet type (color-scaled cells)

This satisfies the requirement of at least three visualizations.

## Metadata and Interaction
- Metadata line shows source mode (`LOCAL JSON` or `AZURE FUNCTION`) and execution/load time.
- `Get Clusters` generates top cuisine clusters from recipe data.
- Recipe table supports search + diet filter + pagination.

## Backend Integration Strategy
In `frontend/app.js`, data source selection is controlled by `CONFIG`:
- `CONFIG.useMockData = true`: local JSON mode
- `CONFIG.useMockData = false`: Azure Function mode

To connect to Azure Functions, set:
- `CONFIG.azure.avg`
- `CONFIG.azure.topProtein`

No UI rewrite is needed when switching from local files to cloud endpoints.

## Notes for Submission
This frontend already covers the Role B implementation scope and is ready to be deployed as static files (for example, Azure Static Web App).

