'use client';

import React, { useState, useMemo } from 'react';
import { IAnalyticsDailyTrend } from '@enterprise-ai/shared-types';
import { Card, CardHeader, CardTitle, CardDescription, CardContent, Badge } from '@/components/ui';
import { BarChart3, Table as TableIcon, Activity, Zap, Clock, MessageSquare } from 'lucide-react';
import { cn } from '@/lib/utils';

export type TrendMetricType = 'queries' | 'tokens' | 'latency' | 'conversations';

export interface TrendChartProps {
  trends: IAnalyticsDailyTrend[];
  isLoading?: boolean;
}

export function TrendChart({ trends, isLoading = false }: TrendChartProps) {
  const [activeMetric, setActiveMetric] = useState<TrendMetricType>('queries');
  const [viewMode, setViewMode] = useState<'chart' | 'table'>('chart');
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const safeTrends = useMemo(() => (Array.isArray(trends) ? trends : []), [trends]);

  const metricsConfig = useMemo(() => {
    return {
      queries: {
        label: 'Daily Query Volume',
        description: 'Total queries processed, distinguishing successful answers from errors',
        unit: 'queries',
        color: '#2563eb', // brand-primary
        icon: Activity,
      },
      tokens: {
        label: 'Token Consumption',
        description: 'Combined prompt and completion tokens processed by LLM',
        unit: 'tokens',
        color: '#0284c7', // status-info
        icon: Zap,
      },
      latency: {
        label: 'Average Latency',
        description: 'Mean end-to-end response time across all queries',
        unit: 'ms',
        color: '#d97706', // status-warning
        icon: Clock,
      },
      conversations: {
        label: 'Active Conversations',
        description: 'Distinct conversation threads active on each day',
        unit: 'threads',
        color: '#059669', // status-success
        icon: MessageSquare,
      },
    };
  }, []);

  const { maxVal, totalMetricValue, avgMetricValue } = useMemo(() => {
    if (safeTrends.length === 0) {
      return { maxVal: 1, totalMetricValue: 0, avgMetricValue: 0 };
    }

    let max = 0;
    let sum = 0;

    safeTrends.forEach((t) => {
      let val = 0;
      if (activeMetric === 'queries') val = t.queryCount;
      else if (activeMetric === 'tokens') val = t.totalTokens;
      else if (activeMetric === 'latency') val = t.avgLatencyMs;
      else if (activeMetric === 'conversations') val = t.activeConversations;

      if (val > max) max = val;
      sum += val;
    });

    const safeMax = max > 0 ? max : 1;
    const avg = safeTrends.length > 0 ? Math.round(sum / safeTrends.length) : 0;
    return { maxVal: safeMax, totalMetricValue: sum, avgMetricValue: avg };
  }, [safeTrends, activeMetric]);

  const chartHeight = 220;
  const chartWidth = 720;
  const paddingBottom = 30;
  const paddingTop = 20;
  const effectiveHeight = chartHeight - paddingTop - paddingBottom;

  if (isLoading) {
    return (
      <Card variant="default" className="p-6">
        <div className="space-y-4 animate-pulse">
          <div className="h-6 w-48 bg-surface-elevated rounded" />
          <div className="h-4 w-72 bg-surface-elevated rounded" />
          <div className="h-56 bg-surface-elevated rounded-xl" />
        </div>
      </Card>
    );
  }

  return (
    <Card variant="default" className="p-6">
      <CardHeader className="p-0 pb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <CardTitle>{metricsConfig[activeMetric].label}</CardTitle>
            <Badge variant="brand" className="text-xs">
              {safeTrends.length} {safeTrends.length === 1 ? 'day' : 'days'}
            </Badge>
          </div>
          <CardDescription className="mt-1">
            {metricsConfig[activeMetric].description}
          </CardDescription>
        </div>

        {/* View mode and metric toggles */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-lg border border-border-subtle bg-surface p-0.5 text-xs">
            {(
              [
                { id: 'queries', label: 'Queries' },
                { id: 'tokens', label: 'Tokens' },
                { id: 'latency', label: 'Latency' },
                { id: 'conversations', label: 'Conversations' },
              ] as const
            ).map((m) => (
              <button
                key={m.id}
                type="button"
                onClick={() => setActiveMetric(m.id)}
                className={cn(
                  'px-2.5 py-1 rounded-md font-medium transition-colors',
                  activeMetric === m.id
                    ? 'bg-brand-primary text-white shadow-sm'
                    : 'text-text-secondary hover:text-text-primary'
                )}
              >
                {m.label}
              </button>
            ))}
          </div>

          <div className="inline-flex rounded-lg border border-border-subtle bg-surface p-0.5 text-xs">
            <button
              type="button"
              onClick={() => setViewMode('chart')}
              className={cn(
                'p-1.5 rounded-md transition-colors',
                viewMode === 'chart'
                  ? 'bg-brand-primary text-white'
                  : 'text-text-secondary hover:text-text-primary'
              )}
              title="Chart View"
              aria-label="Chart View"
            >
              <BarChart3 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={cn(
                'p-1.5 rounded-md transition-colors',
                viewMode === 'table'
                  ? 'bg-brand-primary text-white'
                  : 'text-text-secondary hover:text-text-primary'
              )}
              title="Table View"
              aria-label="Table View"
            >
              <TableIcon className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {safeTrends.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center border border-dashed border-border-subtle rounded-xl">
            <Activity className="w-8 h-8 text-text-muted mb-2 opacity-50" />
            <p className="text-sm font-medium text-text-secondary">No trend data available</p>
            <p className="text-xs text-text-muted mt-1">
              Select a different date range or verify backend logging activity.
            </p>
          </div>
        ) : viewMode === 'chart' ? (
          <div>
            {/* Summary statistics row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 py-3 px-4 mb-4 bg-surface-elevated/40 rounded-xl border border-border-subtle/50 text-xs">
              <div>
                <span className="text-text-muted">Total in Window:</span>
                <p className="font-semibold text-text-primary mt-0.5">
                  {totalMetricValue.toLocaleString()}{' '}
                  <span className="font-normal text-text-secondary">
                    {metricsConfig[activeMetric].unit}
                  </span>
                </p>
              </div>
              <div>
                <span className="text-text-muted">Daily Average:</span>
                <p className="font-semibold text-text-primary mt-0.5">
                  {avgMetricValue.toLocaleString()}{' '}
                  <span className="font-normal text-text-secondary">
                    {metricsConfig[activeMetric].unit}/day
                  </span>
                </p>
              </div>
              <div>
                <span className="text-text-muted">Peak Day:</span>
                <p className="font-semibold text-text-primary mt-0.5">
                  {maxVal.toLocaleString()}{' '}
                  <span className="font-normal text-text-secondary">
                    {metricsConfig[activeMetric].unit}
                  </span>
                </p>
              </div>
              <div>
                <span className="text-text-muted">Data Range:</span>
                <p className="font-semibold text-text-primary mt-0.5">
                  {safeTrends[0]?.date} → {safeTrends[safeTrends.length - 1]?.date}
                </p>
              </div>
            </div>

            {/* Responsive Accessible SVG Chart */}
            <div className="relative w-full overflow-x-auto pb-2">
              <svg
                viewBox={`0 0 ${chartWidth} ${chartHeight}`}
                className="w-full h-auto min-w-[500px] overflow-visible"
                role="img"
                aria-label={`${metricsConfig[activeMetric].label} chart spanning ${safeTrends.length} days`}
              >
                {/* Horizontal reference grid lines */}
                {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
                  const y = paddingTop + effectiveHeight * (1 - pct);
                  const refVal = Math.round(maxVal * pct);
                  return (
                    <g key={pct}>
                      <line
                        x1="45"
                        y1={y}
                        x2={chartWidth - 10}
                        y2={y}
                        stroke="currentColor"
                        strokeDasharray="3 3"
                        className="text-border-subtle/60"
                        strokeWidth="1"
                      />
                      <text
                        x="38"
                        y={y + 3}
                        textAnchor="end"
                        className="fill-text-muted text-[10px] font-mono"
                      >
                        {refVal >= 1000 ? `${(refVal / 1000).toFixed(1)}k` : refVal}
                      </text>
                    </g>
                  );
                })}

                {/* Bars per day */}
                {safeTrends.map((item, idx) => {
                  const slotWidth = (chartWidth - 55) / safeTrends.length;
                  const barWidth = Math.max(Math.min(slotWidth * 0.7, 32), 6);
                  const x = 50 + idx * slotWidth + (slotWidth - barWidth) / 2;

                  let val = 0;
                  if (activeMetric === 'queries') val = item.queryCount;
                  else if (activeMetric === 'tokens') val = item.totalTokens;
                  else if (activeMetric === 'latency') val = item.avgLatencyMs;
                  else if (activeMetric === 'conversations') val = item.activeConversations;

                  const barHeight = maxVal > 0 ? (val / maxVal) * effectiveHeight : 0;
                  const y = paddingTop + effectiveHeight - barHeight;

                  const isHovered = hoveredIndex === idx;

                  // Label display interval for x-axis
                  const showLabel =
                    safeTrends.length <= 14 ||
                    idx === 0 ||
                    idx === safeTrends.length - 1 ||
                    idx % Math.ceil(safeTrends.length / 7) === 0;

                  return (
                    <g
                      key={item.date}
                      onMouseEnter={() => setHoveredIndex(idx)}
                      onMouseLeave={() => setHoveredIndex(null)}
                      className="cursor-pointer transition-opacity"
                    >
                      {/* Transparent hit area for hover */}
                      <rect
                        x={50 + idx * slotWidth}
                        y={paddingTop}
                        width={slotWidth}
                        height={effectiveHeight}
                        fill="transparent"
                      />

                      {/* Bar rectangle */}
                      {activeMetric === 'queries' && item.errorCount > 0 ? (
                        <>
                          {/* Success portion */}
                          <rect
                            x={x}
                            y={y + (item.errorCount / (val || 1)) * barHeight}
                            width={barWidth}
                            height={Math.max(
                              barHeight - (item.errorCount / (val || 1)) * barHeight,
                              0
                            )}
                            rx="3"
                            className={cn(
                              'fill-brand-primary transition-all duration-150',
                              isHovered ? 'brightness-110' : 'opacity-90'
                            )}
                          />
                          {/* Error portion */}
                          <rect
                            x={x}
                            y={y}
                            width={barWidth}
                            height={Math.max((item.errorCount / (val || 1)) * barHeight, 2)}
                            rx="3"
                            className={cn(
                              'fill-status-error transition-all duration-150',
                              isHovered ? 'brightness-110' : 'opacity-90'
                            )}
                          />
                        </>
                      ) : (
                        <rect
                          x={x}
                          y={Math.max(y, paddingTop)}
                          width={barWidth}
                          height={Math.max(barHeight, 2)}
                          rx="3"
                          fill={metricsConfig[activeMetric].color}
                          className={cn(
                            'transition-all duration-150',
                            isHovered ? 'brightness-110 filter drop-shadow-sm' : 'opacity-85'
                          )}
                        />
                      )}

                      {/* X-axis Date label */}
                      {showLabel && (
                        <text
                          x={x + barWidth / 2}
                          y={chartHeight - 8}
                          textAnchor="middle"
                          className="fill-text-muted text-[10px]"
                        >
                          {item.date.slice(5)} {/* MM-DD */}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>

              {/* Hover Tooltip Overlay */}
              {hoveredIndex !== null && safeTrends[hoveredIndex] && (
                <div
                  className="absolute z-10 p-2.5 rounded-lg bg-surface border border-border-strong shadow-lg text-xs pointer-events-none transform -translate-x-1/2 transition-transform"
                  style={{
                    left: `${
                      50 +
                      (hoveredIndex + 0.5) * ((chartWidth - 55) / safeTrends.length) * (100 / chartWidth)
                    }%`,
                    top: '10px',
                  }}
                >
                  <p className="font-semibold text-text-primary pb-1 border-b border-border-subtle">
                    {safeTrends[hoveredIndex].date}
                  </p>
                  <div className="mt-1 space-y-0.5">
                    <p className="text-text-secondary flex justify-between gap-3">
                      <span>Total Queries:</span>
                      <strong className="text-text-primary">
                        {safeTrends[hoveredIndex].queryCount}
                      </strong>
                    </p>
                    <p className="text-status-success flex justify-between gap-3">
                      <span>Success:</span>
                      <strong>{safeTrends[hoveredIndex].successCount}</strong>
                    </p>
                    {safeTrends[hoveredIndex].errorCount > 0 && (
                      <p className="text-status-error flex justify-between gap-3">
                        <span>Errors:</span>
                        <strong>{safeTrends[hoveredIndex].errorCount}</strong>
                      </p>
                    )}
                    <p className="text-text-secondary flex justify-between gap-3">
                      <span>Tokens:</span>
                      <strong className="text-text-primary">
                        {safeTrends[hoveredIndex].totalTokens.toLocaleString()}
                      </strong>
                    </p>
                    <p className="text-text-secondary flex justify-between gap-3">
                      <span>Avg Latency:</span>
                      <strong className="text-text-primary">
                        {safeTrends[hoveredIndex].avgLatencyMs} ms
                      </strong>
                    </p>
                    <p className="text-text-secondary flex justify-between gap-3">
                      <span>Active Convs:</span>
                      <strong className="text-text-primary">
                        {safeTrends[hoveredIndex].activeConversations}
                      </strong>
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          /* Accessible Table Fallback */
          <div className="overflow-x-auto rounded-lg border border-border-subtle">
            <table className="w-full text-left text-xs" role="table">
              <thead className="bg-surface-elevated/80 border-b border-border-subtle text-text-muted font-semibold">
                <tr>
                  <th scope="col" className="p-3">Date</th>
                  <th scope="col" className="p-3 text-right">Queries</th>
                  <th scope="col" className="p-3 text-right">Success</th>
                  <th scope="col" className="p-3 text-right">Errors</th>
                  <th scope="col" className="p-3 text-right">Tokens</th>
                  <th scope="col" className="p-3 text-right">Avg Latency</th>
                  <th scope="col" className="p-3 text-right">Active Convs</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-subtle/50 text-text-secondary">
                {safeTrends.map((item) => (
                  <tr key={item.date} className="hover:bg-surface-elevated/30">
                    <td className="p-3 font-medium text-text-primary">{item.date}</td>
                    <td className="p-3 text-right font-mono">{item.queryCount}</td>
                    <td className="p-3 text-right font-mono text-status-success">{item.successCount}</td>
                    <td className="p-3 text-right font-mono text-status-error">
                      {item.errorCount > 0 ? item.errorCount : '0'}
                    </td>
                    <td className="p-3 text-right font-mono">{item.totalTokens.toLocaleString()}</td>
                    <td className="p-3 text-right font-mono">{item.avgLatencyMs} ms</td>
                    <td className="p-3 text-right font-mono">{item.activeConversations}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
