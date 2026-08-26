import { Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";

const COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-primary)",
];

export function DistributionDonut({
  data,
  height = 260,
}: {
  data: { name: string; value: number }[];
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <PieChart>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          innerRadius="55%"
          outerRadius="82%"
          paddingAngle={3}
          stroke="var(--color-card)"
          strokeWidth={2}
        >
          {data.map((entry, index) => (
            <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
          ))}
        </Pie>
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
        <Legend
          wrapperStyle={{ color: "var(--color-muted-foreground)", fontSize: 12, paddingTop: 8 }}
          formatter={(name: string) => {
            const entry = data.find((d) => d.name === name);
            return `${name} (${entry?.value ?? 0})`;
          }}
        />
      </PieChart>
    </ResponsiveContainer>
  );
}
