"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EVENT_TYPES, FEE_TYPES, ANOMALY_FLAGS } from "@/lib/constants";
import type { Event } from "@/lib/database.types";
import type { EventFormData } from "@/app/dashboard/events/actions";

interface EventFormProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: EventFormData) => Promise<void>;
  initialData?: Event | null;
  title?: string;
}

export function EventForm({
  open,
  onOpenChange,
  onSubmit,
  initialData,
  title = "Add Event",
}: EventFormProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const data: EventFormData = {
      event_name: form.get("event_name") as string,
      event_date: form.get("event_date") as string,
      start_time: (form.get("start_time") as string) || undefined,
      end_time: (form.get("end_time") as string) || undefined,
      setup_time: (form.get("setup_time") as string) || undefined,
      location: (form.get("location") as string) || undefined,
      city: (form.get("city") as string) || undefined,
      city_area: (form.get("city_area") as string) || undefined,
      booked: form.get("booked") === "true",
      event_type: (form.get("event_type") as string) || undefined,
      event_tier: (form.get("event_tier") as string) || undefined,
      event_weather: (form.get("event_weather") as string) || undefined,
      anomaly_flag: (form.get("anomaly_flag") as string) || undefined,
      expected_attendance: form.get("expected_attendance")
        ? Number(form.get("expected_attendance"))
        : undefined,
      other_trucks: form.get("other_trucks")
        ? Number(form.get("other_trucks"))
        : undefined,
      fee_type: (form.get("fee_type") as string) || undefined,
      fee_rate: form.get("fee_rate")
        ? Number(form.get("fee_rate"))
        : undefined,
      sales_minimum: form.get("sales_minimum")
        ? Number(form.get("sales_minimum"))
        : undefined,
      net_sales: form.get("net_sales")
        ? Number(form.get("net_sales"))
        : undefined,
      notes: (form.get("notes") as string) || undefined,
    };

    try {
      await onSubmit(data);
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-6">
          {/* Basic Info */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Event Details
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-2">
                <Label htmlFor="event_name">Event Name *</Label>
                <Input
                  id="event_name"
                  name="event_name"
                  required
                  defaultValue={initialData?.event_name ?? ""}
                  placeholder="e.g. Taste of St. Louis"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="event_date">Date *</Label>
                <Input
                  id="event_date"
                  name="event_date"
                  type="date"
                  required
                  defaultValue={initialData?.event_date ?? ""}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="booked">Status</Label>
                <Select
                  name="booked"
                  defaultValue={
                    initialData?.booked === false ? "false" : "true"
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select status" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Booked</SelectItem>
                    <SelectItem value="false">Not Booked</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="start_time">Start Time</Label>
                <Input
                  id="start_time"
                  name="start_time"
                  type="time"
                  defaultValue={initialData?.start_time ?? ""}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="end_time">End Time</Label>
                <Input
                  id="end_time"
                  name="end_time"
                  type="time"
                  defaultValue={initialData?.end_time ?? ""}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="setup_time">Setup Time</Label>
                <Input
                  id="setup_time"
                  name="setup_time"
                  type="time"
                  defaultValue={initialData?.setup_time ?? ""}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="event_type">Event Type</Label>
                <Select
                  name="event_type"
                  defaultValue={initialData?.event_type ?? ""}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select type" />
                  </SelectTrigger>
                  <SelectContent>
                    {EVENT_TYPES.map((t) => (
                      <SelectItem key={t} value={t}>
                        {t}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="event_tier">Tier</Label>
                <Select
                  name="event_tier"
                  defaultValue={initialData?.event_tier ?? ""}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select tier" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A">A - Destination</SelectItem>
                    <SelectItem value="B">B - Solid Recurring</SelectItem>
                    <SelectItem value="C">C - Smaller/Newer</SelectItem>
                    <SelectItem value="D">D - Niche/Low-Value</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Location */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Location
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2 space-y-2">
                <Label htmlFor="location">Venue / Location</Label>
                <Input
                  id="location"
                  name="location"
                  defaultValue={initialData?.location ?? ""}
                  placeholder="e.g. Kiener Plaza"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  name="city"
                  defaultValue={initialData?.city ?? ""}
                  placeholder="St. Louis"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="city_area">Area / Neighborhood</Label>
                <Input
                  id="city_area"
                  name="city_area"
                  defaultValue={initialData?.city_area ?? ""}
                  placeholder="e.g. Downtown, Soulard"
                />
              </div>
            </div>
          </div>

          {/* Event Details */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Crowd & Competition
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="expected_attendance">Expected Attendance</Label>
                <Input
                  id="expected_attendance"
                  name="expected_attendance"
                  type="number"
                  min="0"
                  defaultValue={initialData?.expected_attendance ?? ""}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="other_trucks">Other Trucks</Label>
                <Input
                  id="other_trucks"
                  name="other_trucks"
                  type="number"
                  min="0"
                  defaultValue={initialData?.other_trucks ?? ""}
                />
              </div>
            </div>
          </div>

          {/* Fees */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Fees
            </h3>
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label htmlFor="fee_type">Fee Type</Label>
                <Select
                  name="fee_type"
                  defaultValue={initialData?.fee_type ?? "none"}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(FEE_TYPES).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="fee_rate">Fee Rate ($/%)</Label>
                <Input
                  id="fee_rate"
                  name="fee_rate"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={initialData?.fee_rate ?? ""}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sales_minimum">Sales Minimum ($)</Label>
                <Input
                  id="sales_minimum"
                  name="sales_minimum"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={initialData?.sales_minimum ?? ""}
                />
              </div>
            </div>
          </div>

          {/* Sales & Weather */}
          <div className="space-y-4">
            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
              Sales & Conditions
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="net_sales">Net Sales ($)</Label>
                <Input
                  id="net_sales"
                  name="net_sales"
                  type="number"
                  step="0.01"
                  min="0"
                  defaultValue={initialData?.net_sales ?? ""}
                  placeholder="Enter after event"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="event_weather">Weather</Label>
                <Select
                  name="event_weather"
                  defaultValue={initialData?.event_weather ?? ""}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select weather" />
                  </SelectTrigger>
                  <SelectContent>
                    {[
                      "Clear",
                      "Overcast",
                      "Hot",
                      "Cold",
                      "Rain Before Event",
                      "Rain During Event",
                      "Storms",
                      "Snow",
                    ].map((w) => (
                      <SelectItem key={w} value={w}>
                        {w}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="anomaly_flag">Anomaly Flag</Label>
                <Select
                  name="anomaly_flag"
                  defaultValue={initialData?.anomaly_flag ?? "normal"}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(ANOMALY_FLAGS).map(([value, label]) => (
                      <SelectItem key={value} value={value}>
                        {label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-2">
            <Label htmlFor="notes">Notes</Label>
            <Textarea
              id="notes"
              name="notes"
              defaultValue={initialData?.notes ?? ""}
              placeholder="Any additional notes..."
              rows={3}
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading
                ? "Saving..."
                : initialData
                  ? "Update Event"
                  : "Create Event"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
