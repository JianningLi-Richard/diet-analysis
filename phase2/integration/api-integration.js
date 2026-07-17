    /* -----------------------------------------------------------
       1) CONFIG - switch this once Role A gives us the real URL
    ----------------------------------------------------------- */
    const USE_MOCK_DATA = false; // set to false when the real Azure Function endpoint is ready
    const REAL_API_BASE_URL = "https://dietanalysis-fy2026-e4fwhad5c5cqgshm.canadacentral-01.azurewebsites.net/api"; // e.g. https://diet-analysis-func.azurewebsites.net/api

    /* -----------------------------------------------------------
       2) AGREED RESPONSE CONTRACT (shared with Role A)
       Backend is expected to return JSON shaped like this:
       {
         "data": [ { "dietType": "vegan", "protein": 20, "carbs": 55, "fat": 15 }, ... ],
         "executionTimeMs": 142,
         "timestamp": "2026-07-14T10:00:00Z"
       }
    ----------------------------------------------------------- */

    /* -----------------------------------------------------------
       3) MOCK DATA - stands in for the backend until it's deployed
    ----------------------------------------------------------- */
    function getMockResponse(endpoint) {
        const mockRows = [
            { dietType: "vegan",  protein: 18, carbs: 60, fat: 12 },
            { dietType: "keto",   protein: 30, carbs: 8,  fat: 65 },
            { dietType: "paleo",  protein: 28, carbs: 25, fat: 40 },
            { dietType: "vegan",  protein: 22, carbs: 55, fat: 15 },
            { dietType: "keto",   protein: 33, carbs: 5,  fat: 70 },
            { dietType: "balanced", protein: 25, carbs: 45, fat: 25 },
            { dietType: "paleo",  protein: 32, carbs: 20, fat: 38 },
            { dietType: "balanced", protein: 20, carbs: 50, fat: 20 }
        ];

        return {
            data: mockRows,
            executionTimeMs: Math.floor(80 + Math.random() * 120), // simulated 80-200ms
            timestamp: new Date().toISOString()
        };
    }

    /* -----------------------------------------------------------
       4) INTEGRATION FUNCTION - the only function the rest of the
          app calls. Swaps between mock and real automatically based
          on USE_MOCK_DATA above.
    ----------------------------------------------------------- */
    async function fetchDashboardData(endpoint, params = {}) {
        if (USE_MOCK_DATA) {
            // Simulate network delay so metadata/loading states can be tested
            await new Promise(res => setTimeout(res, 150));
            return getMockResponse(endpoint);
        }

        const query = new URLSearchParams(params).toString();
        const url = `${REAL_API_BASE_URL}/${endpoint}${query ? "?" + query : ""}`;

        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Backend request failed: ${response.status} ${response.statusText}`);
        }
        return response.json(); // expected shape: { data, executionTimeMs, timestamp }
    }

    /* -----------------------------------------------------------
       5) METADATA RENDERING
    ----------------------------------------------------------- */
    function renderMetadata(result) {
        document.getElementById("executionTime").textContent = `${result.executionTimeMs} ms`;
        document.getElementById("lastUpdated").textContent = new Date(result.timestamp).toLocaleString();
        document.getElementById("dataSourceMode").textContent = USE_MOCK_DATA ? "MOCK DATA" : "LIVE AZURE FUNCTION";
        document.getElementById("dataSourceMode").className = USE_MOCK_DATA ? "text-purple-600" : "text-green-600";
    }

    /* -----------------------------------------------------------
       6) SCATTER PLOT (protein vs carbs, colored by diet type)
    ----------------------------------------------------------- */
    let scatterChartInstance = null;

    function renderScatterPlot(rows) {
        const dietColors = {
            vegan: "#22c55e",
            keto: "#ef4444",
            paleo: "#f59e0b",
            balanced: "#3b82f6"
        };

        const dietTypes = [...new Set(rows.map(r => r.dietType))];
        const datasets = dietTypes.map(diet => ({
            label: diet,
            data: rows.filter(r => r.dietType === diet).map(r => ({ x: r.carbs, y: r.protein })),
            backgroundColor: dietColors[diet] || "#6b7280"
        }));

        const ctx = document.getElementById("scatterPlot").getContext("2d");
        if (scatterChartInstance) scatterChartInstance.destroy();
        scatterChartInstance = new Chart(ctx, {
            type: "scatter",
            data: { datasets },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: { title: { display: true, text: "Carbs (g)" } },
                    y: { title: { display: true, text: "Protein (g)" } }
                },
                plugins: { legend: { position: "bottom", labels: { boxWidth: 10, font: { size: 10 } } } }
            }
        });
    }

    /* -----------------------------------------------------------
       7) HEATMAP (nutrient correlation matrix)
       Built with plain CSS grid so it needs no extra chart plugin.
    ----------------------------------------------------------- */
    function computeCorrelationMatrix(rows) {
        const fields = ["protein", "carbs", "fat"];

        function pearson(a, b) {
            const n = a.length;
            const meanA = a.reduce((s, v) => s + v, 0) / n;
            const meanB = b.reduce((s, v) => s + v, 0) / n;
            let num = 0, denA = 0, denB = 0;
            for (let i = 0; i < n; i++) {
                num += (a[i] - meanA) * (b[i] - meanB);
                denA += (a[i] - meanA) ** 2;
                denB += (b[i] - meanB) ** 2;
            }
            const den = Math.sqrt(denA * denB);
            return den === 0 ? 0 : num / den;
        }

        const columns = fields.map(f => rows.map(r => r[f]));
        const matrix = fields.map((_, i) =>
            fields.map((_, j) => pearson(columns[i], columns[j]))
        );
        return { fields, matrix };
    }

    function correlationColor(value) {
        // -1 -> red, 0 -> white, 1 -> blue
        if (value >= 0) {
            const intensity = Math.round(255 - value * 155);
            return `rgb(${intensity}, ${intensity}, 255)`;
        } else {
            const intensity = Math.round(255 + value * 155);
            return `rgb(255, ${intensity}, ${intensity})`;
        }
    }

    function renderHeatmap(rows) {
        const { fields, matrix } = computeCorrelationMatrix(rows);
        const container = document.getElementById("heatmap");
        container.innerHTML = "";

        const grid = document.createElement("div");
        grid.style.display = "grid";
        grid.style.gridTemplateColumns = `80px repeat(${fields.length}, 1fr)`;
        grid.style.gap = "2px";
        grid.style.fontSize = "11px";

        // top-left blank cell
        grid.appendChild(document.createElement("div"));

        // column headers
        fields.forEach(f => {
            const cell = document.createElement("div");
            cell.textContent = f;
            cell.className = "text-center font-semibold";
            grid.appendChild(cell);
        });

        // rows
        fields.forEach((rowField, i) => {
            const rowLabel = document.createElement("div");
            rowLabel.textContent = rowField;
            rowLabel.className = "font-semibold";
            grid.appendChild(rowLabel);

            matrix[i].forEach(value => {
                const cell = document.createElement("div");
                cell.textContent = value.toFixed(2);
                cell.className = "text-center p-2 rounded";
                cell.style.backgroundColor = correlationColor(value);
                grid.appendChild(cell);
            });
        });

        container.appendChild(grid);
    }

    /* -----------------------------------------------------------
       8) MAIN LOAD FUNCTION - ties it all together
    ----------------------------------------------------------- */
    async function loadDashboardData(endpoint = "insights") {
        try {
            const result = await fetchDashboardData(endpoint);
            renderMetadata(result);
            renderScatterPlot(result.data);
            renderHeatmap(result.data);
        } catch (err) {
            console.error("Failed to load dashboard data:", err);
            document.getElementById("executionTime").textContent = "error";
        }
    }

    // Wire up buttons (Role C's charts refresh on any of these for now;
    // Role B's Bar/Pie charts should hook into the same fetchDashboardData())
    document.getElementById("btnInsights").addEventListener("click", () => loadDashboardData("insights"));
    document.getElementById("btnRecipes").addEventListener("click", () => loadDashboardData("recipes"));
    document.getElementById("btnClusters").addEventListener("click", () => loadDashboardData("clusters"));

    // Initial load - wait for the full page (including CSS) to finish loading
    // so Chart.js measures a stable, final canvas size instead of racing the
    // Tailwind stylesheet. This is what fixes the "broken canvas" / oversized
    // page issue that can happen if charts render before styles are ready.
    if (document.readyState === "complete") {
        loadDashboardData("insights");
    } else {
        window.addEventListener("load", () => loadDashboardData("insights"));
    }
