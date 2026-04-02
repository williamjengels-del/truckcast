"use client";

import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Plus,
  Users,
  Pencil,
  Trash2,
  Mail,
  Phone,
  Upload,
  FileUp,
  CheckCircle2,
  AlertCircle,
  X,
} from "lucide-react";
import {
  createContact,
  updateContact,
  deleteContact,
} from "./actions";
import { createClient } from "@/lib/supabase/client";
import type { Contact } from "@/lib/database.types";
import type { ContactFormData } from "./actions";

// --- CSV Import Types & Helpers ---

interface ParsedContact {
  name: string;
  email?: string;
  phone?: string;
  organization?: string;
  notes?: string;
}

interface CsvImportRow {
  row: number;
  data: ParsedContact;
  valid: boolean;
  error?: string;
}

type ImportStatus = "idle" | "preview" | "importing" | "done" | "error";

const COLUMN_MAP: Record<string, keyof ParsedContact> = {};

// Build the column mapping from flexible header names
function initColumnMap() {
  const mappings: [string[], keyof ParsedContact][] = [
    [["name", "contact", "contact name", "full name", "fullname"], "name"],
    [["first name", "firstname"], "name"], // handled specially below
    [["email", "email address", "e-mail"], "email"],
    [["phone", "phone number", "tel", "telephone"], "phone"],
    [["organization", "company", "org", "business"], "organization"],
    [["notes", "note", "comments", "description"], "notes"],
  ];
  for (const [keys, field] of mappings) {
    for (const key of keys) {
      COLUMN_MAP[key] = field;
    }
  }
}
initColumnMap();

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ",") {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
  }
  result.push(current.trim());
  return result;
}

function parseCSV(text: string): CsvImportRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) return [];

  const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase().trim());

  // Detect "first name" + "last name" columns
  const firstNameIdx = headers.findIndex(
    (h) => h === "first name" || h === "firstname"
  );
  const lastNameIdx = headers.findIndex(
    (h) => h === "last name" || h === "lastname"
  );

  // Map header indices to contact fields
  const mapping: (keyof ParsedContact | null)[] = headers.map((h) => {
    return COLUMN_MAP[h] ?? null;
  });

  const rows: CsvImportRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    const data: ParsedContact = { name: "" };

    for (let j = 0; j < values.length; j++) {
      const field = mapping[j];
      if (field && values[j]) {
        if (field === "name" && data.name) {
          // Don't overwrite if already set (e.g. from "first name" mapping that also maps to "name")
          continue;
        }
        data[field] = values[j];
      }
    }

    // Handle first name + last name merge
    if (firstNameIdx >= 0) {
      const first = values[firstNameIdx]?.trim() ?? "";
      const last = lastNameIdx >= 0 ? values[lastNameIdx]?.trim() ?? "" : "";
      data.name = [first, last].filter(Boolean).join(" ");
    }

    const valid = !!data.name.trim();
    rows.push({
      row: i + 1,
      data,
      valid,
      error: valid ? undefined : "Name is required",
    });
  }

  return rows;
}

interface ContactsClientProps {
  initialContacts: Contact[];
}

export function ContactsClient({ initialContacts }: ContactsClientProps) {
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Contact | null>(null);
  const [search, setSearch] = useState("");
  const [showImport, setShowImport] = useState(false);
  const router = useRouter();

  const filtered = initialContacts.filter(
    (c) =>
      (c.name ?? "").toLowerCase().includes(search.toLowerCase()) ||
      (c.organization ?? "").toLowerCase().includes(search.toLowerCase())
  );

  async function handleCreate(data: ContactFormData) {
    await createContact(data);
    setShowForm(false);
    router.refresh();
  }

  async function handleUpdate(data: ContactFormData) {
    if (!editing) return;
    await updateContact(editing.id, data);
    setEditing(null);
    router.refresh();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this contact?")) return;
    await deleteContact(id);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Contacts</h1>
          <p className="text-muted-foreground">
            {initialContacts.length} event organizers
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="outline"
            className="gap-2"
            onClick={() => setShowImport(true)}
          >
            <Upload className="h-4 w-4" />
            Import CSV
          </Button>
          <Button className="gap-2" onClick={() => setShowForm(true)}>
            <Plus className="h-4 w-4" />
            Add Contact
          </Button>
        </div>
      </div>

      <Input
        placeholder="Search contacts..."
        className="max-w-sm"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
      />

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-5 w-5" />
            Contacts
          </CardTitle>
        </CardHeader>
        <CardContent>
          {filtered.length === 0 ? (
            <div className="h-32 flex items-center justify-center text-muted-foreground">
              {initialContacts.length === 0
                ? "No contacts yet. Add event organizers to track relationships."
                : "No contacts match your search."}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Organization</TableHead>
                  <TableHead>Email</TableHead>
                  <TableHead>Phone</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {c.organization ?? "—"}
                    </TableCell>
                    <TableCell>
                      {c.email ? (
                        <a
                          href={`mailto:${c.email}`}
                          className="text-primary hover:underline flex items-center gap-1"
                        >
                          <Mail className="h-3 w-3" />
                          {c.email}
                        </a>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell>
                      {c.phone ? (
                        <span className="flex items-center gap-1">
                          <Phone className="h-3 w-3" />
                          {c.phone}
                        </span>
                      ) : (
                        "—"
                      )}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-48 truncate">
                      {c.notes ?? "—"}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1 justify-end">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setEditing(c)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-destructive"
                          onClick={() => handleDelete(c.id)}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* CSV Import Dialog */}
      <CsvImportDialog
        open={showImport}
        onOpenChange={(open) => {
          if (!open) setShowImport(false);
        }}
        onComplete={() => {
          setShowImport(false);
          router.refresh();
        }}
      />

      {/* Contact Form Dialog */}
      <ContactFormDialog
        open={showForm || !!editing}
        onOpenChange={(open) => {
          if (!open) {
            setShowForm(false);
            setEditing(null);
          }
        }}
        onSubmit={editing ? handleUpdate : handleCreate}
        initialData={editing}
        title={editing ? "Edit Contact" : "Add Contact"}
      />
    </div>
  );
}

function CsvImportDialog({
  open,
  onOpenChange,
  onComplete,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
}) {
  const [status, setStatus] = useState<ImportStatus>("idle");
  const [rows, setRows] = useState<CsvImportRow[]>([]);
  const [progress, setProgress] = useState(0);
  const [totalToImport, setTotalToImport] = useState(0);
  const [importedCount, setImportedCount] = useState(0);
  const [errorMessages, setErrorMessages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const validRows = rows.filter((r) => r.valid);
  const invalidRows = rows.filter((r) => !r.valid);

  const reset = useCallback(() => {
    setStatus("idle");
    setRows([]);
    setProgress(0);
    setTotalToImport(0);
    setImportedCount(0);
    setErrorMessages([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  function handleFileSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (evt) => {
      const text = evt.target?.result as string;
      const parsed = parseCSV(text);
      if (parsed.length === 0) {
        setErrorMessages(["No data rows found in CSV. Make sure the file has a header row and at least one data row."]);
        setStatus("error");
        return;
      }
      setRows(parsed);
      setStatus("preview");
    };
    reader.readAsText(file);
  }

  async function handleImport() {
    const toImport = validRows.map((r) => r.data);
    if (toImport.length === 0) return;

    setStatus("importing");
    setTotalToImport(toImport.length);
    setImportedCount(0);
    setProgress(0);
    setErrorMessages([]);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setErrorMessages(["Not authenticated. Please log in and try again."]);
      setStatus("error");
      return;
    }

    const BATCH_SIZE = 50;
    const errors: string[] = [];
    let inserted = 0;

    for (let i = 0; i < toImport.length; i += BATCH_SIZE) {
      const batch = toImport.slice(i, i + BATCH_SIZE).map((row) => ({
        user_id: user.id,
        name: row.name,
        email: row.email || null,
        phone: row.phone || null,
        organization: row.organization || null,
        notes: row.notes || null,
      }));

      const { error } = await supabase.from("contacts").insert(batch);

      if (error) {
        errors.push(`Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${error.message}`);
      } else {
        inserted += batch.length;
      }

      setImportedCount(inserted);
      setProgress(Math.min(100, Math.round(((i + batch.length) / toImport.length) * 100)));
    }

    if (errors.length > 0) {
      setErrorMessages(errors);
    }

    setProgress(100);
    setStatus("done");
  }

  function handleClose(openState: boolean) {
    if (!openState) {
      reset();
    }
    onOpenChange(openState);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileUp className="h-5 w-5" />
            Import Contacts from CSV
          </DialogTitle>
        </DialogHeader>

        {status === "idle" && (
          <div className="space-y-4">
            <div className="border-2 border-dashed rounded-lg p-8 text-center space-y-3">
              <Upload className="h-8 w-8 mx-auto text-muted-foreground" />
              <div>
                <p className="font-medium">Select a CSV file to import</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Supported columns: Name, Email, Phone, Organization, Notes
                </p>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,text/csv"
                onChange={handleFileSelect}
                className="hidden"
              />
              <Button
                variant="outline"
                onClick={() => fileInputRef.current?.click()}
              >
                Choose File
              </Button>
            </div>
            <div className="text-xs text-muted-foreground space-y-1">
              <p className="font-medium">Accepted column headers:</p>
              <ul className="list-disc list-inside space-y-0.5">
                <li>Name: Name, Contact, Contact Name, First Name + Last Name</li>
                <li>Email: Email, Email Address, E-mail</li>
                <li>Phone: Phone, Phone Number, Tel, Telephone</li>
                <li>Organization: Organization, Company, Org, Business</li>
                <li>Notes: Notes, Note, Comments, Description</li>
              </ul>
            </div>
          </div>
        )}

        {status === "error" && rows.length === 0 && (
          <div className="space-y-4">
            <div className="bg-destructive/10 text-destructive rounded-lg p-4 flex items-start gap-2">
              <AlertCircle className="h-5 w-5 mt-0.5 shrink-0" />
              <div className="space-y-1">
                {errorMessages.map((msg, i) => (
                  <p key={i} className="text-sm">{msg}</p>
                ))}
              </div>
            </div>
            <div className="flex justify-end">
              <Button variant="outline" onClick={reset}>
                Try Again
              </Button>
            </div>
          </div>
        )}

        {status === "preview" && (
          <div className="space-y-4">
            <div className="flex gap-3">
              <div className="bg-green-500/10 text-green-700 dark:text-green-400 rounded-lg px-3 py-2 text-sm flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                {validRows.length} valid
              </div>
              {invalidRows.length > 0 && (
                <div className="bg-destructive/10 text-destructive rounded-lg px-3 py-2 text-sm flex items-center gap-2">
                  <AlertCircle className="h-4 w-4" />
                  {invalidRows.length} invalid (missing name)
                </div>
              )}
            </div>

            <div className="border rounded-lg overflow-hidden">
              <div className="max-h-64 overflow-y-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">Row</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Email</TableHead>
                      <TableHead>Phone</TableHead>
                      <TableHead>Org</TableHead>
                      <TableHead className="w-16">Status</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rows.slice(0, 100).map((r) => (
                      <TableRow
                        key={r.row}
                        className={r.valid ? "" : "bg-destructive/5"}
                      >
                        <TableCell className="text-muted-foreground text-xs">
                          {r.row}
                        </TableCell>
                        <TableCell className="font-medium">
                          {r.data.name || "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.data.email || "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.data.phone || "—"}
                        </TableCell>
                        <TableCell className="text-sm">
                          {r.data.organization || "—"}
                        </TableCell>
                        <TableCell>
                          {r.valid ? (
                            <CheckCircle2 className="h-4 w-4 text-green-600" />
                          ) : (
                            <AlertCircle className="h-4 w-4 text-destructive" />
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              {rows.length > 100 && (
                <div className="px-4 py-2 text-xs text-muted-foreground border-t bg-muted/50">
                  Showing first 100 of {rows.length} rows
                </div>
              )}
            </div>

            <div className="flex justify-end gap-3">
              <Button variant="outline" onClick={reset}>
                Cancel
              </Button>
              <Button
                onClick={handleImport}
                disabled={validRows.length === 0}
                className="gap-2"
              >
                <Upload className="h-4 w-4" />
                Import {validRows.length} Contact{validRows.length !== 1 ? "s" : ""}
              </Button>
            </div>
          </div>
        )}

        {status === "importing" && (
          <div className="space-y-4 py-4">
            <div className="text-center">
              <p className="font-medium">Importing contacts...</p>
              <p className="text-sm text-muted-foreground mt-1">
                {importedCount} of {totalToImport} imported
              </p>
            </div>
            <div className="w-full bg-muted rounded-full h-2.5 overflow-hidden">
              <div
                className="bg-primary h-full rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        )}

        {status === "done" && (
          <div className="space-y-4 py-4">
            <div className="text-center space-y-2">
              <CheckCircle2 className="h-10 w-10 mx-auto text-green-600" />
              <p className="font-medium">Import Complete</p>
              <p className="text-sm text-muted-foreground">
                Successfully imported {importedCount} contact{importedCount !== 1 ? "s" : ""}
              </p>
            </div>

            {errorMessages.length > 0 && (
              <div className="bg-destructive/10 text-destructive rounded-lg p-3 text-sm space-y-1">
                <p className="font-medium">Some batches had errors:</p>
                {errorMessages.map((msg, i) => (
                  <p key={i}>{msg}</p>
                ))}
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={onComplete}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ContactFormDialog({
  open,
  onOpenChange,
  onSubmit,
  initialData,
  title,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: ContactFormData) => Promise<void>;
  initialData?: Contact | null;
  title: string;
}) {
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    const form = new FormData(e.currentTarget);
    await onSubmit({
      name: form.get("name") as string,
      email: (form.get("email") as string) || undefined,
      phone: (form.get("phone") as string) || undefined,
      organization: (form.get("organization") as string) || undefined,
      notes: (form.get("notes") as string) || undefined,
    });
    setLoading(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="name">Name *</Label>
            <Input
              id="name"
              name="name"
              required
              defaultValue={initialData?.name ?? ""}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="organization">Organization</Label>
            <Input
              id="organization"
              name="organization"
              defaultValue={initialData?.organization ?? ""}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                defaultValue={initialData?.email ?? ""}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="phone">Phone</Label>
              <Input
                id="phone"
                name="phone"
                defaultValue={initialData?.phone ?? ""}
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              defaultValue={initialData?.notes ?? ""}
              rows={3}
            />
          </div>
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Saving..." : "Save"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
