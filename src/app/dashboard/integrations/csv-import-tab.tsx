"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import {
  buildImportTemplateCsv,
  matchFeeType,
  matchHeader,
  parseCSV,
  parseWithMapping,
  ADVANCED_FIELD_VALUES,
  BASIC_FIELD_VALUES,
  FIELD_OPTIONS,
  type ColumnMapping,
  type FieldKey,
  type ParsedRow,
} from "@/lib/csv-import/parser";
import { US_STATES, US_STATE_NAMES, OTHER_STATE } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Upload,
  FileText,
  AlertCircle,
  CheckCircle,
  ArrowRight,
  ArrowLeft,
  Columns,
  Eye,
  Download,
  Link,
  Loader2,
  ChevronDown,
  ChevronRight,
} from "lucide-react";

// ═══════════════════════════════════════════════════════════════════════
// UI-only types (parser types + constants live in @/lib/csv-import/parser)
// ═══════════════════════════════════════════════════════════════════════

type Step = "upload" | "map" | "preview" | "duplicates";

type DuplicateAction = "skip" | "replace" | "keep_both";

type DuplicateMatchType = "exact" | "fuzzy";

interface DuplicateMatch {
  event_name: string;
  event_date: string;
  existing_event_id: string;
  existing_event_name: string;
  existing_net_sales: number | null;
  match_type: DuplicateMatchType;
  similarity_score: number | null;
  action: DuplicateAction;
}


// ═══════════════════════════════════════════════════════════════════════
// Component
// ═══════════════════════════════════════════════════════════════════════

export function CsvImportTab() {
  const [step, setStep] = useState<Step>("upload");
  const [importSource, setImportSource] = useState<"csv" | "sheets">("csv");
  const [sheetsUrl, setSheetsUrl] = useState("");
  const [sheetsLoading, setSheetsLoading] = useState(false);
  const [sheetsError, setSheetsError] = useState<string | null>(null);
  const [rawText, setRawText] = useState<string>("");
  const [fileName, setFileName] = useState<string>("");
  // Batch default state — applied to imported rows that don't bring
  // their own state from the CSV. Null/empty = don't backfill.
  const [batchDefaultState, setBatchDefaultState] = useState<string>("");
  // Batch default event_mode — same pattern. Used for mixed
  // food-truck + catering historical imports where most rows share a
  // mode. Per-row event_mode from the CSV always wins. Empty = use the
  // hard-coded "food_truck" default (matches pre-existing behavior).
  const [batchDefaultMode, setBatchDefaultMode] = useState<string>("");
  const [columnMappings, setColumnMappings] = useState<ColumnMapping[]>([]);
  const [dataLines, setDataLines] = useState<string[][]>([]);

  const [importing, setImporting] = useState(false);
  const [imported, setImported] = useState(false);
  const [importCount, setImportCount] = useState(0);
  const [importError, setImportError] = useState<string | null>(null);
  const [importProgress, setImportProgress] = useState<string | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateMatch[]>([]);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [showAdvancedFields, setShowAdvancedFields] = useState(false);

  const router = useRouter();
  const supabase = createClient();
  const dragCounter = useRef(0);

  // ── Step 1: Upload ──

  function processCSVText(text: string, sourceName: string) {
    setRawText(text);
    setFileName(sourceName);

    const { headers, rows: parsedDataLines } = parseCSV(text);
    if (headers.length === 0 || parsedDataLines.length === 0) {
      setImportError("The file appears to be empty or has only one row.");
      return;
    }
    setDataLines(parsedDataLines);

    // Build initial column mappings with auto-detection
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
    setImported(false);
    setImportError(null);
  }

  function processFile(file: File) {
    if (!file.name.endsWith(".csv") && file.type !== "text/csv") {
      setImportError("Please upload a CSV file (.csv)");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      processCSVText(reader.result as string, file.name);
    };
    reader.readAsText(file);
  }

  async function handleLoadSheet() {
    const url = sheetsUrl.trim();
    if (!url) return;
    setSheetsLoading(true);
    setSheetsError(null);
    try {
      const res = await fetch(
        `/api/import/google-sheets?url=${encodeURIComponent(url)}`
      );
      const body = res.headers.get("content-type")?.includes("text/csv")
        ? await res.text()
        : await res.json();

      if (!res.ok) {
        setSheetsError(
          typeof body === "object" ? body.error : "Failed to load sheet."
        );
        return;
      }
      processCSVText(body as string, "Google Sheet");
    } catch {
      setSheetsError("Network error — check your connection and try again.");
    } finally {
      setSheetsLoading(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    processFile(file);
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

  // ── Step 2: Column mapping ──

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

  // ── Step 3: Preview (computed from current mappings) ──

  const parsedRows = useMemo(() => {
    if ((step !== "preview" && step !== "duplicates") || dataLines.length === 0) return [];
    return parseWithMapping(dataLines, columnMappings);
  }, [step, dataLines, columnMappings]);

  const validCount = parsedRows.filter((r) => r.valid).length;
  const invalidCount = parsedRows.filter((r) => !r.valid).length;

  // Mode breakdown across VALID rows using the same resolution the
  // import insert uses: per-row event_mode > batchDefaultMode >
  // hard-coded "food_truck". Drives the preview-summary chip so the
  // operator can sanity-check the split before committing. The
  // "auto-classified from event_type" suffix fires only when the CSV
  // didn't map an event_mode column AND at least one row landed as
  // catering via the parser's event_type inference — i.e. the
  // inference layer actually did work worth surfacing.
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
          // event_mode came from the parser's event_type inference
          // since no event_mode column was mapped.
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

  // Count of events that will actually be imported given current duplicate actions
  const dupActionMap = new Map(duplicates.map((d) => [`${d.event_name}|${d.event_date}`, d.action]));
  const importableCount = parsedRows.filter((r) => {
    if (!r.valid) return false;
    const action = dupActionMap.get(`${r.event_name}|${r.event_date}`);
    if (!action) return true; // not a duplicate
    return action !== "skip";
  }).length;
  const multiDayCount = parsedRows.filter((r) => r.multi_day_label).length;

  // ── Duplicate check ──

  async function handleCheckDuplicates() {
    const validRows = parsedRows.filter((r) => r.valid);
    if (validRows.length === 0) return;

    setCheckingDuplicates(true);
    try {
      const res = await fetch("/api/events/check-duplicates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows: validRows.map((r) => ({
            event_name: r.event_name,
            event_date: r.event_date,
          })),
        }),
      });
      const data = await res.json();
      const found: DuplicateMatch[] = (data.duplicates ?? []).map(
        (d: Omit<DuplicateMatch, "action">) => ({ ...d, action: "skip" as DuplicateAction })
      );
      if (found.length > 0) {
        setDuplicates(found);
        setStep("duplicates");
      } else {
        setDuplicates([]);
        // No duplicates — go straight to import
        await runImport([]);
      }
    } catch {
      setImportError("Failed to check for duplicates. Proceeding with import.");
      await runImport([]);
    } finally {
      setCheckingDuplicates(false);
    }
  }

  function updateDuplicateAction(index: number, action: DuplicateAction) {
    setDuplicates((prev) =>
      prev.map((d, i) => (i === index ? { ...d, action } : d))
    );
  }

  function setBulkAction(action: DuplicateAction) {
    setDuplicates((prev) => prev.map((d) => ({ ...d, action })));
  }

  // ── Import ──

  async function handleImport() {
    await runImport(duplicates);
  }

  async function runImport(resolvedDuplicates: DuplicateMatch[]) {
    // Build a map of duplicate actions keyed by event_name|event_date
    const dupActionMap = new Map<string, DuplicateAction>();
    for (const d of resolvedDuplicates) {
      dupActionMap.set(`${d.event_name}|${d.event_date}`, d.action);
    }

    const validRows = parsedRows.filter((r) => r.valid);
    if (validRows.length === 0) {
      setImportError(`No valid rows found in parsed data (total parsed: ${parsedRows.length}). Please go back to step 1 and re-upload your file.`);
      return;
    }

    setImporting(true);
    setImportError(null);
    setImportProgress(null);

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      setImportError("Not authenticated. Please log in and try again.");
      setImporting(false);
      return;
    }

    // Filter rows based on duplicate actions
    const rowsToInsert = validRows.filter((r) => {
      const action = dupActionMap.get(`${r.event_name}|${r.event_date}`);
      if (!action) return true; // not a duplicate
      return action !== "skip"; // keep if replace or keep_both
    });

    // For "replace" action, delete existing events first
    const replaceIds = resolvedDuplicates
      .filter((d) => d.action === "replace")
      .map((d) => d.existing_event_id);

    if (replaceIds.length > 0) {
      // ALWAYS delete by specific event ids, chunked. The prior
      // "replacingAll → delete().eq(user_id)" optimization was a data
      // loss bug: replacingAll just meant "every DUPLICATE is marked
      // replace" — NOT "every existing event is a duplicate". If the
      // user had 100 events and 10 duplicates, choosing "replace all"
      // wiped all 100. Now always scoped to replaceIds. The .in()
      // chunk size handles arbitrary counts safely. See Julian's
      // post-Commit-E smoke test where this path triggered.
      const CHUNK = 100;
      for (let i = 0; i < replaceIds.length; i += CHUNK) {
        const { error: delError } = await supabase.from("events").delete().in("id", replaceIds.slice(i, i + CHUNK));
        if (delError) {
          setImportError(`Delete failed: ${delError.message}`);
          setImporting(false);
          return;
        }
      }
    }

    const insertData = rowsToInsert.map((r) => {
      // Resolve event_mode first — downstream defaults (fee_type below)
      // depend on knowing whether the row lands as catering.
      const resolvedMode: "food_truck" | "catering" =
        (r.event_mode ?? batchDefaultMode) === "catering" ? "catering" : "food_truck";
      // fee_type default per mode: catering rows are almost always
      // pre-settled (operator is invoiced up-front, no walk-up sales to
      // settle), so when the CSV doesn't provide a fee_type we seed
      // "pre_settled" for catering rows. Food-truck rows keep the
      // pre-existing "none" default. Explicit CSV values still win.
      const resolvedFeeType = r.fee_type
        ? matchFeeType(r.fee_type)
        : resolvedMode === "catering"
        ? "pre_settled"
        : "none";
      return {
        user_id: user.id,
        event_name: r.event_name,
        event_date: r.event_date,
        start_time: r.start_time ?? null,
        end_time: r.end_time ?? null,
        setup_time: r.setup_time ?? null,
        city: r.city ?? null,
        // Row state from CSV mapping wins; batch default (set in the
        // mapping step) fallback. null is fine for historical rows with
        // no location context — operator fills on next edit.
        state: r.state ?? batchDefaultState ?? null,
        net_sales: r.net_sales ?? null,
        event_type: r.event_type ?? null,
        location: r.location ?? null,
        fee_type: resolvedFeeType,
        fee_rate: r.fee_rate ?? 0,
        sales_minimum: r.sales_minimum ?? 0,
        forecast_sales: r.forecast_sales ?? null,
        notes: r.notes ?? null,
        booked: r.booked !== undefined ? r.booked : true, // default true — historical imports are confirmed events
        event_tier: r.event_tier ?? null,
        anomaly_flag: r.anomaly_flag ?? "normal",
        event_weather: r.weather_type ?? null,
        expected_attendance: r.expected_attendance ?? null,
        event_mode: resolvedMode,
        pos_source: "manual" as const,
        // Cost fields — only included when non-null to avoid errors if migration hasn't been applied yet
        ...(r.food_cost !== undefined ? { food_cost: r.food_cost } : {}),
        ...(r.labor_cost !== undefined ? { labor_cost: r.labor_cost } : {}),
        ...(r.other_costs !== undefined ? { other_costs: r.other_costs } : {}),
      };
    });

    if (insertData.length === 0) {
      setImportError(`Nothing to insert — rowsToInsert was empty. Valid rows: ${validRows.length}, duplicates: ${resolvedDuplicates.length}, actions: ${resolvedDuplicates.map(d => d.action).join(",").slice(0, 100)}`);
      setImporting(false);
      return;
    }

    const BATCH_SIZE = 50;
    let totalInserted = 0;
    const errors: string[] = [];

    for (let i = 0; i < insertData.length; i += BATCH_SIZE) {
      const batch = insertData.slice(i, i + BATCH_SIZE);
      const batchNum = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(insertData.length / BATCH_SIZE);
      setImportProgress(
        `Importing batch ${batchNum} of ${totalBatches} (${totalInserted} / ${insertData.length})...`
      );

      const { error } = await supabase.from("events").insert(batch);
      if (error) {
        // Batch failed — fall back to row-by-row so one bad row doesn't kill the whole batch
        let rowsInsertedInBatch = 0;
        for (let j = 0; j < batch.length; j++) {
          const { error: rowError } = await supabase.from("events").insert(batch[j]);
          if (rowError) {
            const rowNum = i + j + 1;
            const eventName = (batch[j] as { event_name: string }).event_name ?? `row ${rowNum}`;
            errors.push(`Row ${rowNum} "${eventName}": ${rowError.message}`);
          } else {
            rowsInsertedInBatch++;
          }
        }
        totalInserted += rowsInsertedInBatch;
      } else {
        totalInserted += batch.length;
      }
    }

    if (totalInserted > 0) {
      setImportProgress("Recalculating forecasts and performance...");
      try {
        await fetch("/api/recalculate", { method: "POST" });
      } catch {
        // Non-critical
      }
      setImported(true);
      setImportCount(totalInserted);
    }

    if (errors.length > 0) {
      setImportError(`${errors.length} batch(es) failed:\n${errors.join("\n")}`);
    }

    setImportProgress(null);
    setImporting(false);
  }

  // ── CSV Template Download ──
  // Template content is shared with the admin import path via
  // buildImportTemplateCsv() — do not fork the content inline here.
  // The only thing UI-specific is the browser download wrapper below.

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

  // ── Reset ──

  function handleReset() {
    setStep("upload");
    setRawText("");
    setFileName("");
    setColumnMappings([]);
    setDataLines([]);
    setImported(false);
    setImportError(null);
    setImportProgress(null);
    setDuplicates([]);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Render
  // ═══════════════════════════════════════════════════════════════════

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Import Events</h1>
          <p className="text-muted-foreground">
            Upload a CSV file to import historical events
          </p>
          <a
            href="/dashboard/events/import/historical"
            className="inline-flex items-center gap-1 text-sm text-primary hover:underline mt-1"
          >
            Already using Square or Clover? Pull sales by date range →
          </a>
        </div>
        <Button variant="outline" size="sm" onClick={handleDownloadTemplate} className="shrink-0 gap-2">
          <Download className="h-4 w-4" />
          Download CSV Template
        </Button>
      </div>

      {/* Step indicator */}
      <div className="flex items-center gap-2 text-sm">
        {[
          { key: "upload", label: "1. Upload", icon: Upload },
          { key: "map", label: "2. Map Columns", icon: Columns },
          { key: "preview", label: "3. Preview & Import", icon: Eye },
          { key: "duplicates", label: "4. Duplicates", icon: AlertCircle },
        ].map(({ key, label, icon: Icon }, i) => (
          <div key={key} className="flex items-center gap-2">
            {i > 0 && <ArrowRight className="h-4 w-4 text-muted-foreground" />}
            <div
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium ${
                step === key
                  ? "bg-primary text-primary-foreground"
                  : (key === "upload" || (key === "map" && (step === "preview" || step === "duplicates")) || (key === "preview" && step === "duplicates"))
                    ? "bg-muted text-muted-foreground"
                    : "bg-muted/50 text-muted-foreground/60"
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </div>
          </div>
        ))}
      </div>

      {/* ── Step 1: Upload ── */}
      {step === "upload" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Import Events
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Source toggle */}
            <div className="flex gap-2">
              <button
                onClick={() => { setImportSource("csv"); setSheetsError(null); }}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium border transition-colors ${
                  importSource === "csv"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-input hover:bg-muted"
                }`}
              >
                <FileText className="h-4 w-4" />
                Upload CSV
              </button>
              <button
                onClick={() => { setImportSource("sheets"); setSheetsError(null); }}
                className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium border transition-colors ${
                  importSource === "sheets"
                    ? "bg-primary text-primary-foreground border-primary"
                    : "bg-background border-input hover:bg-muted"
                }`}
              >
                <Link className="h-4 w-4" />
                Google Sheets
              </button>
            </div>

            {/* CSV upload */}
            {importSource === "csv" && (
              <div
                onDragEnter={handleDragEnter}
                onDragLeave={handleDragLeave}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-lg p-10 text-center transition-colors ${
                  isDragging
                    ? "border-primary bg-primary/5"
                    : "border-muted-foreground/25 hover:border-muted-foreground/50"
                }`}
              >
                <Upload className={`h-10 w-10 mx-auto mb-4 transition-colors ${isDragging ? "text-primary" : "text-muted-foreground"}`} />
                {isDragging ? (
                  <p className="text-sm font-medium text-primary mb-4">Drop your CSV file here</p>
                ) : (
                  <>
                    <p className="text-sm font-medium mb-1">
                      Drag &amp; drop your CSV here, or click to browse
                    </p>
                    <p className="text-xs text-muted-foreground mb-4">
                      Works with Airtable, Square, Excel, SkyTab, or any spreadsheet export
                    </p>
                  </>
                )}
                <label className={`inline-flex items-center gap-2 cursor-pointer px-4 py-2 rounded-md text-sm font-medium transition-colors ${isDragging ? "invisible" : "bg-primary text-primary-foreground hover:bg-primary/90"}`}>
                  <FileText className="h-4 w-4" />
                  Choose CSV file
                  <input
                    type="file"
                    accept=".csv"
                    onChange={handleFileChange}
                    className="sr-only"
                  />
                </label>
              </div>
            )}

            {/* Google Sheets URL */}
            {importSource === "sheets" && (
              <div className="space-y-3">
                <div className="rounded-md border bg-muted/40 p-3 text-sm text-foreground space-y-1">
                  <p className="font-medium">Before you paste your link:</p>
                  <p className="text-xs text-muted-foreground">In Google Sheets, click <strong>Share</strong> → set to <strong>&ldquo;Anyone with the link can view&rdquo;</strong>. Your data stays private — we only read it once to import.</p>
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="https://docs.google.com/spreadsheets/d/..."
                    value={sheetsUrl}
                    onChange={(e) => { setSheetsUrl(e.target.value); setSheetsError(null); }}
                    onKeyDown={(e) => { if (e.key === "Enter") handleLoadSheet(); }}
                    className="font-mono text-xs"
                  />
                  <Button
                    onClick={handleLoadSheet}
                    disabled={!sheetsUrl.trim() || sheetsLoading}
                  >
                    {sheetsLoading ? (
                      <><Loader2 className="h-4 w-4 animate-spin mr-2" />Loading…</>
                    ) : (
                      <>Import <ArrowRight className="h-4 w-4 ml-1" /></>
                    )}
                  </Button>
                </div>
                {sheetsError && (
                  <div className="flex items-start gap-2 text-sm text-destructive">
                    <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{sheetsError}</span>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Step 2: Map Columns ── */}
      {step === "map" && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Columns className="h-5 w-5" />
                  Map Your Columns
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  We auto-detected what we could. Use the dropdowns to assign or change any column.
                  You need at least an <strong>Event Name</strong> and a <strong>Date</strong>.
                </p>
              </div>
              <div className="flex gap-2 shrink-0 mt-1">
                <Button size="sm" variant="outline" onClick={handleReset}>
                  <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                  Back
                </Button>
                <Button size="sm" disabled={!canProceed} onClick={() => setStep("preview")}>
                  Preview
                  <ArrowRight className="h-3.5 w-3.5 ml-1" />
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {fileName && (
              <p className="text-sm">
                File: <span className="font-medium">{fileName}</span>
                {" — "}
                {dataLines.length} data rows, {columnMappings.length} columns
              </p>
            )}

            {/* Batch default state — applied to rows without their own
                state from the CSV mapping. Helpful when all/most rows
                are in the same state (e.g. reactivating a local
                operator's imported history). Per-row state from a
                mapped "state" column overrides this default. */}
            {!columnMappings.some((c) => c.assignedField === "state") && (
              <div className="flex items-center justify-between gap-3 flex-wrap rounded-md border bg-muted/30 px-3 py-2">
                <div className="text-xs text-muted-foreground max-w-md">
                  No <code className="font-mono">state</code> column in this CSV.
                  Pick a default state to apply to every imported row, or leave
                  blank and fill in per-event later.
                </div>
                <Select
                  value={batchDefaultState || "__none__"}
                  onValueChange={(v) => setBatchDefaultState(v === "__none__" ? "" : (v ?? ""))}
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

            {/* Batch default event mode — applied to rows without their
                own event_mode from the CSV mapping. Primary use: mixed
                food-truck + catering historical imports where most rows
                share a mode (e.g. operator whose CSV lacks an
                event_mode column and whose history is predominantly
                catering). Per-row event_mode from a mapped column
                overrides this default. */}
            {!columnMappings.some((c) => c.assignedField === "event_mode") && (
              <div className="flex items-center justify-between gap-3 flex-wrap rounded-md border bg-muted/30 px-3 py-2">
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
                    <SelectItem value="food_truck">Vending (default)</SelectItem>
                    <SelectItem value="catering">Catering</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Advanced options toggle */}
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">
                Showing basic fields. Advanced fields (weather, anomaly, fees, costs) are hidden by default.
              </p>
              <button
                type="button"
                onClick={() => setShowAdvancedFields((v) => !v)}
                className="flex items-center gap-1.5 text-xs font-medium text-primary hover:underline shrink-0"
              >
                {showAdvancedFields ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronRight className="h-3.5 w-3.5" />
                )}
                {showAdvancedFields ? "Hide advanced options" : "Show advanced options"}
              </button>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-48">Your Column</TableHead>
                    <TableHead className="w-64">Maps To</TableHead>
                    <TableHead>Sample Values</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {columnMappings.map((col) => (
                    <TableRow
                      key={col.index}
                      className={
                        col.assignedField === "skip" ? "opacity-50" : ""
                      }
                    >
                      <TableCell className="font-medium">
                        {col.originalHeader}
                        {col.autoDetected && (
                          <Badge
                            variant="outline"
                            className="ml-2 text-xs text-green-700 border-green-300"
                          >
                            auto
                          </Badge>
                        )}
                        {/* Badge if this column is mapped to an advanced field */}
                        {ADVANCED_FIELD_VALUES.includes(col.assignedField) && col.assignedField !== "skip" && (
                          <Badge
                            variant="outline"
                            className="ml-2 text-xs text-brand-teal border-brand-teal/40"
                          >
                            advanced
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={col.assignedField}
                          onValueChange={(val) =>
                            updateMapping(col.index, val as FieldKey | "skip")
                          }
                        >
                          <SelectTrigger className="w-56">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {/* Always show basic fields */}
                            {FIELD_OPTIONS.filter((opt) =>
                              BASIC_FIELD_VALUES.includes(opt.value)
                            ).map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                <span>{opt.label}</span>
                                <span className="ml-2 text-xs text-muted-foreground">
                                  {opt.description}
                                </span>
                              </SelectItem>
                            ))}
                            {/* Advanced fields — shown when toggle is on, or when current value is an advanced field */}
                            {(showAdvancedFields || ADVANCED_FIELD_VALUES.includes(col.assignedField)) && (
                              <>
                                <div className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground border-t mt-1 pt-2">
                                  Advanced
                                </div>
                                {FIELD_OPTIONS.filter((opt) =>
                                  ADVANCED_FIELD_VALUES.includes(opt.value)
                                ).map((opt) => (
                                  <SelectItem key={opt.value} value={opt.value}>
                                    <span>{opt.label}</span>
                                    <span className="ml-2 text-xs text-muted-foreground">
                                      {opt.description}
                                    </span>
                                  </SelectItem>
                                ))}
                              </>
                            )}
                          </SelectContent>
                        </Select>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground max-w-md truncate">
                        {col.sampleValues
                          .filter(Boolean)
                          .slice(0, 3)
                          .map((v, i) => (
                            <span key={i}>
                              {i > 0 && (
                                <span className="mx-1 text-muted-foreground/40">|</span>
                              )}
                              <span className="bg-muted px-1.5 py-0.5 rounded">
                                {v.length > 40 ? v.slice(0, 40) + "..." : v}
                              </span>
                            </span>
                          ))}
                        {col.sampleValues.filter(Boolean).length === 0 && (
                          <span className="italic">(empty)</span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {!canProceed && (
              <div className="rounded-lg border border-brand-orange/40 bg-brand-orange/5 p-3 text-sm text-foreground">
                <AlertCircle className="h-4 w-4 inline mr-2 text-brand-orange" />
                Please map at least an <strong>Event Name</strong> column and a{" "}
                <strong>Date</strong> (or Start Time / Setup Time) column to continue.
              </div>
            )}

            <div className="flex items-center gap-3">
              <Button variant="outline" onClick={handleReset}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back
              </Button>
              <Button
                disabled={!canProceed}
                onClick={() => setStep("preview")}
              >
                Preview Import
                <ArrowRight className="h-4 w-4 ml-2" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── Step 4: Duplicates ── */}
      {step === "duplicates" && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <AlertCircle className="h-5 w-5 text-brand-orange" />
                  Duplicate Detection
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  We found {duplicates.length} potential duplicate{duplicates.length !== 1 ? "s" : ""} on dates already in your account
                  {duplicates.some((d) => d.match_type === "fuzzy")
                    ? " — including near-misses where the name differs slightly (apostrophes, comma prefixes)."
                    : "."}
                  {" "}Choose how to handle each one, then click Import.
                </p>
              </div>
              {!imported && (
                <div className="flex gap-2 shrink-0 mt-1">
                  <Button size="sm" variant="outline" onClick={() => setStep("preview")}>
                    <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                    Back
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleImport}
                    disabled={importing || importableCount === 0}
                  >
                    {importing ? "Importing..." : `Import ${importableCount}`}
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Bulk actions */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">Bulk action:</span>
              <Button size="sm" variant="outline" onClick={() => setBulkAction("skip")}>
                Skip All Duplicates
              </Button>
              <Button size="sm" variant="outline" onClick={() => setBulkAction("replace")}>
                Replace All
              </Button>
              <Button size="sm" variant="outline" onClick={() => setBulkAction("keep_both")}>
                Keep All
              </Button>
            </div>

            <div className="border rounded-lg overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Incoming row</TableHead>
                    <TableHead>Matches existing</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Existing Sales</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {duplicates.map((dup, i) => (
                    <TableRow key={i}>
                      <TableCell className="font-medium">{dup.event_name}</TableCell>
                      <TableCell>
                        <div className="flex flex-col gap-0.5">
                          <span className={dup.match_type === "fuzzy" ? "text-foreground" : "text-muted-foreground"}>
                            {dup.match_type === "fuzzy" ? dup.existing_event_name : "Same name"}
                          </span>
                          <span className="text-[10px] text-muted-foreground">
                            {dup.match_type === "exact"
                              ? "Exact match"
                              : `Near match · ${Math.round((dup.similarity_score ?? 0) * 100)}% similar`}
                          </span>
                        </div>
                      </TableCell>
                      <TableCell>{dup.event_date}</TableCell>
                      <TableCell>
                        {dup.existing_net_sales !== null
                          ? `$${dup.existing_net_sales.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                          : "No sales recorded"}
                      </TableCell>
                      <TableCell>
                        <Select
                          value={dup.action}
                          onValueChange={(val) =>
                            updateDuplicateAction(i, val as DuplicateAction)
                          }
                        >
                          <SelectTrigger className="w-36">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="skip">Skip</SelectItem>
                            <SelectItem value="replace">Replace</SelectItem>
                            <SelectItem value="keep_both">Keep Both</SelectItem>
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {importError && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
                <AlertCircle className="h-4 w-4 inline mr-2" />
                {importError}
              </div>
            )}

            {importProgress && (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                {importProgress}
              </div>
            )}

            {imported ? (
              <div className="flex items-center gap-3">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <span className="text-green-700 font-medium">
                  Successfully imported {importCount} events!
                </span>
                <Button variant="outline" onClick={() => router.push("/dashboard/events")}>
                  View Events
                </Button>
                <Button variant="ghost" onClick={handleReset}>
                  Import More
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Button variant="outline" onClick={() => setStep("preview")}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back
                </Button>
                <Button onClick={handleImport} disabled={importing || importableCount === 0}>
                  {importing ? "Importing..." : `Import ${importableCount} Events`}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Step 3: Preview & Import ── */}
      {step === "preview" && (
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-4">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Eye className="h-5 w-5" />
                  Preview & Import
                </CardTitle>
                <p className="text-sm text-muted-foreground mt-1">
                  Review your data before importing. Valid rows are ready to go.
                </p>
              </div>
              {!imported && (
                <div className="flex gap-2 shrink-0 mt-1">
                  <Button size="sm" variant="outline" onClick={() => setStep("map")}>
                    <ArrowLeft className="h-3.5 w-3.5 mr-1" />
                    Back
                  </Button>
                  <Button
                    size="sm"
                    onClick={handleCheckDuplicates}
                    disabled={checkingDuplicates || importing || validCount === 0}
                  >
                    {checkingDuplicates ? "Checking..." : `Import ${validCount} Events`}
                    <ArrowRight className="h-3.5 w-3.5 ml-1" />
                  </Button>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Summary badges */}
            <div className="flex items-center gap-3 flex-wrap">
              <Badge variant="secondary" className="bg-green-100 text-green-800">
                {validCount} valid
              </Badge>
              {invalidCount > 0 && (
                <Badge variant="secondary" className="bg-red-100 text-red-800">
                  {invalidCount} errors
                </Badge>
              )}
              {multiDayCount > 0 && (
                <Badge variant="secondary" className="bg-brand-teal/15 text-brand-teal">
                  {multiDayCount} multi-day rows
                </Badge>
              )}
              {/* Mode breakdown — sanity-check chip so the operator can
                  verify the food-truck / catering split before committing.
                  Only rendered when at least one valid row is catering;
                  a pure food-truck import doesn't benefit from the chip
                  and the suffix would be empty. */}
              {validCount > 0 && modeBreakdown.catering > 0 && (
                <Badge variant="secondary" className="bg-brand-teal/15 text-brand-teal">
                  {modeBreakdown.foodTruck} vending · {modeBreakdown.catering} catering
                  {showInferenceSuffix && " (auto-classified from event_type)"}
                </Badge>
              )}
            </div>

            {/* Parse errors */}
            {invalidCount > 0 && (
              <div className="rounded-lg border border-brand-orange/40 bg-brand-orange/5 p-3 space-y-1">
                <p className="text-sm font-medium text-foreground">
                  {invalidCount} row(s) have errors and will be skipped:
                </p>
                <ul className="text-xs text-muted-foreground space-y-0.5 max-h-32 overflow-y-auto">
                  {parsedRows
                    .filter((r) => !r.valid)
                    .map((r, i) => (
                      <li key={i}>
                        <span className="font-medium">{r.event_name}</span>
                        {" — "}
                        {r.error}
                      </li>
                    ))}
                </ul>
              </div>
            )}

            {/* Data preview table */}
            <div className="max-h-96 overflow-y-auto border rounded">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">Status</TableHead>
                    <TableHead>Event Name</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Time</TableHead>
                    <TableHead>City</TableHead>
                    <TableHead>Sales</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead>Fee</TableHead>
                    <TableHead>Notes</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {parsedRows.map((row, i) => (
                    <TableRow key={i} className={row.valid ? "" : "bg-red-50"}>
                      <TableCell>
                        {row.valid ? (
                          <CheckCircle className="h-4 w-4 text-green-600" />
                        ) : (
                          <AlertCircle className="h-4 w-4 text-red-600" />
                        )}
                      </TableCell>
                      <TableCell className="font-medium">
                        {row.event_name}
                        {row.multi_day_label && (
                          <Badge
                            variant="outline"
                            className="ml-2 text-xs text-brand-teal border-brand-teal/40"
                          >
                            {row.multi_day_label}
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>{row.event_date}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {[
                          row.setup_time && `Setup: ${row.setup_time}`,
                          row.start_time && `Start: ${row.start_time}`,
                          row.end_time && `End: ${row.end_time}`,
                        ]
                          .filter(Boolean)
                          .join(" | ") || "—"}
                      </TableCell>
                      <TableCell>{row.city ?? "—"}</TableCell>
                      <TableCell>
                        {row.net_sales !== undefined
                          ? `$${row.net_sales.toFixed(2)}`
                          : "—"}
                      </TableCell>
                      <TableCell className="text-xs">{row.event_type ?? "—"}</TableCell>
                      <TableCell className="text-xs">{row.fee_type ?? "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground max-w-32 truncate">
                        {row.valid ? row.notes ?? "" : row.error}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {/* Import errors */}
            {importError && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive whitespace-pre-wrap">
                <div className="flex items-center gap-2 font-medium mb-1">
                  <AlertCircle className="h-4 w-4" />
                  Import Error
                </div>
                {importError}
              </div>
            )}

            {/* Progress */}
            {importProgress && (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                {importProgress}
              </div>
            )}

            {/* Actions */}
            {imported ? (
              <div className="flex items-center gap-3">
                <CheckCircle className="h-5 w-5 text-green-600" />
                <span className="text-green-700 font-medium">
                  Successfully imported {importCount} events!
                </span>
                <Button
                  variant="outline"
                  onClick={() => router.push("/dashboard/events")}
                >
                  View Events
                </Button>
                <Button variant="ghost" onClick={handleReset}>
                  Import More
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-3">
                <Button variant="outline" onClick={() => setStep("map")}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Adjust Mapping
                </Button>
                <Button
                  onClick={handleCheckDuplicates}
                  disabled={checkingDuplicates || importing || validCount === 0}
                >
                  {checkingDuplicates
                    ? "Checking..."
                    : `Import ${validCount} Events`}
                  <ArrowRight className="h-4 w-4 ml-2" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
