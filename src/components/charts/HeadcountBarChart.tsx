import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { HeadcountPoint } from "@/types";

export function HeadcountBarChart({ data }: { data: HeadcountPoint[] }) {
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ left: 0, right: 16, top: 12, bottom: 8 }} barGap={4}>
        <CartesianGrid strokeDasharray="4 4" stroke="var(--color-border)" vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={{ stroke: "var(--color-border)" }}
          tick={{ fill: "var(--color-muted-foreground)" }}
          tickMargin={8}
          minTickGap={24}
          fontSize={12}
        />
        <YAxis
          tickLine={false}
          axisLine={{ stroke: "var(--color-border)" }}
          tick={{ fill: "var(--color-muted-foreground)" }}
          width={32}
          fontSize={12}
        />
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
          cursor={{ fill: "var(--color-primary)", fillOpacity: 0.08 }}
        />
        <Legend wrapperStyle={{ color: "var(--color-muted-foreground)", fontSize: 12 }} />
        <Bar dataKey="joined" name="Joined" fill="var(--color-chart-2)" radius={[6, 6, 0, 0]} />
        <Bar dataKey="exited" name="Exited" fill="var(--color-chart-5)" radius={[6, 6, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
