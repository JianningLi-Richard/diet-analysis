# Frontend Documentation – Phase 2 Role B

## Overview
This frontend dashboard was built for Phase 2 of the cloud dashboard project. The goal of the frontend is to present nutritional insights from the diets dataset in a clear, interactive, and browser-based dashboard.

## Role B Responsibilities Completed
As Role B – Frontend Developer, the following tasks were completed:
- built the dashboard user interface
- added search and diet filter controls
- added interactive buttons
- added pagination for recipe browsing
- implemented 2 charts: Bar Chart and Pie Chart
- prepared this short frontend documentation

## Files
- `frontend/index.html` – dashboard structure and layout
- `frontend/app.js` – frontend logic and chart rendering
- `frontend/FRONTEND_DOC.md` – short explanation of the frontend implementation

## Features Implemented

### 1. Dashboard UI
The dashboard includes:
- a search box
- a diet type dropdown filter
- a "Get Nutritional Insights" button
- a "Reset Filters" button
- a recipe table with pagination
- metadata text showing load status and execution time

### 2. Charts
Two charts were implemented using Chart.js.

#### Bar Chart
The bar chart shows the average values of:
- Protein (g)
- Carbs (g)
- Fat (g)

for each diet type.

This chart uses data from `data/avg_macros.json`.

#### Pie Chart
The pie chart shows the distribution of top protein recipe entries by diet type.

This chart uses data from `data/top_protein.json`.

### 3. Search and Filter
Users can:
- search by diet type, recipe name, or cuisine
- filter recipes by selected diet type

This makes the table easier to explore interactively.

### 4. Pagination
The top protein recipes are shown in a paginated table.
Users can move between pages using the Previous and Next buttons.

### 5. Data Source
The current frontend uses local JSON data generated from the Phase 1 backend analysis:
- `data/avg_macros.json`
- `data/top_protein.json`

## Integration with Cloud Backend
This frontend is designed so that the local JSON fetch calls can later be replaced with Azure Function API endpoints. That means the interface can remain the same while the backend changes from local files to cloud-hosted services.

## Summary
This dashboard satisfies the Role B frontend requirements by providing:
- dashboard UI controls
- 2 working charts
- interactive filtering and search
- pagination for recipe records
- documentation for the frontend implementation

