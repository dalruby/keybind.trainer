// ECharts wrapper and chart theming read from CSS tokens, so light and dark
// mode each use their own (validated) steps.

import { useEffect, useRef, useState } from 'react';
import * as echarts from 'echarts/core';
import { BarChart, LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';

echarts.use([BarChart, LineChart, GridComponent, TooltipComponent, SVGRenderer]);

export interface ChartTheme {
  series: string;
  grid: string;
  axis: string;
  muted: string;
  text: string;
  surface: string;
  seq: string[];
  dark: boolean;
}

function readTheme(): ChartTheme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    series: v('--chart-series'),
    grid: v('--chart-grid'),
    axis: v('--chart-axis'),
    muted: v('--chart-ink-muted'),
    text: v('--text'),
    surface: v('--surface'),
    seq: [1, 2, 3, 4, 5].map((i) => v(`--seq-${i}`)),
    dark: window.matchMedia('(prefers-color-scheme: dark)').matches,
  };
}

/** Current chart colors; updates when the system switches light/dark. */
export function useChartTheme(): ChartTheme {
  const [theme, setTheme] = useState(readTheme);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const on = () => setTheme(readTheme());
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return theme;
}

/** Shared axis/tooltip styling: hairline solid grid, muted labels. */
export function baseOption(t: ChartTheme): EChartsCoreOption {
  return {
    animation: false,
    textStyle: { fontFamily: 'system-ui, -apple-system, "Segoe UI", sans-serif', color: t.muted },
    tooltip: {
      backgroundColor: t.surface,
      borderColor: t.axis,
      borderWidth: 1,
      textStyle: { color: t.text, fontSize: 13 },
      extraCssText: 'box-shadow: 0 4px 14px rgba(0,0,0,0.12); border-radius: 8px;',
    },
  };
}

export function axisStyle(t: ChartTheme) {
  return {
    axisLine: { lineStyle: { color: t.axis, width: 1 } },
    axisTick: { show: false },
    axisLabel: { color: t.muted, fontSize: 12 },
    splitLine: { lineStyle: { color: t.grid, width: 1, type: 'solid' as const } },
  };
}

/** Pick dark or light text for a label on a filled cell. */
export function inkOn(hex: string): string {
  const n = parseInt(hex.replace('#', ''), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.35 ? '#0b0b0b' : '#ffffff';
}

export function EChart({
  option,
  height,
  label,
  onClick,
}: {
  option: EChartsCoreOption;
  height: number;
  label: string;
  /** Called with the clicked data item's `id` (set `id` on data items). */
  onClick?: (id: string) => void;
}) {
  const onClickRef = useRef(onClick);
  onClickRef.current = onClick;
  const ref = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const c = echarts.init(ref.current, undefined, { renderer: 'svg' });
    chart.current = c;
    c.on('click', (p) => {
      const id = (p.data as { id?: string } | undefined)?.id;
      if (id) onClickRef.current?.(id);
    });
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(ref.current);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
    };
  }, []);

  useEffect(() => {
    chart.current?.setOption(option, true);
  }, [option]);

  return <div ref={ref} className="chart" style={{ height }} role="img" aria-label={label} />;
}
