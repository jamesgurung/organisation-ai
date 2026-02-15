document.addEventListener('DOMContentLoaded', () => {
  const startSelect = document.getElementById('startSelect');
  const endSelect = document.getElementById('endSelect');
  const groupSelect = document.getElementById('groupSelect');
  const totalElement = document.getElementById('total');

  let weeklyChart = null;
  let totalChart = null;
  let groupColors = {};
  let filters = {};

  const colorPalette = ['#5e5ce6', '#dc3912', '#109618', '#ff9900', '#990099', '#0099c6', '#dd4477', '#316395', '#22aa99', '#aaaa11', '#6633cc', '#e67300', '#8b0707',
    '#651067', '#329262', '#5574a6', '#3b3eac', '#b77322', '#16d620', '#b91383', '#f4359e', '#9c5935', '#a9c413', '#2a778d', '#668d1c', '#bea413', '#0c5922', '#743411'];

  const formatCurrency = value => value.toFixed(2);

  const init = async () => {
    if (spendData.length > 0) {
      assignGroupColors();
      populateDropdowns();
      renderCharts();

      startSelect.addEventListener('change', handleFilterChange);
      endSelect.addEventListener('change', handleFilterChange);
      groupSelect.addEventListener('change', handleFilterChange);

      window.addEventListener('resize', () => {
        clearTimeout(window.resizeTimeout);
        window.resizeTimeout = setTimeout(() => { renderCharts(); }, 200);
      });
    } else {
      document.getElementById('content').innerHTML = '<div style="text-align: center; margin-bottom: 30px">Unavailable</div>';
    }
    document.getElementById('usage-container').style.opacity = '1';
  };

  const assignGroupColors = () => {
    const allGroups = [...new Set(spendData.map(item => item.group))].sort();
    allGroups.forEach((group, index) => {
      groupColors[group] = colorPalette[index % colorPalette.length];
    });
  };

  const populateDropdowns = () => {
    const weeks = [...new Set(spendData.map(item => item.week))].sort();
    const groups = [...new Set(spendData.map(item => item.group))].sort();

    const defaultStartIndex = Math.max(0, weeks.length - 26);

    weeks.forEach((week, index) => {
      const dateString = "w/b " + new Date(week).toLocaleDateString();
      const startOption = document.createElement('option');
      startOption.value = week;
      startOption.textContent = dateString;
      if (index === defaultStartIndex) startOption.selected = true;
      startSelect.appendChild(startOption);

      const endOption = document.createElement('option');
      endOption.value = week;
      endOption.textContent = dateString;
      if (week === weeks[weeks.length - 1]) endOption.selected = true;
      endSelect.appendChild(endOption);
    });

    groups.forEach(group => {
      const option = document.createElement('option');
      option.value = group;
      option.textContent = group;
      groupSelect.appendChild(option);
    });

    filters.selectedGroup = 'all';
    filters.selectedStart = weeks[defaultStartIndex];
    filters.selectedEnd = weeks[weeks.length - 1];
  };

  const handleFilterChange = (e) => {
    filters.selectedStart = startSelect.value;
    filters.selectedEnd = endSelect.value;
    filters.selectedGroup = groupSelect.value;

    if (e.target.id === 'startSelect' && filters.selectedStart > filters.selectedEnd) {
      filters.selectedEnd = filters.selectedStart;
      endSelect.value = filters.selectedEnd;
    } else if (e.target.id === 'endSelect' && filters.selectedEnd < filters.selectedStart) {
      filters.selectedStart = filters.selectedEnd;
      startSelect.value = filters.selectedStart;
    }

    renderCharts();
  };

  const applyFilters = data => {
    let filtered = [...data];

    filtered = filtered.filter(item => item.week >= filters.selectedStart);
    filtered = filtered.filter(item => item.week <= filters.selectedEnd);
    if (filters.selectedGroup !== 'all') filtered = filtered.filter(item => item.group === filters.selectedGroup);

    return filtered;
  };

  const renderCharts = () => {
    const filteredData = applyFilters(spendData);
    renderWeeklyChart(filteredData);
    renderTotalChart(filteredData);
    renderUsersTable(filteredData);
  };

  const renderWeeklyChart = data => {
    const weeks = [...new Set(data.map(item => item.week))].sort();
    const groups = [...new Set(data.map(item => item.group))];

    const datasets = groups.map(group => {
      const groupData = weeks.map(week => {
        return data
          .filter(item => item.week === week && item.group === group)
          .reduce((sum, item) => sum + parseFloat(item.spend), 0);
      });

      return {
        label: group,
        data: groupData,
        backgroundColor: groupColors[group],
        borderColor: groupColors[group],
        borderWidth: 2,
        borderColor: 'white'
      };
    });

    if (weeklyChart) {
      weeklyChart.destroy();
    }

    const weeklyChartCtx = document.getElementById('weeklySpendChart').getContext('2d');
    weeklyChart = new Chart(weeklyChartCtx, {
      type: 'bar',
      data: {
        labels: weeks.map(w => {
          const date = new Date(w);
          return `Week of ${date.toLocaleDateString()}`;
        }),
        datasets
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        plugins: {
          tooltip: {
            callbacks: {
              label: context => {
                let label = context.dataset.label || '';
                if (label) label += ': $';
                label += formatCurrency(context.raw);
                return label;
              }
            }
          },
          legend: { position: 'top' }
        },
        scales: {
          x: { stacked: true },
          y: {
            stacked: true,
            ticks: {
              callback: value => `$${formatCurrency(value)}`
            }
          }
        }
      }
    });
  };

  const renderTotalChart = data => {
    totalElement.textContent = `Total $${formatCurrency(data.reduce((sum, item) => sum + parseFloat(item.spend), 0))}`;

    const groups = [...new Set(data.map(item => item.group))];

    const groupTotals = {};
    data.forEach(item => {
      if (!groupTotals[item.group]) {
        groupTotals[item.group] = 0;
      }
      groupTotals[item.group] += parseFloat(item.spend);
    });

    const chartData = groups.map(group => groupTotals[group] || 0);
    const backgroundColors = groups.map(group => groupColors[group]);

    if (totalChart) {
      totalChart.destroy();
    }

    const totalChartCtx = document.getElementById('totalSpendChart').getContext('2d');
    totalChart = new Chart(totalChartCtx, {
      type: 'doughnut',
      data: {
        labels: groups,
        datasets: [{
          data: chartData,
          backgroundColor: backgroundColors,
          borderWidth: 2,
          borderColor: 'white'
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 0 },
        plugins: {
          tooltip: {
            callbacks: {
              label: context => {
                const label = context.label || '';
                const value = `$${formatCurrency(context.raw)}`;
                const total = context.chart.data.datasets[0].data.reduce((sum, val) => sum + val, 0);
                const percentage = Math.round((context.raw / total) * 100);
                return `${label}: ${value} (${percentage}%)`;
              }
            }
          },
          legend: { position: 'top' }
        }
      }
    });
  };

  const renderUsersTable = data => {
    const tableBody = document.querySelector('#usersTable tbody');
    tableBody.innerHTML = '';

    const userSpends = {};

    data.forEach(item => {
      if (!userSpends[item.user]) {
        userSpends[item.user] = {
          user: item.user,
          group: item.group,
          total: 0
        };
      }
      userSpends[item.user].total += parseFloat(item.spend);
    });

    const sortedUsers = Object.values(userSpends)
      .sort((a, b) => b.total - a.total);

    const fragment = document.createDocumentFragment();

    sortedUsers.forEach(user => {
      const row = document.createElement('tr');

      const userCell = document.createElement('td');
      userCell.textContent = user.user;
      row.appendChild(userCell);

      const groupCell = document.createElement('td');
      groupCell.textContent = user.group;
      row.appendChild(groupCell);

      const totalCell = document.createElement('td');
      totalCell.textContent = `$${formatCurrency(user.total)}`;
      row.appendChild(totalCell);

      fragment.appendChild(row);
    });

    tableBody.appendChild(fragment);
  };

  init();
});