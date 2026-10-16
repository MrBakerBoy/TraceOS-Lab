// TraceOS kt-dynamic ECharts theme
// Dark theme optimized for the TraceOS Kernel Terminal design system
const ktDynamicTheme = {
  color: [
    '#3b82f6', '#22c55e', '#f97316', '#ef4444', '#a855f7',
    '#06b6d4', '#eab308', '#ec4899', '#6366f1', '#14b8a6',
  ],
  backgroundColor: 'transparent',
  textStyle: {},
  title: {
    textStyle: { color: '#e2e8f0' },
    subtextStyle: { color: '#C9D2E0' },
  },
  line: {
    itemStyle: { borderWidth: 2 },
    lineStyle: { width: 2 },
    symbolSize: 6,
    symbol: 'circle',
    smooth: true,
  },
  radar: {
    itemStyle: { borderWidth: 2 },
    lineStyle: { width: 2 },
    symbolSize: 6,
    symbol: 'circle',
    smooth: true,
  },
  bar: {
    itemStyle: {
      barBorderWidth: 0,
      barBorderColor: '#1e293b',
    },
  },
  pie: {
    itemStyle: {
      borderWidth: 0,
      borderColor: '#1e293b',
    },
  },
  scatter: {
    itemStyle: {
      borderWidth: 0,
      borderColor: '#1e293b',
    },
  },
  boxplot: {
    itemStyle: {
      borderWidth: 0,
      borderColor: '#1e293b',
    },
  },
  parallel: {
    itemStyle: {
      borderWidth: 0,
      borderColor: '#1e293b',
    },
  },
  sankey: {
    itemStyle: {
      borderWidth: 0,
      borderColor: '#1e293b',
    },
  },
  funnel: {
    itemStyle: {
      borderWidth: 0,
      borderColor: '#1e293b',
    },
  },
  gauge: {
    itemStyle: {
      borderWidth: 0,
      borderColor: '#1e293b',
    },
  },
  candlestick: {
    itemStyle: {
      color: '#ef4444',
      color0: '#22c55e',
      borderColor: '#ef4444',
      borderColor0: '#22c55e',
      borderWidth: 1,
    },
  },
  graph: {
    itemStyle: { borderWidth: 0, borderColor: '#1e293b' },
    lineStyle: { width: 1, color: '#475569' },
    symbolSize: 6,
    symbol: 'circle',
    smooth: false,
    color: ['#3b82f6', '#22c55e', '#f97316', '#ef4444'],
    label: { color: '#C9D2E0' },
  },
  map: {
    itemStyle: {
      areaColor: '#1e293b',
      borderColor: '#334155',
      borderWidth: 0.5,
    },
    label: { color: '#C9D2E0' },
    emphasis: {
      itemStyle: { areaColor: '#3b82f640' },
      label: { color: '#e2e8f0' },
    },
  },
  geo: {
    itemStyle: {
      areaColor: '#1e293b',
      borderColor: '#334155',
      borderWidth: 0.5,
    },
    label: { color: '#C9D2E0' },
    emphasis: {
      itemStyle: { areaColor: '#3b82f640' },
      label: { color: '#e2e8f0' },
    },
  },
  categoryAxis: {
    axisLine: { show: true, lineStyle: { color: '#334155' } },
    axisTick: { show: false },
    axisLabel: { color: '#C9D2E0' },
    splitLine: { show: false, lineStyle: { color: ['#1e293b'] } },
    splitArea: { show: false },
  },
  valueAxis: {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: '#C9D2E0' },
    splitLine: { show: true, lineStyle: { color: ['#1e293b', '#1e293b'], type: 'dashed' } },
    splitArea: { show: false },
  },
  logAxis: {
    axisLine: { show: false },
    axisTick: { show: false },
    axisLabel: { color: '#C9D2E0' },
    splitLine: { show: true, lineStyle: { color: ['#1e293b'], type: 'dashed' } },
    splitArea: { show: false },
  },
  timeAxis: {
    axisLine: { show: true, lineStyle: { color: '#334155' } },
    axisTick: { show: false },
    axisLabel: { color: '#C9D2E0' },
    splitLine: { show: false },
    splitArea: { show: false },
  },
  toolbox: {
    iconStyle: {
      borderColor: '#C9D2E0',
    },
    emphasis: {
      iconStyle: {
        borderColor: '#e2e8f0',
      },
    },
  },
  legend: {
    textStyle: { color: '#C9D2E0' },
  },
  tooltip: {
    axisPointer: {
      lineStyle: { color: '#475569', width: 1 },
      crossStyle: { color: '#475569', width: 1 },
    },
  },
  timeline: {
    lineStyle: { color: '#334155' },
    itemStyle: { color: '#3b82f6' },
    controlStyle: { color: '#C9D2E0', borderColor: '#475569' },
  },
  visualMap: {
    color: ['#1e40af', '#3b82f6', '#60a5fa'],
  },
  dataZoom: {
    backgroundColor: 'rgba(30,41,59,0.6)',
    dataBackground: {
      areaStyle: { color: '#334155' },
      lineStyle: { color: '#475569' },
    },
    selectedDataBackground: {
      areaStyle: { color: '#3b82f6' },
      lineStyle: { color: '#3b82f6' },
    },
    textStyle: { color: '#C9D2E0' },
    handleStyle: { color: '#9BA6B8' },
  },
  markPoint: {
    label: { color: '#e2e8f0' },
    emphasis: {
      label: { color: '#e2e8f0' },
    },
  },
};

export default ktDynamicTheme;
