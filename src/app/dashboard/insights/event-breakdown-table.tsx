"use client";

import { useState, useMemo } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export interface EventBreakdownRow {
  id: string;
  event_name: string;
  event_date: string;
  event_type: string | null;
  city: string | null;
  net_sales: number;
  forecast_sales: number | null;
  accuracy: number | null;
  fee_type: string | null;
  fee_amount: number;
  event_weather: string | null;
}

type SortKey =
  | "event_name"
  | "event_date"
  | "event_type"
  | "city"
  | "net_sales"
  | "forecast_sales"
  | "accuracy"
  | "fee_type"
  | "fee_amount"
  | "event_weather";

function formatCurrency(value: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getAccuracyColor(accuracy: number): string {
  if (accuracy >= 80) return "text-green-600";
  if (accuracy >= 60) return "text-yellow-600";
  return "text-red-600";
}

function getWeatherBadgeVariant(
  weather: string
): "default" | "secondary" | "destructive" {
  if (weather === "Clear" || weather === "Overcast") return "default";
  if (weather === "Hot" || weather === "Cold") return "secondary";
  return "destructive";
}

function SortHeader({
  label,
  column,
  className,
  sortKey,
  sortAsc,
  onSort,
}: {
  label: string;
  column: SortKey;
  className?: string;
  sortKey: SortKey;
  sortAsc: boolean;
  onSort: (key: SortKey) => void;
}) {
  const isActive = sortKey === column;
  return (
    <TableHead
      className={`cursor-pointer select-none hover:bg-muted/50 ${className ?? ""}`}
      onClick={() => onSort(column)}
    >
      {label}
      {isActive ? (sortAsc ? " \u25B2" : " \u25BC") : ""}
    </TableHead>
  );
}

export function EventBreakdownTable({ rows }: { rows: EventBreakdownRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("event_date");
  const [sortAsc, setSortAsc] = useState(false);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");

  const eventTypes = useMemo(() => {
    const types = new Set<string>();
    for (const r of rows) {
      if (r.event_type) types.add(r.event_type);
    }
    return Array.from(types).sort();
  }, [rows]);

  const filteredAndSorted = useMemo(() => {
    let result = [...rows];

    if (search) {
      const q = search.toLowerCase();
      result = result.filter(
        (r) =>
          r.event_name.toLowerCase().includes(q) ||
          (r.city && r.city.toLowerCase().includes(q))
      );
    }

    if (typeFilter !== "all") {
      result = result.filter((r) => r.event_type === typeFilter);
    }

    result.sort((a, b) => {
      let cmp = 0;
      const av = a[sortKey];
      const bv = b[sortKey];

      if (av === null && bv === null) cmp = 0;
      else if (av === null) cmp = -1;
      else if (bv === null) cmp = 1;
      else if (typeof av === "string" && typeof bv === "string")
        cmp = av.localeCompare(bv);
      else if (typeof av === "number" && typeof bv === "number")
        cmp = av - bv;

      return sortAsc ? cmp : -cmp;
    });

    return result;
  }, [rows, search, typeFilter, sortKey, sortAsc]);

  function handleSort(key: SortKey) {
    if (sortKey === key) {
      setSortAsc(!sortAsc);
    } else {
      setSortKey(key);
      setSortAsc(false);
    }
  }

  if (rows.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-muted-foreground">
        No completed events with sales data yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row gap-3">
        <Input
          placeholder="Search by event name or city..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="sm:max-w-xs"
        />
        <Select value={typeFilter} onValueChange={(val) => setTypeFilter(val ?? "all")}>
          <SelectTrigger className="sm:max-w-[200px]">
            <SelectValue placeholder="All event types" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All event types</SelectItem>
            {eventTypes.map((t) => (
              <SelectItem key={t} value={t}>
                {t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="text-sm text-muted-foreground self-center">
          {filteredAndSorted.length} event{filteredAndSorted.length !== 1 ? "s" : ""}
        </span>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <SortHeader label="Event" column="event_name" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
              <SortHeader label="Date" column="event_date" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
              <SortHeader label="Type" column="event_type" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
              <SortHeader label="City" column="city" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
              <SortHeader
                label="Net Sales"
                column="net_sales"
                className="text-right"
                sortKey={sortKey}
                sortAsc={sortAsc}
                onSort={handleSort}
              />
              <SortHeader
                label="Forecast"
                column="forecast_sales"
                className="text-right"
                sortKey={sortKey}
                sortAsc={sortAsc}
                onSort={handleSort}
              />
              <SortHeader
                label="Accuracy"
                column="accuracy"
                className="text-right"
                sortKey={sortKey}
                sortAsc={sortAsc}
                onSort={handleSort}
              />
              <SortHeader label="Fee Type" column="fee_type" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
              <SortHeader
                label="Fee Amount"
                column="fee_amount"
                className="text-right"
                sortKey={sortKey}
                sortAsc={sortAsc}
                onSort={handleSort}
              />
              <SortHeader label="Weather" column="event_weather" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort} />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredAndSorted.map((row) => (
              <TableRow key={row.id}>
                <TableCell className="font-medium whitespace-nowrap">
                  {row.event_name}
                </TableCell>
                <TableCell className="whitespace-nowrap">
                  {formatDate(row.event_date)}
                </TableCell>
                <TableCell>
                  {row.event_type ? (
                    <Badge variant="secondary">{row.event_type}</Badge>
                  ) : (
                    <span className="text-muted-foreground">--</span>
                  )}
                </TableCell>
                <TableCell>{row.city ?? "--"}</TableCell>
                <TableCell className="text-right font-medium">
                  {formatCurrency(row.net_sales)}
                </TableCell>
                <TableCell className="text-right">
                  {row.forecast_sales !== null
                    ? formatCurrency(row.forecast_sales)
                    : "--"}
                </TableCell>
                <TableCell className="text-right">
                  {row.accuracy !== null ? (
                    <span className={getAccuracyColor(row.accuracy)}>
                      {row.accuracy.toFixed(0)}%
                    </span>
                  ) : (
                    "--"
                  )}
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className="whitespace-nowrap">
                    {(row.fee_type ?? "—").replace("_", " ")}
                  </Badge>
                </TableCell>
                <TableCell className="text-right">
                  {row.fee_amount > 0
                    ? formatCurrency(row.fee_amount)
                    : "--"}
                </TableCell>
                <TableCell>
                  {row.event_weather ? (
                    <Badge variant={getWeatherBadgeVariant(row.event_weather)}>
                      {row.event_weather}
                    </Badge>
                  ) : (
                    "--"
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}
