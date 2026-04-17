"use client";

import { useState, useEffect, useRef, useCallback } from "react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { EVENT_TYPES, FEE_TYPES, ANOMALY_FLAGS, CANCELLATION_REASONS } from "@/lib/constants";
import type { Event, WeatherType } from "@/lib/database.types";
import type { EventFormData } from "@/app/dashboard/events/actions";
import { classifyWeather, normalizeCityForGeocoding } from "@/lib/weather";

const WEATHER_OPTIONS: WeatherType[] = [
  "Clear",
  "Overcast",
  "Hot",
  "Cold",
  "Rain Before Event",
  "Rain During Event",
  "Storms",
  "Snow",
];

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
  const [isPrivate, setIsPrivate] = useState<boolean>(initialData?.is_private ?? false);
  const [bookedValue, setBookedValue] = useState<string>(initialData?.booked === false ? "false" : "true");
  const [cancellationReason, setCancellationReason] = useState<string>(initialData?.cancellation_reason ?? "");
  const [eventMode, setEventMode] = useState<string>(initialData?.event_mode ?? "food_truck");
  const [feeType, setFeeType] = useState<string>(initialData?.fee_type ?? "none");
  const [feeRate, setFeeRate] = useState<number | "">(initialData?.fee_rate ?? "");
  const [salesMinimum, setSalesMinimum] = useState<number | "">(initialData?.sales_minimum ?? "");
  const [netSales, setNetSales] = useState<number | "">(initialData?.net_sales ?? "");
  const [invoiceRevenue, setInvoiceRevenue] = useState<number | "">(initialData?.invoice_revenue && initialData.invoice_revenue > 0 ? initialData.invoice_revenue : "");
  const [foodCost, setFoodCost] = useState<number | "">(initialData?.food_cost ?? "");
  const [laborCost, setLaborCost] = useState<number | "">(initialData?.labor_cost ?? "");
  const [otherCosts, setOtherCosts] = useState<number | "">(initialData?.other_costs ?? "");

  // Simple/Advanced mode
  const isEditing = !!initialData;
  const [advancedMode, setAdvancedMode] = useState<boolean>(() => {
    if (isEditing) return true;
    if (typeof window !== "undefined") {
      return localStorage.getItem("event_form_mode") === "advanced";
    }
    return false;
  });

  // Weather auto-suggest
  const [cityValue, setCityValue] = useState<string>(initialData?.city ?? "");
  const [dateValue, setDateValue] = useState<string>(initialData?.event_date ?? "");
  const [weatherValue, setWeatherValue] = useState<string>(initialData?.event_weather ?? "");
  const [weatherSuggested, setWeatherSuggested] = useState<boolean>(false);
  const [weatherBadge, setWeatherBadge] = useState<string | null>(null);
  const [weatherFetching, setWeatherFetching] = useState(false);
  const [suggestedLat, setSuggestedLat] = useState<number | null>(initialData?.latitude ?? null);
  const [suggestedLon, setSuggestedLon] = useState<number | null>(initialData?.longitude ?? null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchWeatherSuggestion = useCallback(async (city: string, date: string) => {
    if (!city.trim() || !date) return;
    setWeatherFetching(true);
    try {
      // Geocode
      const geoRes = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(normalizeCityForGeocoding(city))}&country_code=us&count=10`
      );
      if (!geoRes.ok) return;
      const geoData = await geoRes.json();
      const geoResults: Array<{ latitude: number; longitude: number; name: string; admin1?: string; population?: number }> = geoData.results ?? [];
      if (geoResults.length === 0) return;

      // Pick highest-population match to prefer major cities over small towns
      const result = geoResults.reduce((a, b) => ((b.population ?? 0) > (a.population ?? 0) ? b : a));

      const lat: number = result.latitude;
      const lon: number = result.longitude;
      const stateName: string = result.admin1 ?? "";
      setSuggestedLat(lat);
      setSuggestedLon(lon);

      const today = new Date().toISOString().split("T")[0];
      const isPast = date < today;

      let url: string;
      if (isPast) {
        const prevDate = new Date(date + "T00:00:00");
        prevDate.setDate(prevDate.getDate() - 1);
        const prevStr = prevDate.toISOString().split("T")[0];
        url = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${prevStr}&end_date=${date}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=auto`;
      } else {
        // Future (within 16 days)
        const daysAway = Math.ceil(
          (new Date(date).getTime() - new Date().getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysAway > 16) { setWeatherFetching(false); return; }
        url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_sum&temperature_unit=fahrenheit&precipitation_unit=inch&start_date=${date}&end_date=${date}&timezone=auto`;
      }

      const wxRes = await fetch(url);
      if (!wxRes.ok) return;
      const wxData = await wxRes.json();
      const daily = wxData.daily;
      if (!daily?.time?.length) return;

      const targetIdx: number = daily.time.indexOf(date);
      if (targetIdx === -1) return;

      const maxTempF: number = daily.temperature_2m_max[targetIdx] ?? 70;
      const minTempF: number = daily.temperature_2m_min[targetIdx] ?? 50;
      const precipitationIn: number = daily.precipitation_sum[targetIdx] ?? 0;
      let prevDayPrecipIn = 0;
      if (targetIdx > 0) prevDayPrecipIn = daily.precipitation_sum[targetIdx - 1] ?? 0;

      const classification = classifyWeather({ maxTempF, minTempF, precipitationIn, prevDayPrecipIn });
      setWeatherValue(classification);
      setWeatherSuggested(true);
      const stateAbbr = stateName ? `, ${stateName}` : "";
      setWeatherBadge(`Suggested · ${result.name}${stateAbbr} (${lat.toFixed(2)}, ${lon.toFixed(2)})`);
    } catch {
      // Silently fail — weather is optional
    } finally {
      setWeatherFetching(false);
    }
  }, []);

  // When the dialog opens (or re-opens for a different event), sync ALL state from
  // initialData. This is required because the EventForm is always-mounted (needed for
  // Base UI dialog animations), so useState initializers only run once with initialData=null.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!open) return;
    setIsPrivate(initialData?.is_private ?? false);
    setBookedValue(initialData?.booked === false ? "false" : "true");
    setCancellationReason(initialData?.cancellation_reason ?? "");
    setEventMode(initialData?.event_mode ?? "food_truck");
    setFeeType(initialData?.fee_type ?? "none");
    setFeeRate(initialData?.fee_rate ?? "");
    setSalesMinimum(initialData?.sales_minimum ?? "");
    setNetSales(initialData?.net_sales ?? "");
    setInvoiceRevenue(initialData?.invoice_revenue && initialData.invoice_revenue > 0 ? initialData.invoice_revenue : "");
    setFoodCost(initialData?.food_cost ?? "");
    setLaborCost(initialData?.labor_cost ?? "");
    setOtherCosts(initialData?.other_costs ?? "");
    setCityValue(initialData?.city ?? "");
    setDateValue(initialData?.event_date ?? "");
    setWeatherValue(initialData?.event_weather ?? "");
    setWeatherSuggested(false);
    setWeatherBadge(null);
    setSuggestedLat(initialData?.latitude ?? null);
    setSuggestedLon(initialData?.longitude ?? null);
    // Editing an existing event always defaults to advanced mode
    setAdvancedMode(!!initialData
      ? true
      : (typeof window !== "undefined" && localStorage.getItem("event_form_mode") === "advanced"));
    setError(null);
    setLoading(false);
  }, [open]); // intentionally omit initialData — we only want to sync when open changes

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (cityValue && dateValue) {
      debounceRef.current = setTimeout(() => {
        fetchWeatherSuggestion(cityValue, dateValue);
      }, 800);
    }
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [cityValue, dateValue, open, fetchWeatherSuggestion]);

  function toggleAdvancedMode() {
    setAdvancedMode((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        localStorage.setItem("event_form_mode", next ? "advanced" : "simple");
      }
      return next;
    });
  }

  function calcAfterFee(): number | null {
    if (feeType === "none" || feeType === "" || !netSales) return null;
    const sales = Number(netSales);
    const rate = Number(feeRate) || 0;
    const minimum = Number(salesMinimum) || 0;
    if (feeType === "flat_fee") return sales - rate;
    if (feeType === "percentage") return sales * (1 - rate / 100);
    if (feeType === "commission_with_minimum") {
      // Organizer takes the higher of: flat minimum OR percentage of gross
      const organizerTake = Math.max(minimum, sales * (rate / 100));
      return sales - organizerTake;
    }
    if (feeType === "pre_settled") return sales;
    return null;
  }

  const afterFeeAmount = calcAfterFee();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const form = new FormData(e.currentTarget);
    const data: EventFormData = {
      event_name: form.get("event_name") as string,
      event_date: dateValue || (form.get("event_date") as string),
      start_time: (form.get("start_time") as string) || undefined,
      end_time: (form.get("end_time") as string) || undefined,
      setup_time: (form.get("setup_time") as string) || undefined,
      location: (form.get("location") as string) || undefined,
      city: cityValue || (form.get("city") as string) || undefined,
      city_area: (form.get("city_area") as string) || undefined,
      booked: form.get("booked") === "true",
      is_private: form.get("is_private") === "true",
      event_type: (form.get("event_type") as string) || undefined,
      event_tier: (form.get("event_tier") as string) || undefined,
      event_weather: weatherValue || (form.get("event_weather") as string) || undefined,
      anomaly_flag: (form.get("anomaly_flag") as string) || undefined,
      event_mode: eventMode,
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
      invoice_revenue: invoiceRevenue !== "" ? Number(invoiceRevenue) : undefined,
      food_cost: foodCost !== "" ? Number(foodCost) : undefined,
      labor_cost: laborCost !== "" ? Number(laborCost) : undefined,
      other_costs: otherCosts !== "" ? Number(otherCosts) : undefined,
      notes: (form.get("notes") as string) || undefined,
      latitude: suggestedLat ?? undefined,
      longitude: suggestedLon ?? undefined,
      cancellation_reason: cancellationReason || null,
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

  const isPastEvent = dateValue < new Date().toISOString().split("T")[0];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl w-[95vw] max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <form key={open ? (initialData?.id ?? "new-event") : "closed"} onSubmit={handleSubmit} className="space-y-6">
          {/* ── Event Mode ── */}
          <div className="flex gap-1 p-1 bg-muted rounded-lg">
            <button
              type="button"
              onClick={() => setEventMode("food_truck")}
              className={`flex-1 py-1.5 px-3 rounded-md text-sm font-medium transition-colors ${
                eventMode === "food_truck"
                  ? "bg-background shadow-sm text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              🚚 Food Truck Event
            </button>
            <button
              type="button"
              onClick={() => setEventMode("catering")}
              className={`flex-1 py-1.5 px-3 rounded-md text-sm font-medium transition-colors ${
                eventMode === "catering"
                  ? "bg-violet-600 shadow-sm text-white"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              🍽️ Catering / Private
            </button>
          </div>

          {/* ── Core fields (always visible) ── */}
          <div className="space-y-4">
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
                  value={dateValue}
                  onChange={(e) => setDateValue(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="booked">Status</Label>
                <Select
                  name="booked"
                  value={cancellationReason ? "cancelled" : bookedValue}
                  onValueChange={(v) => {
                    if (v === "cancelled") {
                      setBookedValue("true");
                      setCancellationReason("weather");
                    } else {
                      setBookedValue(v ?? "true");
                      setCancellationReason("");
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue>
                      {cancellationReason ? "Cancelled" : bookedValue === "true" ? "Booked" : "Not Booked"}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Booked</SelectItem>
                    <SelectItem value="cancelled">Cancelled</SelectItem>
                    <SelectItem value="false">Not Booked</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {cancellationReason && (
                <div className="space-y-2">
                  <Label>Cancellation Reason</Label>
                  <Select
                    value={cancellationReason}
                    onValueChange={(v) => setCancellationReason(v ?? "other")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(CANCELLATION_REASONS).map(([value, label]) => (
                        <SelectItem key={value} value={value}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <div className="col-span-2 space-y-2">
                <Label htmlFor="city">City</Label>
                <Input
                  id="city"
                  name="city"
                  value={cityValue}
                  onChange={(e) => {
                    setCityValue(e.target.value);
                    setWeatherSuggested(false);
                    setWeatherBadge(null);
                  }}
                  placeholder="St. Louis"
                />
                <p className="text-xs text-muted-foreground">Used for weather adjustments and local pattern matching</p>
              </div>
              {/* Show net sales in simple mode only if past event */}
              {(!advancedMode && isPastEvent) || advancedMode ? (
                <div className="space-y-2">
                  <Label htmlFor="net_sales">
                    {eventMode === "catering" ? "On-site Sales ($)" : "Net Sales ($)"}
                  </Label>
                  <Input
                    id="net_sales"
                    name="net_sales"
                    type="number"
                    step="0.01"
                    min="0"
                    value={netSales}
                    onChange={(e) => setNetSales(e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="Enter after event"
                  />
                  {eventMode === "catering" && (
                    <p className="text-xs text-muted-foreground">POS/cash sales at the event (if any)</p>
                  )}
                </div>
              ) : null}
              {/* Invoice revenue — catering events only */}
              {eventMode === "catering" && ((!advancedMode && isPastEvent) || advancedMode) && (
                <div className="space-y-2">
                  <Label htmlFor="invoice_revenue">Invoice Amount ($)</Label>
                  <Input
                    id="invoice_revenue"
                    name="invoice_revenue"
                    type="number"
                    step="0.01"
                    min="0"
                    value={invoiceRevenue}
                    onChange={(e) => setInvoiceRevenue(e.target.value === "" ? "" : Number(e.target.value))}
                    placeholder="Client invoice total"
                  />
                  <p className="text-xs text-muted-foreground">Revenue billed to the client for this catering job</p>
                </div>
              )}
            </div>
          </div>

          {/* ── Advanced fields ── */}
          {advancedMode && (
            <>
              {/* Location details */}
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

              {/* Event details */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Event Details
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="col-span-2 flex items-center gap-2 pt-1">
                    <input type="hidden" name="is_private" value={isPrivate ? "true" : "false"} />
                    <Checkbox
                      id="is_private"
                      checked={isPrivate}
                      onCheckedChange={(checked) => setIsPrivate(checked === true)}
                    />
                    <Label htmlFor="is_private" className="cursor-pointer font-normal text-sm">
                      Keep this event private (won&apos;t appear on your public schedule)
                    </Label>
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
                    <p className="text-xs text-muted-foreground">Helps find similar past events for comparison</p>
                  </div>
                </div>
              </div>

              {/* Crowd & Competition */}
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
                    <p className="text-xs text-muted-foreground">Refines the forecast when crowd size differs from your average</p>
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
                <div className="grid grid-cols-[2fr_1fr_1fr] gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="fee_type">Fee Type</Label>
                    <Select
                      name="fee_type"
                      value={feeType}
                      onValueChange={(value) => setFeeType(value ?? "none")}
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
                    {feeType !== "none" && feeType !== "" && (
                      <p className="text-xs text-muted-foreground">We&apos;ll calculate your take-home automatically</p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="fee_rate">Fee Rate ($/%)</Label>
                    <Input
                      id="fee_rate"
                      name="fee_rate"
                      type="number"
                      step="0.01"
                      min="0"
                      value={feeRate}
                      onChange={(e) => setFeeRate(e.target.value === "" ? "" : Number(e.target.value))}
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
                      value={salesMinimum}
                      onChange={(e) => setSalesMinimum(e.target.value === "" ? "" : Number(e.target.value))}
                    />
                  </div>
                </div>
                {afterFeeAmount !== null && (
                  <div className="rounded bg-muted p-2 text-sm">
                    Est. take-home: <span className="font-semibold text-green-700 dark:text-green-400">
                      ${afterFeeAmount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  </div>
                )}
              </div>

              {/* Event Costs */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Event Costs
                </h3>
                <div className="grid grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="food_cost">Food Cost ($)</Label>
                    <Input
                      id="food_cost"
                      name="food_cost"
                      type="number"
                      step="0.01"
                      min="0"
                      value={foodCost}
                      onChange={(e) => setFoodCost(e.target.value === "" ? "" : Number(e.target.value))}
                      placeholder="0.00"
                    />
                    <p className="text-xs text-muted-foreground">Ingredients, packaging</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="labor_cost">Labor ($)</Label>
                    <Input
                      id="labor_cost"
                      name="labor_cost"
                      type="number"
                      step="0.01"
                      min="0"
                      value={laborCost}
                      onChange={(e) => setLaborCost(e.target.value === "" ? "" : Number(e.target.value))}
                      placeholder="0.00"
                    />
                    <p className="text-xs text-muted-foreground">Staff, yourself</p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="other_costs">Other ($)</Label>
                    <Input
                      id="other_costs"
                      name="other_costs"
                      type="number"
                      step="0.01"
                      min="0"
                      value={otherCosts}
                      onChange={(e) => setOtherCosts(e.target.value === "" ? "" : Number(e.target.value))}
                      placeholder="0.00"
                    />
                    <p className="text-xs text-muted-foreground">Fuel, parking, supplies</p>
                  </div>
                </div>
                {/* Live profitability preview */}
                {(foodCost !== "" || laborCost !== "" || otherCosts !== "") && (
                  (() => {
                    const totalCosts = (Number(foodCost) || 0) + (Number(laborCost) || 0) + (Number(otherCosts) || 0);
                    const baseRevenue = afterFeeAmount !== null
                      ? afterFeeAmount
                      : (netSales !== "" ? Number(netSales) : null);
                    if (baseRevenue === null || totalCosts === 0) return null;
                    const profit = baseRevenue - totalCosts;
                    const margin = baseRevenue > 0 ? (profit / baseRevenue) * 100 : null;
                    const isPositive = profit >= 0;
                    return (
                      <div className={`rounded p-2 text-sm flex items-center justify-between ${isPositive ? "bg-green-50 dark:bg-green-950/20" : "bg-red-50 dark:bg-red-950/20"}`}>
                        <span className="text-muted-foreground">
                          Est. profit after costs:
                        </span>
                        <span className={`font-semibold ${isPositive ? "text-green-700 dark:text-green-400" : "text-red-600 dark:text-red-400"}`}>
                          ${profit.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          {margin !== null && (
                            <span className="font-normal text-xs ml-1.5 opacity-70">
                              ({margin.toFixed(1)}% margin)
                            </span>
                          )}
                        </span>
                      </div>
                    );
                  })()
                )}
              </div>

              {/* Sales & Weather */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
                  Sales & Conditions
                </h3>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="event_weather">Weather</Label>
                      {weatherFetching && (
                        <span className="text-xs text-muted-foreground animate-pulse">Fetching...</span>
                      )}
                    </div>
                    <Select
                      name="event_weather"
                      value={weatherValue}
                      onValueChange={(val) => {
                        setWeatherValue(val ?? "");
                        if (weatherSuggested) {
                          setWeatherSuggested(false);
                          setWeatherBadge(null);
                        }
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select weather" />
                      </SelectTrigger>
                      <SelectContent>
                        {WEATHER_OPTIONS.map((w) => (
                          <SelectItem key={w} value={w}>
                            {w}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {weatherBadge && weatherSuggested && (
                      <Badge variant="outline" className="text-xs text-muted-foreground font-normal">
                        {weatherBadge}
                      </Badge>
                    )}
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
            </>
          )}

          {/* Simple/Advanced toggle */}
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <button
              type="button"
              onClick={toggleAdvancedMode}
              className="text-primary hover:underline underline-offset-4"
            >
              {advancedMode ? "Hide advanced options" : "Show more options →"}
            </button>
            {!advancedMode && (
              <span className="text-xs text-muted-foreground/70">
                More fields = better forecasts
              </span>
            )}
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
