/**
 * Square POS API helper functions.
 *
 * Uses Square's Orders API via REST. OAuth 2.0 for authentication.
 * Net sales calc: (total_money - total_tax_money - total_tip_money) / 100
 */

const SQUARE_BASE_URL = "https://connect.squareup.com";
const SQUARE_API_VERSION = "2024-01-18";

export function getSquareAuthorizeUrl(state: string): string {
  const clientId = process.env.SQUARE_APP_ID!;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/pos/square/callback`;
  const scopes = [
    "ORDERS_READ",
    "MERCHANT_PROFILE_READ",
    "ITEMS_READ",
  ].join("+");

  return (
    `${SQUARE_BASE_URL}/oauth2/authorize` +
    `?client_id=${clientId}` +
    `&scope=${scopes}` +
    `&session=false` +
    `&state=${state}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}`
  );
}

export interface SquareTokenResponse {
  access_token: string;
  token_type: string;
  expires_at: string;
  merchant_id: string;
  refresh_token: string;
}

export async function exchangeSquareCode(
  code: string
): Promise<SquareTokenResponse> {
  const res = await fetch(`${SQUARE_BASE_URL}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.SQUARE_APP_ID,
      client_secret: process.env.SQUARE_APP_SECRET,
      code,
      grant_type: "authorization_code",
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/pos/square/callback`,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Square token exchange failed: ${err}`);
  }

  return res.json();
}

export async function refreshSquareToken(
  refreshToken: string
): Promise<SquareTokenResponse> {
  const res = await fetch(`${SQUARE_BASE_URL}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.SQUARE_APP_ID,
      client_secret: process.env.SQUARE_APP_SECRET,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Square token refresh failed: ${err}`);
  }

  return res.json();
}

export interface SquareLocation {
  id: string;
  name: string;
  status: string;
}

export async function listSquareLocations(
  accessToken: string
): Promise<SquareLocation[]> {
  const res = await fetch(`${SQUARE_BASE_URL}/v2/locations`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Square-Version": SQUARE_API_VERSION,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Failed to list Square locations: ${res.statusText}`);
  }

  const data = await res.json();
  return (data.locations ?? []).map(
    (loc: { id: string; name: string; status: string }) => ({
      id: loc.id,
      name: loc.name,
      status: loc.status,
    })
  );
}

export interface SquareOrderSummary {
  orderId: string;
  locationId: string;
  createdAt: string;
  totalMoney: number; // in cents
  totalTaxMoney: number;
  totalTipMoney: number;
  netSales: number; // in dollars
}

/**
 * Fetch orders for a date range from specific Square locations.
 * Returns summarized order data with net sales calculated.
 */
export async function fetchSquareOrders(
  accessToken: string,
  locationIds: string[],
  startDate: string, // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
): Promise<SquareOrderSummary[]> {
  const orders: SquareOrderSummary[] = [];
  let cursor: string | undefined;

  do {
    const body: Record<string, unknown> = {
      location_ids: locationIds,
      query: {
        filter: {
          date_time_filter: {
            created_at: {
              start_at: `${startDate}T00:00:00Z`,
              end_at: `${endDate}T23:59:59Z`,
            },
          },
          state_filter: {
            states: ["COMPLETED"],
          },
        },
        sort: {
          sort_field: "CREATED_AT",
          sort_order: "ASC",
        },
      },
      limit: 100,
    };

    if (cursor) {
      body.cursor = cursor;
    }

    const res = await fetch(`${SQUARE_BASE_URL}/v2/orders/search`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Square-Version": SQUARE_API_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch Square orders: ${res.statusText}`);
    }

    const data = await res.json();

    for (const order of data.orders ?? []) {
      const totalMoney = order.total_money?.amount ?? 0;
      const totalTaxMoney = order.total_tax_money?.amount ?? 0;
      const totalTipMoney = order.total_tip_money?.amount ?? 0;

      orders.push({
        orderId: order.id,
        locationId: order.location_id,
        createdAt: order.created_at,
        totalMoney,
        totalTaxMoney,
        totalTipMoney,
        netSales: (totalMoney - totalTaxMoney - totalTipMoney) / 100,
      });
    }

    cursor = data.cursor;
  } while (cursor);

  return orders;
}

/**
 * Revoke Square access token (disconnect).
 */
export async function revokeSquareToken(accessToken: string): Promise<void> {
  const res = await fetch(`${SQUARE_BASE_URL}/oauth2/revoke`, {
    method: "POST",
    headers: {
      Authorization: `Client ${process.env.SQUARE_APP_SECRET}`,
      "Content-Type": "application/json",
      "Square-Version": SQUARE_API_VERSION,
    },
    body: JSON.stringify({
      client_id: process.env.SQUARE_APP_ID,
      access_token: accessToken,
    }),
  });

  if (!res.ok) {
    throw new Error(`Failed to revoke Square token: ${res.statusText}`);
  }
}
