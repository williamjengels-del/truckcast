/**
 * Clover POS API helper functions.
 *
 * Uses Clover REST API v3. OAuth 2.0 for authentication.
 * Net sales calc mirrors Square: (total - tax - tips) converted to dollars.
 */

const CLOVER_BASE_URL =
  process.env.CLOVER_API_BASE_URL ?? "https://api.clover.com";
const CLOVER_WEB_URL =
  process.env.CLOVER_WEB_BASE_URL ?? "https://www.clover.com";

export function getCloverAuthorizeUrl(state: string): string {
  const clientId = process.env.CLOVER_APP_ID!;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/pos/clover/callback`;

  return (
    `${CLOVER_WEB_URL}/oauth/authorize` +
    `?client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&state=${state}`
  );
}

export interface CloverTokenResponse {
  access_token: string;
}

/**
 * Thrown when Clover returns 401 from a Bearer-token call. Surfaces the
 * "token expired, operator must reconnect" path distinctly from other
 * sync errors. Clover access tokens DO expire (~13 months from issue);
 * the prior comment in callback/route.ts that they "don't expire in
 * the same way" was wrong and is corrected by this PR.
 *
 * Caller should catch this and set last_sync_status = "auth_expired".
 */
export class CloverAuthExpiredError extends Error {
  readonly code = "clover_auth_expired";
  constructor(detail?: string) {
    super(`Clover token expired or invalid${detail ? `: ${detail}` : ""}`);
    this.name = "CloverAuthExpiredError";
  }
}

export async function exchangeCloverCode(
  code: string
): Promise<CloverTokenResponse> {
  const params = new URLSearchParams({
    client_id: process.env.CLOVER_APP_ID!,
    client_secret: process.env.CLOVER_APP_SECRET!,
    code,
  });

  const res = await fetch(`${CLOVER_BASE_URL}/oauth/token?${params}`, {
    method: "GET",
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Clover token exchange failed: ${err}`);
  }

  return res.json();
}

export interface CloverMerchant {
  id: string;
  name: string;
}

export async function getCloverMerchant(
  accessToken: string,
  merchantId: string
): Promise<CloverMerchant> {
  const res = await fetch(
    `${CLOVER_BASE_URL}/v3/merchants/${merchantId}`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    }
  );

  if (res.status === 401) {
    throw new CloverAuthExpiredError(`merchants/${merchantId}`);
  }
  if (!res.ok) {
    throw new Error(`Failed to get Clover merchant: ${res.statusText}`);
  }

  const data = await res.json();
  return { id: data.id, name: data.name };
}

export interface CloverOrderSummary {
  orderId: string;
  createdAt: string;
  total: number; // in cents
  taxAmount: number; // in cents
  tipAmount: number; // in cents
  netSales: number; // in dollars
}

/**
 * Fetch orders for a date range from a Clover merchant.
 * Clover timestamps are in milliseconds.
 */
export async function fetchCloverOrders(
  accessToken: string,
  merchantId: string,
  startDate: string, // YYYY-MM-DD
  endDate: string // YYYY-MM-DD
): Promise<CloverOrderSummary[]> {
  const startMs = new Date(`${startDate}T00:00:00Z`).getTime();
  const endMs = new Date(`${endDate}T23:59:59Z`).getTime();

  const orders: CloverOrderSummary[] = [];
  let offset = 0;
  const limit = 100;
  let hasMore = true;

  while (hasMore) {
    // Clover requires multiple `filter=` query params for compound
    // filters (one per condition). Building the string via
    // URLSearchParams URL-encodes the inner `&` as `%26`, collapsing
    // both conditions into ONE param value — Clover then ignores the
    // end-of-window filter and returns ALL orders since startMs.
    // Pagination then breaks because the result set is unbounded.
    // Build the query manually so each `filter=` stays separate.
    const queryString =
      `filter=${encodeURIComponent(`createdTime>=${startMs}`)}` +
      `&filter=${encodeURIComponent(`createdTime<=${endMs}`)}` +
      `&limit=${limit}` +
      `&offset=${offset}` +
      `&expand=payments`;

    const res = await fetch(
      `${CLOVER_BASE_URL}/v3/merchants/${merchantId}/orders?${queryString}`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      }
    );

    if (res.status === 401) {
      // pos-7: token expired or revoked. Surface distinctly so the
      // sync route can flag the connection as needing reconnect.
      throw new CloverAuthExpiredError(`orders pagination at offset ${offset}`);
    }
    if (!res.ok) {
      throw new Error(`Failed to fetch Clover orders: ${res.statusText}`);
    }

    const data = await res.json();
    const elements: Array<{
      id: string;
      createdTime: number;
      total: number;
      payments?: { elements?: Array<{ tipAmount?: number; taxAmount?: number }> };
    }> = data.elements ?? [];

    for (const order of elements) {
      // Sum tips and taxes from payments
      let tipAmount = 0;
      let taxAmount = 0;
      if (order.payments?.elements) {
        for (const payment of order.payments.elements) {
          tipAmount += payment.tipAmount ?? 0;
          taxAmount += payment.taxAmount ?? 0;
        }
      }

      const total = order.total ?? 0;
      orders.push({
        orderId: order.id,
        createdAt: new Date(order.createdTime).toISOString(),
        total,
        taxAmount,
        tipAmount,
        netSales: (total - taxAmount - tipAmount) / 100,
      });
    }

    hasMore = elements.length === limit;
    offset += limit;
  }

  return orders;
}

/**
 * Revoke / disconnect is done by removing the stored token.
 * Clover does not have a dedicated token revocation endpoint for third-party
 * apps, so we just delete the connection from our database.
 */
export function revokeCloverToken(): void {
  // No-op; caller deletes the DB row.
}
