"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { BarChart3, ChevronUp, ChevronDown, ChevronsUpDown, Info, RefreshCw, ExternalLink, Search, X } from "lucide-react";
import Link from "next/link";
import { Input } from "@/components/ui/input";
import { CONFIDENCE_COLORS, TREND_COLORS } from "@/lib/constants";
import type { EventPerformance } from "@/lib/database.types";

function formatCurrency(val: number | null): string {
  if (val === null || val === undefined) return "—";
  return `$${val.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

type SortField =
  | "event_name"
  | "times_booked"
  | "avg_sales"
  | "median_sales"
  | "consistency_score"
  | "confidence"
  | "trend"
  | "yoy_growth";

type SortDirection = "asc" | "desc";

interface PerformanceClientProps {
  performances: EventPerformance[];
}

const CONFIDENCE_ORDER: Record<string, number> = { HIGH: 1, MEDIUM: 2, LOW: 3 };
const TREND_ORDER: Record<string, number> = { Growing: 1, Stable: 2, "New/Insufficient Data": 3, Declining: 4 };

/** Returns the appropriate tooltip text for a confidence badge. */
function confidenceTooltip(perf: EventPerformance): string {
  const { confidence, times_booked } = perf;
  if (confidence === "HIGH") {
    return "Strong prediction — consistent data from multiple events.";
  }
  if (confidence === "MEDIUM") {
    return "Reasonable prediction — some variance in past results.";
  }
  // LOW
  if (times_booked !== null && times_booked >= 8) {
    return "High variance — results vary significantly between visits. Check for disrupted events or unusual outliers.";
  }
  return "Limited prediction — high variance or few comparable events.";
}

export function PerformanceClient({ performances }: PerformanceClientProps) {
  const [sortField, setSortField] = useState<SortField>("avg_sales");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [recalculating, setRecalculating] = useState(false);
  const [recalcMessage, setRecalcMessage] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  async function handleRecalculate() {
    setRecalculating(true);
    setRecalcMessage(null);
    try {
      const res = await fetch("/api/recalculate", { method: "POST" });
      if (res.ok) {
        const data = await res.json() as { performanceUpdated?: number };
        setRecalcMessage(
          `Recalculated ${data.performanceUpdated ?? 0} event(s). Refresh the page to see updated data.`
        );
      } else {
        setRecalcMessage("Recalculation failed. Please try again.");
      }
    } catch {
      setRecalcMessage("Recalculation failed. Please try again.");
    } finally {
      setRecalculating(false);
    }
  }

  function handleSort(field: SortField) {
    if (sortField === field) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDirection("desc");
    }
  }

  function SortIcon({ field }: { field: SortField }) {
    if (sortField !== field) {
      return <ChevronsUpDown className="h-3 w-3 ml-1 opacity-40 inline" />;
    }
    return sortDirection === "asc" ? (
      <ChevronUp className="h-3 w-3 ml-1 inline" />
    ) : (
      <ChevronDown className="h-3 w-3 ml-1 inline" />
    );
  }

  const filtered = search.trim()
    ? performances.filter((p) =>
        p.event_name.toLowerCase().includes(search.trim().toLowerCase())
      )
    : performances;

  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDirection === "asc" ? 1 : -1;
    switch (sortField) {
      case "event_name":
        return a.event_name.localeCompare(b.event_name) * dir;
      case "times_booked":
        return ((a.times_booked ?? 0) - (b.times_booked ?? 0)) * dir;
      case "avg_sales":
        return ((a.avg_sales ?? 0) - (b.avg_sales ?? 0)) * dir;
      case "median_sales":
        return ((a.median_sales ?? 0) - (b.median_sales ?? 0)) * dir;
      case "consistency_score":
        return ((a.consistency_score ?? 0) - (b.consistency_score ?? 0)) * dir;
      case "confidence": {
        const oa = CONFIDENCE_ORDER[a.confidence] ?? 99;
        const ob = CONFIDENCE_ORDER[b.confidence] ?? 99;
        return (oa - ob) * dir;
      }
      case "trend": {
        const oa = TREND_ORDER[a.trend] ?? 99;
        const ob = TREND_ORDER[b.trend] ?? 99;
        return (oa - ob) * dir;
      }
      case "yoy_growth":
        return ((a.yoy_growth ?? 0) - (b.yoy_growth ?? 0)) * dir;
      default:
        return 0;
    }
  });

  function SortableHead({
    field,
    children,
    className,
  }: {
    field: SortField;
    children: React.ReactNode;
    className?: string;
  }) {
    return (
      <TableHead
        className={`cursor-pointer select-none whitespace-nowrap ${className ?? ""}`}
        onClick={() => handleSort(field)}
      >
        <span className="inline-flex items-center">
          {children}
          <SortIcon field={field} />
        </span>
      </TableHead>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Event Performance</h1>
          <p className="text-muted-foreground">
            Aggregated stats for your recurring events ({performances.length}{" "}
            events tracked)
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <Button
            variant="outline"
            size="sm"
            onClick={handleRecalculate}
            disabled={recalculating}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${recalculating ? "animate-spin" : ""}`} />
            {recalculating ? "Recalculating…" : "Recalculate Performance"}
          </Button>
          {recalcMessage && (
            <p className="text-xs text-muted-foreground max-w-xs text-right">{recalcMessage}</p>
          )}
        </div>
      </div>

      {performances.length > 10 && (
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${performances.length} events…`}
            className="pl-9 pr-9"
          />
          {search && (
            <button
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setSearch("")}
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5" />
            Performance Table
            {search && (
              <span className="text-sm font-normal text-muted-foreground">
                — {sorted.length} result{sorted.length !== 1 ? "s" : ""} for &ldquo;{search}&rdquo;
              </span>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {performances.length === 0 ? (
            <div className="py-14 text-center space-y-4">
              <BarChart3 className="h-12 w-12 mx-auto text-muted-foreground/30" />
              <div>
                <p className="font-medium text-sm">No performance data yet</p>
                <p className="text-muted-foreground text-xs mt-1 max-w-xs mx-auto">
                  Once you have recurring events with sales logged, TruckCast shows avg revenue, consistency scores, and trends per event.
                </p>
              </div>
              <div className="flex gap-2 justify-center">
                <a href="/dashboard/events/import" className="inline-flex items-center gap-1.5 rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-medium hover:bg-primary/90 transition-colors">
                  Import events →
                </a>
                <a href="/dashboard/events" className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted transition-colors">
                  Log sales
                </a>
              </div>
            </div>
          ) : sorted.length === 0 ? (
            <div className="py-10 text-center">
              <p className="text-sm text-muted-foreground">No events match &ldquo;{search}&rdquo;</p>
              <button className="text-sm text-primary hover:underline mt-2" onClick={() => setSearch("")}>Clear search</button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <SortableHead field="event_name">Event Name</SortableHead>
                    <SortableHead field="times_booked" className="text-center">Times</SortableHead>
                    <SortableHead field="avg_sales" className="text-right">Avg Sales</SortableHead>
                    <SortableHead field="median_sales" className="text-right">Median</SortableHead>
                    <TableHead className="text-right">Min / Max</TableHead>
                    <SortableHead field="consistency_score" className="text-center">Consistency</SortableHead>
                    <TableHead className="text-center whitespace-nowrap">
                      <span className="inline-flex items-center gap-1">
                        <SortableHead field="confidence" className="p-0 border-0">
                          Confidence
                        </SortableHead>
                        <Tooltip>
                          <TooltipTrigger render={<span className="inline-flex cursor-help" />}>
                            <Info className="h-3.5 w-3.5 text-muted-foreground" />
                          </TooltipTrigger>
                          <TooltipContent>
                            Confidence reflects how predictable this event is based on your history.
                            More consistent past results = higher confidence.
                          </TooltipContent>
                        </Tooltip>
                      </span>
                    </TableHead>
                    <SortableHead field="trend" className="text-center">Trend</SortableHead>
                    <TableHead className="text-right">Forecast</TableHead>
                    <TableHead>Years</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {sorted.map((perf) => (
                    <TableRow key={perf.id} className="group">
                      <TableCell className="font-medium">
                        <Link
                          href={`/dashboard/performance/${encodeURIComponent(perf.event_name)}`}
                          className="hover:text-primary hover:underline inline-flex items-center gap-1"
                        >
                          {perf.event_name}
                          <ExternalLink className="h-3 w-3 opacity-0 group-hover:opacity-50 transition-opacity shrink-0" />
                        </Link>
                      </TableCell>
                      <TableCell className="text-center">
                        {perf.times_booked}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(perf.avg_sales)}
                      </TableCell>
                      <TableCell className="text-right">
                        {formatCurrency(perf.median_sales)}
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {formatCurrency(perf.min_sales)} /{" "}
                        {formatCurrency(perf.max_sales)}
                      </TableCell>
                      <TableCell className="text-center">
                        <span
                          className={`font-mono text-sm ${
                            perf.consistency_score >= 0.7
                              ? "text-green-600"
                              : perf.consistency_score >= 0.5
                                ? "text-yellow-600"
                                : "text-red-600"
                          }`}
                        >
                          {(perf.consistency_score * 100).toFixed(0)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-center">
                        <Tooltip>
                          <TooltipTrigger render={<span className="inline-flex" />}>
                            <Badge
                              variant="secondary"
                              className={`cursor-help ${CONFIDENCE_COLORS[perf.confidence] ?? ""}`}
                            >
                              {perf.confidence}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            {confidenceTooltip(perf)}
                          </TooltipContent>
                        </Tooltip>
                      </TableCell>
                      <TableCell className="text-center">
                        <span
                          className={`text-sm font-medium ${
                            TREND_COLORS[perf.trend] ?? ""
                          }`}
                        >
                          {perf.trend}
                        </span>
                        {perf.yoy_growth !== null && (
                          <span className="text-xs text-muted-foreground ml-1">
                            ({perf.yoy_growth > 0 ? "+" : ""}
                            {(perf.yoy_growth * 100).toFixed(0)}%)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-medium">
                        {formatCurrency(perf.forecast_next)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {perf.years_active ?? "—"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
