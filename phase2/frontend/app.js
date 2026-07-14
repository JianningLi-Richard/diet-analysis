let avgMacrosData = [];
let topProteinData = [];
let filteredRecipes = [];

let currentPage = 1;
const rowsPerPage = 5;

let barChartInstance = null;
let pieChartInstance = null;

async function loadData() {
  const metaInfo = document.getElementById('metaInfo');
  const startTime = performance.now();
  metaInfo.textContent = 'Loading data...';

  try {
    const [avgResponse, proteinResponse] = await Promise.all([
      fetch('./data/avg_macros.json'),
      fetch('./data/top_protein.json')
    ]);

    if (!avgResponse.ok || !proteinResponse.ok) {
      throw new Error('Failed to load one or more data sources.');
    }

    avgMacrosData = await avgResponse.json();
    topProteinData = await proteinResponse.json();
    filteredRecipes = [...topProteinData];
    currentPage = 1;

    populateDietFilter();
    renderBarChart(avgMacrosData);
    renderPieChart(topProteinData);
    renderTable();

    const endTime = performance.now();
    metaInfo.textContent =
      `Loaded ${avgMacrosData.length} diet groups and ${topProteinData.length} recipes in ${(endTime - startTime).toFixed(2)} ms`;
  } catch (error) {
    console.error(error);
    metaInfo.textContent =
      'Unable to load dashboard data. Start a local server and try again.';
    renderEmptyState(error.message);
  }
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

  if (barChartInstance) {
    barChartInstance.destroy();
  }

  const labels = data.map(item => item["Diet_type"]);
  const protein = data.map(item => item["Protein(g)"]);
  const carbs = data.map(item => item["Carbs(g)"]);
  const fat = data.map(item => item["Fat(g)"]);

  barChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: 'Protein (g)',
          data: protein,
          backgroundColor: 'rgba(59, 130, 246, 0.7)'
        },
        {
          label: 'Carbs (g)',
          data: carbs,
          backgroundColor: 'rgba(16, 185, 129, 0.7)'
        },
        {
          label: 'Fat (g)',
          data: fat,
          backgroundColor: 'rgba(245, 158, 11, 0.7)'
        }
      ]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'top' }
      }
    }
  });
}

function renderPieChart(data) {
  const ctx = document.getElementById('pieChart').getContext('2d');

  if (pieChartInstance) {
    pieChartInstance.destroy();
  }

  const counts = {};
  data.forEach(item => {
    counts[item.Diet_type] = (counts[item.Diet_type] || 0) + 1;
  });

  const labels = Object.keys(counts);
  const values = Object.values(counts);

  pieChartInstance = new Chart(ctx, {
    type: 'pie',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: [
          '#3B82F6',
          '#10B981',
          '#F59E0B',
          '#EF4444',
          '#8B5CF6'
        ]
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: { position: 'bottom' }
      }
    }
  });
}

function applyFilters() {
  const searchValue = document.getElementById('searchInput').value.toLowerCase().trim();
  const selectedDiet = document.getElementById('dietFilter').value;

  filteredRecipes = topProteinData.filter(item => {
    const matchesSearch = item.Diet_type.toLowerCase().includes(searchValue);
    const matchesFilter = selectedDiet === 'all' || item.Diet_type.toLowerCase() === selectedDiet;
    return matchesSearch && matchesFilter;
  });

  currentPage = 1;
  renderTable();
}

function renderTable() {
  const tbody = document.getElementById('recipeTableBody');
  const pageInfo = document.getElementById('pageInfo');

  tbody.innerHTML = '';

  const start = (currentPage - 1) * rowsPerPage;
  const end = start + rowsPerPage;
  const pageData = filteredRecipes.slice(start, end);

  pageData.forEach(item => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td class="border px-4 py-2">${item.Diet_type}</td>
      <td class="border px-4 py-2">${item.Recipe_name}</td>
      <td class="border px-4 py-2">${item.Cuisine_type}</td>
      <td class="border px-4 py-2">${item["Protein(g)"]}</td>
    `;
    tbody.appendChild(row);
  });

  const totalPages = Math.max(1, Math.ceil(filteredRecipes.length / rowsPerPage));
  pageInfo.textContent = `Page ${currentPage} of ${totalPages}`;
}

function nextPage() {
  const totalPages = Math.ceil(filteredRecipes.length / rowsPerPage);
  if (currentPage < totalPages) {
    currentPage++;
    renderTable();
  }
}

function prevPage() {
  if (currentPage > 1) {
    currentPage--;
    renderTable();
  }
}

function resetFilters() {
  document.getElementById('searchInput').value = '';
  document.getElementById('dietFilter').value = 'all';
  filteredRecipes = [...topProteinData];
  currentPage = 1;
  renderTable();
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

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

document.getElementById('loadInsightsBtn').addEventListener('click', loadData);
document.getElementById('resetBtn').addEventListener('click', resetFilters);
document.getElementById('searchInput').addEventListener('input', applyFilters);
document.getElementById('dietFilter').addEventListener('change', applyFilters);
document.getElementById('nextBtn').addEventListener('click', nextPage);
document.getElementById('prevBtn').addEventListener('click', prevPage);

window.addEventListener('DOMContentLoaded', loadData);

