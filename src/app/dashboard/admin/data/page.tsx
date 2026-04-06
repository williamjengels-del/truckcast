"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
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
import { RefreshCw, ChevronLeft, ChevronRight, ChevronUp, ChevronDown, ChevronsUpDown } from "lucide-react";

const adminNavItems = [
  { href: "/dashboard/admin", label: "Overview" },
  { href: "/dashboard/admin/users", label: "Users" },
  { href: "/dashboard/admin/data", label: "Event Data", active: true },
  { href: "/dashboard/admin/beta", label: "Invites" },
  { href: "/dashboard/admin/feedback", label: "Feedback" },
  { href: "/dashboard/admin/content", label: "Content" },
];

interface AdminEvent {
  id: string;
  user_id: string;
  business_name: string;
  business_city: string | null;
  data_sharing_enabled: boolean;
  event_name: string;
  event_date: string;
  event_type: string | null;
  location: string | null;
  city: string | null;
  net_sales: number | null;
  fee_type: string | null;
  weather_type: string | null;
  anomaly_flag: string | null;
  event_tier: string | null;
  notes: string | null;
}

interface AdminProfile {
  id: string;
  business_name: string | null;
  data_sharing_enabled: boolean;
}

export default function AdminDataPage() {
  const [events, setEvents] = useState<AdminEvent[]>([]);
  const [profiles, setProfiles] = useState<AdminProfile[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [businessSearch, setBusinessSearch] = useState("");
  const [businessSearchInput, setBusinessSearchInput] = useState("");
  const [filterSharing, setFilterSharing] = useState<string>("all");
  const [filterEventType, setFilterEventType] = useState<string>("all");
  const [sortField, setSortField] = useState<string>("business");
  const [sortDir, setSortDir] = useState<string>("asc");
  const pageSize = 50;

  function handleSort(field: string) {
    if (sortField === field) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortDir("asc");
    }
    setPage(1);
  }

  function SortIcon({ field }: { field: string }) {
    if (sortField !== field) return <ChevronsUpDown className="h-3 w-3 ml-1 opacity-40" />;
    return sortDir === "asc"
      ? <ChevronUp className="h-3 w-3 ml-1 text-primary" />
      : <ChevronDown className="h-3 w-3 ml-1 text-primary" />;
  }

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({
      page: String(page),
      sharing: filterSharing,
      sort: sortField,
      dir: sortDir,
    });
    if (search) params.set("q", search);
    if (businessSearch) params.set("business", businessSearch);
    if (filterEventType !== "all") params.set("event_type", filterEventType);

    const res = await fetch(`/api/admin/event-data?${params}`);
    if (res.ok) {
      const data = await res.json();
      setEvents(data.events ?? []);
      setProfiles(data.profiles ?? []);
      setTotal(data.total ?? 0);
    }
    setLoading(false);
  }, [page, search, businessSearch, filterSharing, filterEventType, sortField, sortDir]);

  useEffect(() => { load(); }, [load]);

  const optedInCount = profiles.filter((p) => p.data_sharing_enabled).length;
  const optedOutCount = profiles.filter((p) => !p.data_sharing_enabled).length;
  const totalPages = Math.ceil(total / pageSize);

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    setSearch(searchInput);
    setBusinessSearch(businessSearchInput);
    setPage(1);
  }

  function handleClearFilters() {
    setSearch("");
    setSearchInput("");
    setBusinessSearch("");
    setBusinessSearchInput("");
    setFilterSharing("all");
    setFilterEventType("all");
    setPage(1);
  }

  const hasActiveFilters = search || businessSearch || filterSharing !== "all" || filterEventType !== "all";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold">Event Data</h1>
          <p className="text-muted-foreground text-sm">All events across all users — use the filter to narrow by data sharing status</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Refresh
        </Button>
      </div>

      {/* Admin nav strip */}
      <div className="flex gap-1 border-b pb-0 -mb-2">
        {adminNavItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              item.active
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground"
            }`}
          >
            {item.label}
          </Link>
        ))}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">Total events</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{total.toLocaleString()}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">Users (total)</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{profiles.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">Sharing enabled</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-green-600">{optedInCount}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground font-normal">Opted out</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold text-muted-foreground">{optedOutCount}</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <form onSubmit={handleSearch} className="flex flex-wrap gap-3 items-end">
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">Business name</label>
          <Input
            placeholder="Search business..."
            value={businessSearchInput}
            onChange={(e) => setBusinessSearchInput(e.target.value)}
            className="w-48"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">Event name</label>
          <Input
            placeholder="Search event..."
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="w-48"
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">Data sharing</label>
          <Select value={filterSharing} onValueChange={(v) => { if (v) { setFilterSharing(v); setPage(1); } }}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All users</SelectItem>
              <SelectItem value="opted_in">Sharing enabled</SelectItem>
              <SelectItem value="opted_out">Opted out</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground font-medium">Event type</label>
          <Select value={filterEventType} onValueChange={(v) => { if (v) { setFilterEventType(v); setPage(1); } }}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="Festival">Festival</SelectItem>
              <SelectItem value="Concert">Concert</SelectItem>
              <SelectItem value="Corporate">Corporate</SelectItem>
              <SelectItem value="Weekly Series">Weekly Series</SelectItem>
              <SelectItem value="Private/Catering">Private/Catering</SelectItem>
              <SelectItem value="Community/Neighborhood">Community</SelectItem>
              <SelectItem value="Sports Event">Sports Event</SelectItem>
              <SelectItem value="Fundraiser/Charity">Fundraiser</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-2">
          <Button type="submit" size="sm" variant="outline">Search</Button>
          {hasActiveFilters && (
            <Button type="button" size="sm" variant="ghost" onClick={handleClearFilters}>
              Clear
            </Button>
          )}
        </div>
      </form>

      {/* Table */}
      <div className="rounded-lg border overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50">
              <th className="text-left p-3 font-medium">
                <button onClick={() => handleSort("business")} className="flex items-center hover:text-foreground transition-colors">
                  Business <SortIcon field="business" />
                </button>
              </th>
              <th className="text-left p-3 font-medium">Event</th>
              <th className="text-left p-3 font-medium">
                <button onClick={() => handleSort("event_date")} className="flex items-center hover:text-foreground transition-colors">
                  Date <SortIcon field="event_date" />
                </button>
              </th>
              <th className="text-left p-3 font-medium">Type</th>
              <th className="text-left p-3 font-medium">
                <button onClick={() => handleSort("city")} className="flex items-center hover:text-foreground transition-colors">
                  City <SortIcon field="city" />
                </button>
              </th>
              <th className="text-right p-3 font-medium">
                <button onClick={() => handleSort("net_sales")} className="flex items-center ml-auto hover:text-foreground transition-colors">
                  Net Sales <SortIcon field="net_sales" />
                </button>
              </th>
              <th className="text-left p-3 font-medium">Weather</th>
              <th className="text-left p-3 font-medium">Sharing</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={8} className="text-center p-8 text-muted-foreground">
                  Loading...
                </td>
              </tr>
            ) : events.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-center p-8 text-muted-foreground">
                  No events found.
                </td>
              </tr>
            ) : (
              events.map((event) => (
                <tr key={event.id} className="border-b last:border-0 hover:bg-muted/30">
                  <td className="p-3">
                    <div className="font-medium">{event.business_name}</div>
                    {event.business_city && (
                      <div className="text-xs text-muted-foreground">{event.business_city}</div>
                    )}
                  </td>
                  <td className="p-3 max-w-[180px]">
                    <div className="truncate">{event.event_name}</div>
                    {event.anomaly_flag && event.anomaly_flag !== "normal" && (
                      <Badge variant="outline" className="text-xs mt-0.5">
                        {event.anomaly_flag}
                      </Badge>
                    )}
                  </td>
                  <td className="p-3 whitespace-nowrap text-muted-foreground">
                    {event.event_date}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {event.event_type ?? "—"}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {event.city ?? event.location ?? "—"}
                  </td>
                  <td className="p-3 text-right font-mono">
                    {event.net_sales != null
                      ? `$${event.net_sales.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                      : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className="p-3 text-muted-foreground">
                    {event.weather_type ?? "—"}
                  </td>
                  <td className="p-3">
                    {event.data_sharing_enabled ? (
                      <Badge className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-0 text-xs">
                        Sharing
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-xs text-muted-foreground">
                        Opted out
                      </Badge>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {total > 0
            ? `Showing ${((page - 1) * pageSize) + 1}–${Math.min(page * pageSize, total)} of ${total.toLocaleString()} events`
            : "No events found"}
        </p>
        {totalPages > 1 && (
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={page <= 1 || loading}
              onClick={() => setPage((p) => p - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
              Prev
            </Button>
            <span className="text-sm text-muted-foreground px-1">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              disabled={page >= totalPages || loading}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
