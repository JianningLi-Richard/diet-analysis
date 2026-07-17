const CONFIG = {
  csvPath: './data/All_Diets.csv',
  azure: {
    insights: 'https://dietanalysis-fy2026-e4fwhad5c5cqgshm.canadacentral-01.azurewebsites.net/api/insights'
  },
  useAzure: true
};

let avgMacrosData = [];
let topProteinData = [];
let filteredRecipes = [];

let currentPage = 1;
let rowsPerPage = 5;

let sortField = 'Protein(g)';
let sortAsc = false;

let barChartInstance = null;
let pieChartInstance = null;
let scatterChartInstance = null;

// ── CSV processing helpers ────────────────────────────────────────────────

function normalizeRow(row) {
  // Normalize Diet_type capitalisation (e.g. "paleo" → "Paleo")
  if (row['Diet_type']) {
    const d = row['Diet_type'].trim();
    row['Diet_type'] = d.charAt(0).toUpperCase() + d.slice(1).toLowerCase();
  }
  return row;
}

function computeAvgMacros(rows) {
  const groups = {};
  rows.forEach(row => {
    const diet = row['Diet_type'];
    if (!diet) return;
    if (!groups[diet]) groups[diet] = { protein: [], carbs: [], fat: [] };
    const p = parseFloat(row['Protein(g)']);
    const c = parseFloat(row['Carbs(g)']);
    const f = parseFloat(row['Fat(g)']);
    if (!isNaN(p)) groups[diet].protein.push(p);
    if (!isNaN(c)) groups[diet].carbs.push(c);
    if (!isNaN(f)) groups[diet].fat.push(f);
  });

  const avg = arr => arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;

  return Object.entries(groups).map(([diet, vals]) => ({
    Diet_type: diet,
    'Protein(g)': parseFloat(avg(vals.protein).toFixed(2)),
    'Carbs(g)':   parseFloat(avg(vals.carbs).toFixed(2)),
    'Fat(g)':     parseFloat(avg(vals.fat).toFixed(2))
  })).sort((a, b) => a.Diet_type.localeCompare(b.Diet_type));
}

function computeTopProtein(rows, topN = 5) {
  const groups = {};
  rows.forEach(row => {
    const diet = row['Diet_type'];
    const p = parseFloat(row['Protein(g)']);
    if (!diet || isNaN(p)) return;
    if (!groups[diet]) groups[diet] = [];
    groups[diet].push({
      Diet_type:    diet,
      Recipe_name:  row['Recipe_name'] || '',
      Cuisine_type: row['Cuisine_type'] || '',
      'Protein(g)': p
    });
  });

  const result = [];
  Object.values(groups).forEach(recipes => {
    recipes.sort((a, b) => b['Protein(g)'] - a['Protein(g)']);
    result.push(...recipes.slice(0, topN));
  });
  return result.sort((a, b) => b['Protein(g)'] - a['Protein(g)']);
}

async function loadData() {
  const metaInfo = document.getElementById('metaInfo');
  const startTime = performance.now();
  metaInfo.textContent = 'Loading data from CSV...';

  try {
    if (CONFIG.useAzure && CONFIG.azure.insights) {
      // ── Azure Function mode ──
      const res = await fetch(CONFIG.azure.insights);
      if (!res.ok) throw new Error('Azure endpoint error');
      const result = await res.json();

      const rows = result.data.map(r => ({
        Diet_type: r.dietType,
        Recipe_name: r.recipeName,
        Cuisine_type: r.cuisineType,
        'Protein(g)': r.protein,
        'Carbs(g)': r.carbs,
        'Fat(g)': r.fat
      })).map(normalizeRow);

      avgMacrosData  = computeAvgMacros(rows);
      topProteinData = rows;
      finishLoad(startTime, 'AZURE FUNCTION');
    } else {
      // ── CSV mode ──
      const response = await fetch(CONFIG.csvPath);
      if (!response.ok) throw new Error(`Cannot load CSV: ${CONFIG.csvPath}`);
      const csvText = await response.text();

      const parsed = Papa.parse(csvText, {
        header: true,
        skipEmptyLines: true,
        trimHeaders: true
      });

       const rows = parsed.data.map(normalizeRow);
       avgMacrosData  = computeAvgMacros(rows);
       topProteinData = rows;  // Use all rows, not just top 5
       finishLoad(startTime, `CSV: All_Diets.csv (${rows.length.toLocaleString()} rows)`);
    }
  } catch (error) {
    console.error(error);
    metaInfo.textContent = `Error: ${error.message}`;
    renderEmptyState(error.message);
    document.getElementById('heatmap').innerHTML = '<p class="text-red-500">No heatmap data available.</p>';
    document.getElementById('clusterOutput').textContent = '';
  }
}

function finishLoad(startTime, sourceLabel) {
  filteredRecipes = [...topProteinData];

  // Apply initial sort (Protein high to low)
  sortField = 'Protein(g)';
  sortAsc = false;
  const sortSelect = document.getElementById('sortBySelect');
  if (sortSelect) sortSelect.value = 'Protein(g)-desc';
  filteredRecipes.sort((a, b) => {
    const aNum = parseFloat(a[sortField]) || 0;
    const bNum = parseFloat(b[sortField]) || 0;
    return bNum - aNum;  // High to low
  });

  currentPage = 1;
  populateDietFilter();
  renderAllVisuals();
  renderTable();
  const elapsed = ((performance.now() - startTime) / 1000).toFixed(2);
  document.getElementById('metaInfo').textContent =
    `Source: ${sourceLabel} | ${avgMacrosData.length} diet groups, ${topProteinData.length} recipes | Execution ${elapsed}s`;
}

function renderAllVisuals() {
  renderBarChart(avgMacrosData);
  renderPieChart(topProteinData);
  renderScatterChart(filteredRecipes);
  renderHeatmap(filteredRecipes);
}

function populateDietFilter() {
  const dietFilter = document.getElementById('dietFilter');
  const dietTypes = [...new Set(topProteinData.map(item => item.Diet_type))].sort();

  dietFilter.innerHTML = '<option value="all">All Diet Types</option>';
  dietTypes.forEach(diet => {
    const option = document.createElement('option');
    option.value = diet.toLowerCase();
    option.textContent = diet;
    dietFilter.appendChild(option);
  });
}

function renderBarChart(data) {
  const ctx = document.getElementById('barChart').getContext('2d');
  if (barChartInstance) barChartInstance.destroy();

  if (!data.length) {
    ctx.canvas.parentElement.querySelector('p') && ctx.canvas.parentElement.querySelector('p').remove();
    const msg = document.createElement('p');
    msg.className = 'text-gray-400 text-sm text-center mt-4';
    msg.textContent = 'No data for current filter.';
    ctx.canvas.style.display = 'none';
    ctx.canvas.parentElement.appendChild(msg);
    return;
  }
  ctx.canvas.style.display = '';
  const oldMsg = ctx.canvas.parentElement.querySelector('p.text-gray-400');
  if (oldMsg) oldMsg.remove();

  barChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(item => item.Diet_type),
      datasets: [
        {
          label: 'Protein (g)',
          data: data.map(item => item['Protein(g)']),
          backgroundColor: 'rgba(59, 130, 246, 0.7)'
        },
        {
          label: 'Carbs (g)',
          data: data.map(item => item['Carbs(g)']),
          backgroundColor: 'rgba(16, 185, 129, 0.7)'
        },
        {
          label: 'Fat (g)',
          data: data.map(item => item['Fat(g)']),
          backgroundColor: 'rgba(245, 158, 11, 0.7)'
        }
      ]
    },
    options: {
      responsive: true,
      scales: { y: { beginAtZero: true } }
    }
  });
}

function renderPieChart(data) {
  const ctx = document.getElementById('pieChart').getContext('2d');
  if (pieChartInstance) pieChartInstance.destroy();

  const counts = countByDiet(data);
  pieChartInstance = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: Object.keys(counts),
      datasets: [{
        data: Object.values(counts),
        backgroundColor: ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6']
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { position: 'bottom' } }
    }
  });
}

// Color palette per diet type for scatter plot
const DIET_COLORS = {
  'Dash':          'rgba(59, 130, 246, 0.75)',
  'Keto':          'rgba(16, 185, 129, 0.75)',
  'Mediterranean': 'rgba(245, 158, 11, 0.75)',
  'Paleo':         'rgba(239, 68, 68, 0.75)',
  'Vegan':         'rgba(139, 92, 246, 0.75)'
};

// Real dataset has ~1,000+ recipes per diet type - plotting all of them at
// once turns the scatter plot into a solid blob. Take an evenly-spaced
// sample per diet type so shape/spread is still representative but the
// canvas stays readable.
function sampleByDiet(rows, maxPerDiet) {
  const groups = {};
  rows.forEach(r => {
    if (!groups[r.Diet_type]) groups[r.Diet_type] = [];
    groups[r.Diet_type].push(r);
  });
  const sampled = [];
  Object.values(groups).forEach(group => {
    if (group.length <= maxPerDiet) { sampled.push(...group); return; }
    const step = group.length / maxPerDiet;
    for (let i = 0; i < maxPerDiet; i++) sampled.push(group[Math.floor(i * step)]);
  });
  return sampled;
}

function renderScatterChart(rows) {
  const ctx = document.getElementById('scatterPlot').getContext('2d');
  if (scatterChartInstance) scatterChartInstance.destroy();
  if (!rows.length) { ctx.canvas.style.display = 'none'; return; }
  ctx.canvas.style.display = '';

  const plotRows = sampleByDiet(rows, 8);
  const dietTypes = [...new Set(plotRows.map(r => r.Diet_type))];
  const datasets = dietTypes.map(diet => ({
    label: diet,
    data: plotRows.filter(r => r.Diet_type === diet)
              .map(r => ({ x: r['Carbs(g)'], y: r['Protein(g)'] })),
    backgroundColor: DIET_COLORS[diet] || 'rgba(156,163,175,0.7)',
    pointRadius: 5
  }));

  scatterChartInstance = new Chart(ctx, {
    type: 'scatter',
    data: { datasets },
    options: {
      responsive: true,
      scales: {
        x: { title: { display: true, text: 'Carbs (g)' }, max: 150 },
        y: { title: { display: true, text: 'Protein (g)' }, max: 150 }
      },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 10, font: { size: 10 } } } }
    }
  });
}

function renderHeatmap(rows) {
  const container = document.getElementById('heatmap');
  if (!rows.length) {
    container.innerHTML = '<p class="text-gray-400 text-sm text-center mt-4">No data for current filter.</p>';
    return;
  }
  const fields = ['Protein(g)', 'Carbs(g)', 'Fat(g)'];

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
  const matrix = fields.map((_, i) => fields.map((_, j) => pearson(columns[i], columns[j])));

  function color(v) {
    return v >= 0
      ? `rgb(${Math.round(255 - v * 155)}, ${Math.round(255 - v * 155)}, 255)`
      : `rgb(255, ${Math.round(255 + v * 155)}, ${Math.round(255 + v * 155)})`;
  }

  let html = '<div style="display:grid;grid-template-columns:80px repeat(3,1fr);gap:2px;font-size:11px;"><div></div>';
  fields.forEach(f => html += `<div class="text-center font-semibold">${f.replace('(g)','')}</div>`);
  fields.forEach((rowField, i) => {
    html += `<div class="font-semibold">${rowField.replace('(g)','')}</div>`;
    matrix[i].forEach(v => html += `<div class="text-center p-2 rounded" style="background:${color(v)}">${v.toFixed(2)}</div>`);
  });
  html += '</div>';
  container.innerHTML = html;
}

function applyFilters() {
  const searchValue = document.getElementById('searchInput').value.toLowerCase().trim();
  const selectedDiet = document.getElementById('dietFilter').value;

  filteredRecipes = topProteinData.filter(item => {
    const diet = String(item.Diet_type || '').toLowerCase();
    const recipe = String(item.Recipe_name || '').toLowerCase();
    const cuisine = String(item.Cuisine_type || '').toLowerCase();
    const matchesSearch = !searchValue || diet.includes(searchValue) || recipe.includes(searchValue) || cuisine.includes(searchValue);
    const matchesFilter = selectedDiet === 'all' || diet === selectedDiet;
    return matchesSearch && matchesFilter;
  });

  // Find active diet types in filteredRecipes to update charts
  const activeDietTypes = new Set(filteredRecipes.map(item => item.Diet_type));

  // Filter avgMacrosData to keep only active diet types (used by Bar Chart)
  const filteredAvg = avgMacrosData.filter(item => activeDietTypes.has(item.Diet_type));

  // Apply current sort to filtered recipes
  filteredRecipes.sort((a, b) => {
    let aVal = a[sortField];
    let bVal = b[sortField];

    const aNum = parseFloat(aVal);
    const bNum = parseFloat(bVal);

    if (!isNaN(aNum) && !isNaN(bNum)) {
      return sortAsc ? aNum - bNum : bNum - aNum;
    }

    aVal = String(aVal ?? '').toLowerCase();
    bVal = String(bVal ?? '').toLowerCase();
    return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
  });

  // Sync update all charts
  if (filteredAvg.length > 0) {
    renderBarChart(filteredAvg);
    renderScatterChart(filteredRecipes);
    renderHeatmap(filteredRecipes);
  } else {
    renderBarChart([]);
    renderScatterChart([]);
    renderHeatmap([]);
  }
  renderPieChart(filteredRecipes);

  currentPage = 1;
  renderTable();
}

function sortRecipes(sortOption) {
  // Parse sort option: "field-asc" or "field-desc" or legacy "field"
  if (sortOption.endsWith('-asc')) {
    sortField = sortOption.slice(0, -4);
    sortAsc = true;
  } else if (sortOption.endsWith('-desc')) {
    sortField = sortOption.slice(0, -5);
    sortAsc = false;
  } else {
    sortField = sortOption;
    // Legacy fallback: strings default A-Z, numeric default high-to-low
    sortAsc = sortField === 'Diet_type' || sortField === 'Recipe_name' || sortField === 'Cuisine_type';
  }

  filteredRecipes.sort((a, b) => {
    let aVal = a[sortField];
    let bVal = b[sortField];

    const aNum = parseFloat(aVal);
    const bNum = parseFloat(bVal);

    if (!isNaN(aNum) && !isNaN(bNum)) {
      return sortAsc ? aNum - bNum : bNum - aNum;
    }

    aVal = String(aVal ?? '').toLowerCase();
    bVal = String(bVal ?? '').toLowerCase();
    return sortAsc ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
  });

  currentPage = 1;
  renderTable();
}

function setRowsPerPage(num) {
  rowsPerPage = parseInt(num);
  currentPage = 1;
  renderTable();
}

function renderTable() {
  const tbody = document.getElementById('recipeTableBody');
  const pageInfo = document.getElementById('pageInfo');
  tbody.innerHTML = '';

  if (!filteredRecipes.length) {
    tbody.innerHTML = '<tr><td colspan="4" class="px-4 py-6 text-center text-gray-500">No matching recipes found.</td></tr>';
    pageInfo.textContent = 'Page 1 of 1';
    return;
  }

  const start = (currentPage - 1) * rowsPerPage;
  const end = start + rowsPerPage;
  const pageData = filteredRecipes.slice(start, end);

  pageData.forEach(item => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td class="border px-4 py-2">${escapeHtml(item.Diet_type)}</td>
      <td class="border px-4 py-2">${escapeHtml(item.Recipe_name)}</td>
      <td class="border px-4 py-2">${escapeHtml(item.Cuisine_type)}</td>
      <td class="border px-4 py-2">${Number(item['Protein(g)']).toFixed(2)}</td>
    `;
    tbody.appendChild(row);
  });

  const totalPages = Math.max(1, Math.ceil(filteredRecipes.length / rowsPerPage));
  pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
}

function nextPage() {
  const totalPages = Math.ceil(filteredRecipes.length / rowsPerPage);
  if (currentPage < totalPages) {
    currentPage += 1;
    renderTable();
  }
}

function prevPage() {
  if (currentPage > 1) {
    currentPage -= 1;
    renderTable();
  }
}

function resetFilters() {
  document.getElementById('searchInput').value = '';
  document.getElementById('dietFilter').value = 'all';
  document.getElementById('sortBySelect').value = 'Protein(g)-desc';
  document.getElementById('rowsPerPageSelect').value = '5';

  filteredRecipes = [...topProteinData];
  currentPage = 1;
  sortField = 'Protein(g)';
  sortAsc = false;
  rowsPerPage = 5;
  document.getElementById('clusterOutput').textContent = '';

  // Re-render all charts with all data
  renderBarChart(avgMacrosData);
  renderScatterChart(topProteinData);
  renderHeatmap(topProteinData);
  renderPieChart(filteredRecipes);
  renderTable();
}

function showRecipes() {
  filteredRecipes = [...topProteinData];
  currentPage = 1;
  renderTable();
  document.getElementById('metaInfo').textContent = `Showing ${filteredRecipes.length} top-protein recipes.`;
}

function showCuisineClusters() {
  const counts = {};
  topProteinData.forEach(item => {
    const cuisine = item.Cuisine_type || 'unknown';
    counts[cuisine] = (counts[cuisine] || 0) + 1;
  });

  const topFive = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => `${name} (${count})`)
    .join(' | ');

  document.getElementById('clusterOutput').textContent = `Cuisine clusters (top 5): ${topFive}`;
}

function renderEmptyState(message) {
  const tbody = document.getElementById('recipeTableBody');
  tbody.innerHTML = `
    <tr>
      <td colspan="4" class="px-4 py-6 text-center text-red-500">${escapeHtml(message)}</td>
    </tr>
  `;
  document.getElementById('pageInfo').textContent = 'Page 1 of 1';
}

function countByDiet(data) {
  const counts = {};
  data.forEach(item => {
    const key = item.Diet_type || 'Unknown';
    counts[key] = (counts[key] || 0) + 1;
  });
  return counts;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Modal expand logic ─────────────────────────────────────────────────────
let modalChartInstance = null;

const MODAL_TITLES = {
  bar:     'Bar Chart – Average Macronutrient Content by Diet Type',
  scatter: 'Scatter Plot – Protein vs Carbs across Diet Types',
  heatmap: 'Heatmap – Relative Macro Intensity by Diet Type',
  pie:     'Pie Chart – Recipe Distribution by Diet Type'
};

function openModal(type) {
  const modal = document.getElementById('chartModal');
  const canvas = document.getElementById('modalCanvas');
  const heatmapDiv = document.getElementById('modalHeatmap');

  document.getElementById('modalTitle').textContent = MODAL_TITLES[type] || type;

  // Destroy previous modal chart
  if (modalChartInstance) { modalChartInstance.destroy(); modalChartInstance = null; }
  heatmapDiv.innerHTML = '';
  canvas.style.display = 'none';
  heatmapDiv.style.display = 'none';

  if (type === 'heatmap') {
    heatmapDiv.style.display = 'block';
    // Re-render heatmap as a larger table inside modal
    const data = avgMacrosData.filter(item =>
      new Set(filteredRecipes.map(r => r.Diet_type)).has(item.Diet_type)
    );
    const renderData = data.length ? data : avgMacrosData;
    const cols = ['Protein(g)', 'Carbs(g)', 'Fat(g)'];
    const maxValues = {
      'Protein(g)': Math.max(...renderData.map(d => d['Protein(g)'])),
      'Carbs(g)':   Math.max(...renderData.map(d => d['Carbs(g)'])),
      'Fat(g)':     Math.max(...renderData.map(d => d['Fat(g)']))
    };
    const header = `<tr>
      <th class="border px-4 py-2 text-left font-semibold">Diet Type</th>
      ${cols.map(c => `<th class="border px-4 py-2 font-semibold">${c.replace('(g)', '')} (g)</th>`).join('')}
    </tr>`;
    const rows = renderData.map(item => {
      const cells = cols.map(col => {
        const ratio = item[col] / maxValues[col];
        const alpha = Math.max(0.15, ratio);
        return `<td class="border px-4 py-3 text-center text-sm" style="background:rgba(59,130,246,${alpha.toFixed(2)});">
          ${item[col].toFixed(1)}
        </td>`;
      }).join('');
      return `<tr><td class="border px-4 py-3 font-medium">${escapeHtml(item.Diet_type)}</td>${cells}</tr>`;
    }).join('');
    heatmapDiv.innerHTML = `<table class="w-full border-collapse text-base">${header}${rows}</table>`;
  } else {
    canvas.style.display = 'block';
    // Reset canvas size for proper rendering
    canvas.width = 800;
    canvas.height = 450;
    const ctx = canvas.getContext('2d');

    if (type === 'bar') {
      const data = avgMacrosData.filter(item =>
        new Set(filteredRecipes.map(r => r.Diet_type)).has(item.Diet_type)
      );
      const renderData = data.length ? data : avgMacrosData;
      modalChartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: renderData.map(i => i.Diet_type),
          datasets: [
            { label: 'Protein (g)', data: renderData.map(i => i['Protein(g)']), backgroundColor: 'rgba(59,130,246,0.7)' },
            { label: 'Carbs (g)',   data: renderData.map(i => i['Carbs(g)']),   backgroundColor: 'rgba(16,185,129,0.7)' },
            { label: 'Fat (g)',     data: renderData.map(i => i['Fat(g)']),     backgroundColor: 'rgba(245,158,11,0.7)' }
          ]
        },
        options: { responsive: true, scales: { y: { beginAtZero: true } } }
      });

    } else if (type === 'pie') {
      const counts = countByDiet(filteredRecipes.length ? filteredRecipes : topProteinData);
      modalChartInstance = new Chart(ctx, {
        type: 'pie',
        data: {
          labels: Object.keys(counts),
          datasets: [{ data: Object.values(counts), backgroundColor: ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6'] }]
        },
        options: { responsive: true, plugins: { legend: { position: 'bottom' } } }
      });

    } else if (type === 'scatter') {
      const allRows = filteredRecipes.length ? filteredRecipes : topProteinData;
      const renderRows = sampleByDiet(allRows, 40); // modal canvas is bigger, allow a few more points
      const dietTypes = [...new Set(renderRows.map(r => r.Diet_type))];
      const datasets = dietTypes.map(diet => ({
        label: diet,
        data: renderRows.filter(r => r.Diet_type === diet)
                        .map(r => ({ x: r['Carbs(g)'], y: r['Protein(g)'], name: r.Recipe_name })),
        backgroundColor: DIET_COLORS[diet] || 'rgba(156,163,175,0.7)',
        pointRadius: 5
      }));
      modalChartInstance = new Chart(ctx, {
        type: 'scatter',
        data: { datasets },
        options: {
          responsive: true, parsing: false,
          plugins: {
            legend: { position: 'bottom' },
            tooltip: { callbacks: { label(c) { return `${c.raw.name}: Protein ${c.raw.y.toFixed(1)}g, Carbs ${c.raw.x.toFixed(1)}g`; } } }
          },
          scales: {
            x: { title: { display: true, text: 'Carbs (g)' }, max: 150 },
            y: { title: { display: true, text: 'Protein (g)' }, max: 150 }
          }
        }
      });
    }
  }

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeModal(event) {
  if (event && event.target !== document.getElementById('chartModal') && event.type !== 'click') return;
  const modal = document.getElementById('chartModal');
  modal.classList.remove('open');
  document.body.style.overflow = '';
  if (modalChartInstance) { modalChartInstance.destroy(); modalChartInstance = null; }
}

// Close on Escape key
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeModal(); });

// ── Event listeners ────────────────────────────────────────────────────────
document.getElementById('loadInsightsBtn').addEventListener('click', loadData);
document.getElementById('loadRecipesBtn').addEventListener('click', showRecipes);
document.getElementById('loadClustersBtn').addEventListener('click', showCuisineClusters);
document.getElementById('resetBtn').addEventListener('click', resetFilters);
document.getElementById('searchInput').addEventListener('input', applyFilters);
document.getElementById('dietFilter').addEventListener('change', applyFilters);
document.getElementById('nextBtn').addEventListener('click', nextPage);
document.getElementById('prevBtn').addEventListener('click', prevPage);
document.getElementById('sortBySelect').addEventListener('change', (e) => sortRecipes(e.target.value));
document.getElementById('rowsPerPageSelect').addEventListener('change', (e) => setRowsPerPage(e.target.value));

window.addEventListener('DOMContentLoaded', loadData);