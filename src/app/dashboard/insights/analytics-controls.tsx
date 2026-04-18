"use client";

import { useRouter, useSearchParams } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { ArrowLeftRight } from "lucide-react";

interface AnalyticsControlsProps {
  availableYears: number[];
  selectedYear: number;
  selectedMonth: number | null; // null = full year
  compareEnabled: boolean;
  compareYear: number | null;
  compareMonth: number | null;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function AnalyticsControls({
  availableYears,
  selectedYear,
  selectedMonth,
  compareEnabled,
  compareYear,
  compareMonth,
}: AnalyticsControlsProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  function buildUrl(params: Record<string, string | null>) {
    const sp = new URLSearchParams(searchParams.toString());
    for (const [key, value] of Object.entries(params)) {
      if (value === null || value === "") {
        sp.delete(key);
      } else {
        sp.set(key, value);
      }
    }
    return `/dashboard/analytics?${sp.toString()}`;
  }

  function navigate(params: Record<string, string | null>) {
    router.push(buildUrl(params));
  }

  return (
    <div className="flex flex-wrap items-end gap-4">
      {/* Primary period */}
      <div className="flex items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Year</Label>
          <Select
            value={selectedYear.toString()}
            onValueChange={(val) => navigate({ year: val })}
          >
            <SelectTrigger className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {availableYears.map((y) => (
                <SelectItem key={y} value={y.toString()}>
                  {y}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs text-muted-foreground">Month</Label>
          <Select
            value={selectedMonth !== null ? selectedMonth.toString() : "all"}
            onValueChange={(val) =>
              navigate({ month: val === "all" ? null : val })
            }
          >
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Full Year</SelectItem>
              {MONTHS.map((m, i) => (
                <SelectItem key={i} value={i.toString()}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Compare toggle */}
      <Button
        variant={compareEnabled ? "default" : "outline"}
        size="sm"
        className="gap-2"
        onClick={() => {
          if (compareEnabled) {
            navigate({ compare: null, cy: null, cm: null });
          } else {
            const prevYear = (selectedYear - 1).toString();
            navigate({
              compare: "1",
              cy: prevYear,
              cm: selectedMonth !== null ? selectedMonth.toString() : null,
            });
          }
        }}
      >
        <ArrowLeftRight className="h-4 w-4" />
        Compare
      </Button>

      {/* Comparison period */}
      {compareEnabled && (
        <div className="flex items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Compare Year
            </Label>
            <Select
              value={(compareYear ?? selectedYear - 1).toString()}
              onValueChange={(val) => navigate({ cy: val })}
            >
              <SelectTrigger className="w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {availableYears.map((y) => (
                  <SelectItem key={y} value={y.toString()}>
                    {y}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs text-muted-foreground">
              Compare Month
            </Label>
            <Select
              value={
                compareMonth !== null ? compareMonth.toString() : "all"
              }
              onValueChange={(val) =>
                navigate({ cm: val === "all" ? null : val })
              }
            >
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Full Year</SelectItem>
                {MONTHS.map((m, i) => (
                  <SelectItem key={i} value={i.toString()}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  );
}
