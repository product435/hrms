import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TrendPoint } from "@/types";

const axis = {
  fontSize: 12,
  tick: { fill: "var(--color-muted-foreground)" },
};

export function AttendanceAreaChart({ data }: { data: TrendPoint[] }) {
  const sortedData = [...data].sort((a, b) => {
    const first = Date.parse(a.label);
    const second = Date.parse(b.label);
    return Number.isNaN(first) || Number.isNaN(second)
      ? a.label.localeCompare(b.label)
      : first - second;
  });

  return (
    <ResponsiveContainer width="100%" height={260}>
      <AreaChart data={sortedData} margin={{ left: 0, right: 16, top: 12, bottom: 8 }}>
        <defs>
          <linearGradient id="presentFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.45} />
            <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="wfhFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-chart-2)" stopOpacity={0.45} />
            <stop offset="100%" stopColor="var(--color-chart-2)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="4 4" stroke="var(--color-border)" vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={{ stroke: "var(--color-border)" }}
          tickMargin={8}
          minTickGap={24}
          {...axis}
        />
        <YAxis tickLine={false} axisLine={{ stroke: "var(--color-border)" }} width={32} {...axis} />
        <Tooltip
          contentStyle={{
            background: "var(--color-popover)",
            border: "1px solid var(--color-border)",
            borderRadius: 12,
            color: "var(--color-popover-foreground)",
            fontSize: 12,
          }}
          labelStyle={{ color: "var(--color-popover-foreground)", fontWeight: 600 }}
          itemStyle={{ color: "var(--color-popover-foreground)" }}
          cursor={{ stroke: "var(--color-primary)", strokeOpacity: 0.18 }}
        />
        <Legend
          wrapperStyle={{ color: "var(--color-muted-foreground)", fontSize: 12, paddingTop: 8 }}
        />
        <Area
          type="monotone"
          dataKey="present"
          stroke="var(--color-chart-1)"
          strokeWidth={2}
          fill="url(#presentFill)"
          name="Present"
        />
        <Area
          type="monotone"
          dataKey="wfh"
          stroke="var(--color-chart-2)"
          strokeWidth={2}
          fill="url(#wfhFill)"
          name="WFH"
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
