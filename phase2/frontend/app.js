const CONFIG = {
  useMockData: true,
  mock: {
    avg: './data/avg_macros.json',
    topProtein: './data/top_protein.json'
  },
  azure: {
    avg: '',
    topProtein: ''
  }
};

let avgMacrosData = [];
let topProteinData = [];
let filteredRecipes = [];

let currentPage = 1;
const rowsPerPage = 5;

let barChartInstance = null;
let pieChartInstance = null;
let scatterChartInstance = null;

function getDataUrls() {
  if (CONFIG.useMockData) {
    return CONFIG.mock;
  }
  return CONFIG.azure;
}

async function loadData() {
  const metaInfo = document.getElementById('metaInfo');
  const startTime = performance.now();
  metaInfo.textContent = 'Loading data...';

  try {
    const urls = getDataUrls();
    const [avgResponse, proteinResponse] = await Promise.all([
      fetch(urls.avg),
      fetch(urls.topProtein)
    ]);

    if (!avgResponse.ok || !proteinResponse.ok) {
      const message = 'Failed to load one or more data sources.';
      metaInfo.textContent = message;
      renderEmptyState(message);
      document.getElementById('heatmap').innerHTML = '<p class="text-red-500">No heatmap data available.</p>';
      return;
    }

    avgMacrosData = await avgResponse.json();
    topProteinData = await proteinResponse.json();
    filteredRecipes = [...topProteinData];
    currentPage = 1;

    populateDietFilter();
    renderAllVisuals();
    renderTable();

    const endTime = performance.now();
    const mode = CONFIG.useMockData ? 'LOCAL JSON' : 'AZURE FUNCTION';
    metaInfo.textContent =
      `Source: ${mode} | ${avgMacrosData.length} diet groups, ${topProteinData.length} recipes | Execution ${((endTime - startTime) / 1000).toFixed(2)} s`;
  } catch (error) {
    console.error(error);
    metaInfo.textContent = 'Unable to load dashboard data. Check endpoint/path and try again.';
    renderEmptyState(error.message);
    document.getElementById('heatmap').innerHTML = '<p class="text-red-500">No heatmap data available.</p>';
    document.getElementById('clusterOutput').textContent = '';
  }
}

function renderAllVisuals() {
  renderBarChart(avgMacrosData);
  renderPieChart(topProteinData);
  renderScatterChart(avgMacrosData);
  renderHeatmap(avgMacrosData);
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

function renderScatterChart(data) {
  const ctx = document.getElementById('scatterPlot').getContext('2d');
  if (scatterChartInstance) scatterChartInstance.destroy();

  const points = data.map(item => ({
    x: item['Carbs(g)'],
    y: item['Protein(g)'],
    r: Math.max(4, Math.min(14, item['Fat(g)'] / 20)),
    diet: item.Diet_type
  }));

  scatterChartInstance = new Chart(ctx, {
    type: 'bubble',
    data: {
      datasets: [{
        label: 'Diet Type Bubble (size = fat)',
        data: points,
        backgroundColor: 'rgba(99, 102, 241, 0.55)'
      }]
    },
    options: {
      responsive: true,
      parsing: false,
      plugins: {
        tooltip: {
          callbacks: {
            label(context) {
              const raw = context.raw;
              return `${raw.diet}: Protein ${raw.y.toFixed(2)}g, Carbs ${raw.x.toFixed(2)}g, Fat size ${raw.r.toFixed(1)}`;
            }
          }
        }
      },
      scales: {
        x: { title: { display: true, text: 'Carbs (g)' } },
        y: { title: { display: true, text: 'Protein (g)' } }
      }
    }
  });
}

function renderHeatmap(data) {
  const container = document.getElementById('heatmap');
  const cols = ['Protein(g)', 'Carbs(g)', 'Fat(g)'];
  const maxValues = {
    'Protein(g)': Math.max(...data.map(d => d['Protein(g)'])),
    'Carbs(g)': Math.max(...data.map(d => d['Carbs(g)'])),
    'Fat(g)': Math.max(...data.map(d => d['Fat(g)']))
  };

  const header = `<tr><th class="border px-2 py-1">Diet</th>${cols.map(c => `<th class="border px-2 py-1">${c.replace('(g)', '')}</th>`).join('')}</tr>`;
  const rows = data.map(item => {
    const cells = cols.map(col => {
      const ratio = item[col] / maxValues[col];
      const alpha = Math.max(0.15, ratio);
      return `<td class="border px-2 py-1 text-center" style="background: rgba(59,130,246,${alpha.toFixed(2)});">${item[col].toFixed(1)}</td>`;
    }).join('');
    return `<tr><td class="border px-2 py-1">${escapeHtml(item.Diet_type)}</td>${cells}</tr>`;
  }).join('');

  container.innerHTML = `<table class="text-xs w-full border-collapse">${header}${rows}</table>`;
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
  filteredRecipes = [...topProteinData];
  currentPage = 1;
  document.getElementById('clusterOutput').textContent = '';
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

document.getElementById('loadInsightsBtn').addEventListener('click', loadData);
document.getElementById('loadRecipesBtn').addEventListener('click', showRecipes);
document.getElementById('loadClustersBtn').addEventListener('click', showCuisineClusters);
document.getElementById('resetBtn').addEventListener('click', resetFilters);
document.getElementById('searchInput').addEventListener('input', applyFilters);
document.getElementById('dietFilter').addEventListener('change', applyFilters);
document.getElementById('nextBtn').addEventListener('click', nextPage);
document.getElementById('prevBtn').addEventListener('click', prevPage);

window.addEventListener('DOMContentLoaded', loadData);

