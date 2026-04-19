"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { US_STATES, US_STATE_NAMES, OTHER_STATE } from "@/lib/constants";
import {
  buildImportTemplateCsv,
  matchHeader,
  parseWithMapping,
  splitCSVLine,
  ADVANCED_FIELD_VALUES,
  BASIC_FIELD_VALUES,
  FIELD_OPTIONS,
  type ColumnMapping,
  type FieldKey,
  type ParsedRow,
} from "@/lib/csv-import/parser";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Upload,
  Download,
  AlertCircle,
  CheckCircle,
  ArrowLeft,
  ArrowRight,
  Loader2,
  FileText,
} from "lucide-react";

type Step = "upload" | "map" | "preview" | "duplicates" | "done";

type DuplicateAction = "skip" | "replace" | "keep_both";

interface DuplicateMatch {
  event_name: string;
  event_date: string;
  existing_event_id: string;
  existing_net_sales: number | null;
  action: DuplicateAction;
}

interface ImportResult {
  inserted: number;
  skipped_duplicates: number;
  replaced: number;
  invalid_rows: number;
  total_rows: number;
  errors: { row: number; event_name: string; message: string }[];
}

interface Props {
  userId: string;
  targetLabel: string;
}

export function ImportEventsClient({ userId, targetLabel }: Props) {
  const [step, setStep] = useState<Step>("upload");
  const [rawText, setRawText] = useState("");
  const [fileName, setFileName] = useState("");
  const [columnMappings, setColumnMappings] = useState<ColumnMapping[]>([]);
  const [dataLines, setDataLines] = useState<string[][]>([]);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  // Batch default state — applies to rows that don't bring their own
  // state from the CSV. Per-row state from a mapped "state" column
  // wins. Primary use: Nick's reactivation import where 200+ events
  // are all in MO.
  const [batchDefaultState, setBatchDefaultState] = useState<string>("");
  // Batch default event_mode — same pattern. Empty = hard-coded
  // "food_truck" fallback (matches pre-existing behavior).
  const [batchDefaultMode, setBatchDefaultMode] = useState<string>("");
  const dragCounter = useRef(0);

  // ── Upload step ──────────────────────────────────────────────────

  const processCSVText = useCallback((text: string, source: string) => {
    setError(null);
    setRawText(text);
    setFileName(source);

    const lines = text.trim().split("\n");
    if (lines.length < 2) {
      setError("CSV appears empty or has only a header row.");
      return;
    }

    const headers = splitCSVLine(lines[0]);
    const parsedDataLines: string[][] = [];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      parsedDataLines.push(splitCSVLine(lines[i]));
    }
    setDataLines(parsedDataLines);

    const mappings: ColumnMapping[] = headers.map((h, idx) => {
      const detected = matchHeader(h);
      const samples = parsedDataLines.slice(0, 3).map((row) => row[idx] ?? "");
      return {
        index: idx,
        originalHeader: h.trim(),
        sampleValues: samples,
        autoDetected: detected,
        assignedField: detected ?? "skip",
      };
    });

    setColumnMappings(mappings);
    setStep("map");
  }, []);

  const processFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = String(e.target?.result ?? "");
        processCSVText(text, file.name);
      };
      reader.readAsText(file);
    },
    [processCSVText]
  );

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) processFile(file);
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current += 1;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsDragging(true);
    }
  }
  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) setIsDragging(false);
  }
  function handleDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
  }
  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;
    const file = e.dataTransfer.files?.[0];
    if (file) processFile(file);
  }

  function handleDownloadTemplate() {
    const csvContent = buildImportTemplateCsv();
    const blob = new Blob([csvContent], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "vendcast-import-template.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  // ── Map step ─────────────────────────────────────────────────────

  const updateMapping = useCallback(
    (index: number, field: FieldKey | "skip") => {
      setColumnMappings((prev) =>
        prev.map((col) =>
          col.index === index ? { ...col, assignedField: field } : col
        )
      );
    },
    []
  );

  const hasEventName = columnMappings.some((c) => c.assignedField === "event_name");
  const hasDateSource = columnMappings.some(
    (c) =>
      c.assignedField === "event_date" ||
      c.assignedField === "start_time" ||
      c.assignedField === "setup_time"
  );
  const canProceed = hasEventName && hasDateSource;

  // ── Preview step ─────────────────────────────────────────────────

  const parsedRows = useMemo(() => {
    if (step === "upload" || dataLines.length === 0) return [];
    return parseWithMapping(dataLines, columnMappings);
  }, [step, dataLines, columnMappings]);

  const validCount = parsedRows.filter((r) => r.valid).length;
  const invalidCount = parsedRows.filter((r) => !r.valid).length;

  // Mode breakdown — mirrors csv-import-tab.tsx. Uses the same
  // resolution the API insert uses so the preview chip reflects the
  // actual stored values, not just parser output. See Commit E.
  const hasModeColumn = columnMappings.some((c) => c.assignedField === "event_mode");
  const hasTypeColumn = columnMappings.some((c) => c.assignedField === "event_type");
  const modeBreakdown = useMemo(() => {
    let ft = 0;
    let cat = 0;
    let inferredCat = 0;
    for (const r of parsedRows) {
      if (!r.valid) continue;
      const mode = (r.event_mode ?? batchDefaultMode) === "catering" ? "catering" : "food_truck";
      if (mode === "catering") {
        cat += 1;
        if (!hasModeColumn && r.event_mode === "catering") {
          inferredCat += 1;
        }
      } else {
        ft += 1;
      }
    }
    return { foodTruck: ft, catering: cat, inferredCatering: inferredCat };
  }, [parsedRows, batchDefaultMode, hasModeColumn]);
  const showInferenceSuffix =
    !hasModeColumn && hasTypeColumn && modeBreakdown.inferredCatering > 0;

  async function handleCheckDuplicates() {
    const validRows = parsedRows.filter((r) => r.valid);
    if (validRows.length === 0) {
      setError("No valid rows to import.");
      return;
    }

    setCheckingDuplicates(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/events/check-duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          rows: validRows.map((r) => ({
            event_name: r.event_name,
            event_date: r.event_date,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Duplicate check failed.");
        return;
      }
      const found: DuplicateMatch[] = (data.duplicates ?? []).map(
        (d: Omit<DuplicateMatch, "action">) => ({
          ...d,
          // Default action = skip. Admin must explicitly flip to
          // replace/keep_both per-row or via bulk.
          action: "skip" as DuplicateAction,
        })
      );
      if (found.length > 0) {
        setDuplicates(found);
        setStep("duplicates");
      } else {
        // No duplicates — go straight to import.
        await runImport([]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error during duplicate check.");
    } finally {
      setCheckingDuplicates(false);
    }
  }

  function updateDupAction(idx: number, action: DuplicateAction) {
    setDuplicates((prev) =>
      prev.map((d, i) => (i === idx ? { ...d, action } : d))
    );
  }
  function setBulkAction(action: DuplicateAction) {
    setDuplicates((prev) => prev.map((d) => ({ ...d, action })));
  }

  // ── Import ───────────────────────────────────────────────────────

  async function runImport(resolvedDuplicates: DuplicateMatch[]) {
    setImporting(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/events/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          csvText: rawText,
          columnMappings,
          defaultState: batchDefaultState || undefined,
          defaultMode: batchDefaultMode || undefined,
          dupActions: resolvedDuplicates.map((d) => ({
            event_name: d.event_name,
            event_date: d.event_date,
            action: d.action,
            existing_event_id: d.existing_event_id,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? `Import failed (HTTP ${res.status}).`);
        return;
      }
      setResult(data as ImportResult);
      setStep("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error during import.");
    } finally {
      setImporting(false);
    }
  }

  function handleReset() {
    setStep("upload");
    setRawText("");
    setFileName("");
    setColumnMappings([]);
    setDataLines([]);
    setDuplicates([]);
    setResult(null);
    setError(null);
  }

  // ═════════════════════════════════════════════════════════════════
  // Render
  // ═════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6">
      {error && (
        <div className="rounded-md bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 p-3 text-sm text-red-800 dark:text-red-200 flex items-start gap-2">
          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
          <div>{error}</div>
        </div>
      )}

      {/* ── Step: Upload ── */}
      {step === "upload" && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <CardTitle>1. Upload CSV</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Drop a CSV file or click to browse. Use the template if you
                  want the canonical column order; any CSV with recognizable
                  headers will auto-detect.
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={handleDownloadTemplate} className="gap-2 shrink-0">
                <Download className="h-4 w-4" />
                Download template
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <label
              htmlFor="admin-csv-upload"
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className={`flex flex-col items-center justify-center border-2 border-dashed rounded-lg p-10 cursor-pointer transition-colors ${
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-muted-foreground/25 hover:border-muted-foreground/50"
              }`}
            >
              <Upload className="h-8 w-8 text-muted-foreground mb-3" />
              <p className="font-medium">Drop a CSV here or click to browse</p>
              <p className="text-xs text-muted-foreground mt-1">
                Parses client-side for preview. Server re-parses on confirm.
              </p>
              <input
                id="admin-csv-upload"
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={handleFileChange}
              />
            </label>
          </CardContent>
        </Card>
      )}

      {/* ── Step: Map columns ── */}
      {step === "map" && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <CardTitle>2. Map columns</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  <FileText className="h-3.5 w-3.5 inline mr-1" />
                  {fileName} · {dataLines.length} data row{dataLines.length === 1 ? "" : "s"}
                </p>
              </div>
              <Button variant="outline" size="sm" onClick={handleReset}>
                Start over
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Batch default state — only surfaced when the CSV has no
                state column mapped. For bulk reactivation imports where
                all rows share a state (Nick's 200+ events all in MO),
                this saves per-row editing later. Per-row state from a
                mapped "state" column always wins. */}
            {!columnMappings.some((c) => c.assignedField === "state") && (
              <div className="flex items-center justify-between gap-3 flex-wrap rounded-md border bg-muted/30 px-3 py-2 mb-2">
                <div className="text-xs text-muted-foreground max-w-md">
                  No <code className="font-mono">state</code> column in this CSV.
                  Pick a default to apply to every imported row.
                </div>
                <Select
                  value={batchDefaultState || "__none__"}
                  onValueChange={(v) =>
                    setBatchDefaultState(v === "__none__" ? "" : (v ?? ""))
                  }
                >
                  <SelectTrigger className="w-56">
                    <SelectValue placeholder="Default state…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">No default (leave blank)</SelectItem>
                    {US_STATES.map((code) => (
                      <SelectItem key={code} value={code}>
                        {code} — {US_STATE_NAMES[code]}
                      </SelectItem>
                    ))}
                    <SelectItem value={OTHER_STATE}>Other / International</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Batch default event mode — applies when the CSV has no
                event_mode column mapped. Per-row event_mode from a
                mapped column always wins. */}
            {!columnMappings.some((c) => c.assignedField === "event_mode") && (
              <div className="flex items-center justify-between gap-3 flex-wrap rounded-md border bg-muted/30 px-3 py-2 mb-2">
                <div className="text-xs text-muted-foreground max-w-md">
                  No <code className="font-mono">event_mode</code> column in this CSV.
                  Pick a default mode to apply to every imported row.
                </div>
                <Select
                  value={batchDefaultMode || "food_truck"}
                  onValueChange={(v) => setBatchDefaultMode(v ?? "")}
                >
                  <SelectTrigger className="w-56">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="food_truck">Food truck (default)</SelectItem>
                    <SelectItem value="catering">Catering</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            {columnMappings.map((col) => (
              <div key={col.index} className="flex items-center gap-3 text-sm">
                <div className="w-48 shrink-0">
                  <div className="font-medium truncate" title={col.originalHeader}>
                    {col.originalHeader || <span className="text-muted-foreground italic">(empty header)</span>}
                  </div>
                  <div className="text-xs text-muted-foreground truncate">
                    {col.sampleValues.filter(Boolean).slice(0, 2).join(" / ") || "—"}
                  </div>
                </div>
                <Select
                  value={col.assignedField}
                  onValueChange={(v) => updateMapping(col.index, v as FieldKey | "skip")}
                >
                  <SelectTrigger className="flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {FIELD_OPTIONS.filter((o) => BASIC_FIELD_VALUES.includes(o.value)).map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                    <SelectItem value="__divider" disabled>
                      ─── Advanced ───
                    </SelectItem>
                    {FIELD_OPTIONS.filter((o) => ADVANCED_FIELD_VALUES.includes(o.value)).map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
            <div className="flex items-center justify-between pt-4 border-t">
              <div className="text-xs text-muted-foreground">
                {hasEventName ? (
                  <span className="text-green-700 dark:text-green-400">✓ event_name mapped</span>
                ) : (
                  <span className="text-amber-700 dark:text-amber-400">✗ event_name required</span>
                )}
                {" · "}
                {hasDateSource ? (
                  <span className="text-green-700 dark:text-green-400">✓ date source mapped</span>
                ) : (
                  <span className="text-amber-700 dark:text-amber-400">✗ date / start_time / setup_time required</span>
                )}
              </div>
              <Button onClick={() => setStep("preview")} disabled={!canProceed}>
                Preview
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Step: Preview ── */}
      {step === "preview" && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <CardTitle>3. Preview</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  {validCount} valid
                  {invalidCount > 0 && <> · <span className="text-amber-700 dark:text-amber-400">{invalidCount} invalid</span></>}
                  {" · importing to "}
                  <span className="font-medium">{targetLabel}</span>
                </p>
                {/* Mode breakdown — same treatment as self-serve preview.
                    Renders only when at least one valid row is catering;
                    pure food-truck imports don't benefit. See Commit E. */}
                {validCount > 0 && modeBreakdown.catering > 0 && (
                  <p className="text-xs text-blue-700 dark:text-blue-400 mt-1">
                    {modeBreakdown.foodTruck} food truck · {modeBreakdown.catering} catering
                    {showInferenceSuffix && " (auto-classified from event_type)"}
                  </p>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={() => setStep("map")}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back to mapping
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-96 overflow-y-auto border-t">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50 sticky top-0">
                  <tr className="text-left">
                    <th className="px-3 py-2 font-medium w-10">#</th>
                    <th className="px-3 py-2 font-medium">Event</th>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium">Type</th>
                    <th className="px-3 py-2 font-medium text-right">Sales</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {parsedRows.map((row, i) => (
                    <tr key={i} className={`border-b last:border-b-0 ${!row.valid ? "bg-red-50/50 dark:bg-red-950/10" : ""}`}>
                      <td className="px-3 py-2 text-muted-foreground">{i + 1}</td>
                      <td className="px-3 py-2">
                        {row.event_name}
                        {row.multi_day_label && (
                          <Badge variant="outline" className="ml-2 text-xs">{row.multi_day_label}</Badge>
                        )}
                      </td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{row.event_date}</td>
                      <td className="px-3 py-2 text-muted-foreground">{row.event_type ?? "—"}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {row.net_sales != null ? `$${row.net_sales.toLocaleString()}` : "—"}
                      </td>
                      <td className="px-3 py-2">
                        {row.valid ? (
                          <span className="text-green-700 dark:text-green-400 text-xs">ok</span>
                        ) : (
                          <span className="text-red-700 dark:text-red-400 text-xs" title={row.error}>
                            {row.error}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between p-4 border-t">
              <span className="text-xs text-muted-foreground">
                Invalid rows are skipped silently. Only {validCount} event{validCount === 1 ? "" : "s"} will be imported.
              </span>
              <Button onClick={handleCheckDuplicates} disabled={checkingDuplicates || validCount === 0}>
                {checkingDuplicates ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Checking…
                  </>
                ) : (
                  <>
                    Check for duplicates & import
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Step: Duplicates ── */}
      {step === "duplicates" && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <CardTitle>4. Resolve duplicates</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  {duplicates.length} event{duplicates.length === 1 ? "" : "s"} already exist for this user with the same name + date.
                  Default: skip. Flip per-row or use bulk actions below.
                </p>
              </div>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" onClick={() => setBulkAction("skip")}>Skip all</Button>
                <Button variant="outline" size="sm" onClick={() => setBulkAction("replace")}>Replace all</Button>
                <Button variant="outline" size="sm" onClick={() => setBulkAction("keep_both")}>Keep both</Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto max-h-96 overflow-y-auto border-t">
              <table className="w-full text-sm">
                <thead className="border-b bg-muted/50 sticky top-0 text-left">
                  <tr>
                    <th className="px-3 py-2 font-medium">Event</th>
                    <th className="px-3 py-2 font-medium">Date</th>
                    <th className="px-3 py-2 font-medium text-right">Existing sales</th>
                    <th className="px-3 py-2 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {duplicates.map((d, i) => (
                    <tr key={d.existing_event_id} className="border-b last:border-b-0">
                      <td className="px-3 py-2">{d.event_name}</td>
                      <td className="px-3 py-2 text-muted-foreground whitespace-nowrap">{d.event_date}</td>
                      <td className="px-3 py-2 text-right font-mono">
                        {d.existing_net_sales != null ? `$${d.existing_net_sales.toLocaleString()}` : "—"}
                      </td>
                      <td className="px-3 py-2">
                        <Select
                          value={d.action}
                          onValueChange={(v) => updateDupAction(i, v as DuplicateAction)}
                        >
                          <SelectTrigger className="h-8 w-36">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="skip">Skip</SelectItem>
                            <SelectItem value="replace">Replace</SelectItem>
                            <SelectItem value="keep_both">Keep both</SelectItem>
                          </SelectContent>
                        </Select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex items-center justify-between p-4 border-t">
              <Button variant="outline" size="sm" onClick={() => setStep("preview")}>
                <ArrowLeft className="h-4 w-4 mr-1" />
                Back
              </Button>
              <Button onClick={() => runImport(duplicates)} disabled={importing}>
                {importing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Importing…
                  </>
                ) : (
                  <>
                    Import
                    <ArrowRight className="h-4 w-4 ml-2" />
                  </>
                )}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Step: Done ── */}
      {step === "done" && result && (
        <Card>
          <CardHeader>
            <div className="flex items-start gap-3">
              <CheckCircle className="h-6 w-6 text-green-600 shrink-0 mt-0.5" />
              <div>
                <CardTitle>Import complete</CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Audit log entry written with <code className="text-xs bg-muted px-1 rounded font-mono">user.import_events</code>.
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
              <div className="rounded border p-3">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Imported</div>
                <div className="text-2xl font-bold text-green-700 dark:text-green-400">{result.inserted}</div>
              </div>
              <div className="rounded border p-3">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Skipped (dup)</div>
                <div className="text-2xl font-bold">{result.skipped_duplicates}</div>
              </div>
              <div className="rounded border p-3">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Replaced</div>
                <div className="text-2xl font-bold">{result.replaced}</div>
              </div>
              <div className="rounded border p-3">
                <div className="text-xs text-muted-foreground uppercase tracking-wide">Invalid</div>
                <div className={`text-2xl font-bold ${result.invalid_rows > 0 ? "text-amber-700 dark:text-amber-400" : ""}`}>
                  {result.invalid_rows}
                </div>
              </div>
            </div>

            {result.errors.length > 0 && (
              <div className="rounded-md border border-amber-300 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-800 p-3 text-sm">
                <div className="font-medium text-amber-800 dark:text-amber-300 mb-2">
                  {result.errors.length} row{result.errors.length === 1 ? "" : "s"} failed to insert:
                </div>
                <ul className="space-y-1 text-xs font-mono max-h-40 overflow-y-auto">
                  {result.errors.map((err, i) => (
                    <li key={i}>
                      Row {err.row} &ldquo;{err.event_name}&rdquo;: {err.message}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <Button variant="outline" onClick={handleReset}>
                Import another CSV
              </Button>
              <a
                href={`/dashboard/admin/users/${userId}`}
                className={buttonVariants({ variant: "outline" })}
              >
                Back to user detail
              </a>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
