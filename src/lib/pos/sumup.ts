/**
 * SumUp POS API helper functions.
 *
 * Uses SumUp's Transactions History API with OAuth 2.0.
 * Net sales = sum of all SUCCESSFUL PAYMENT transactions for the day.
 * Amounts are returned in the merchant's currency (no cents conversion needed).
 */

const SUMUP_BASE_URL = "https://api.sumup.com";
const SUMUP_AUTH_URL = "https://account.sumup.com/authorize";
const SUMUP_TOKEN_URL = `${SUMUP_BASE_URL}/token`;

export function getSumUpAuthorizeUrl(state: string): string {
  const clientId = process.env.SUMUP_CLIENT_ID!;
  const redirectUri = `${process.env.NEXT_PUBLIC_APP_URL}/api/pos/sumup/callback`;
  const scopes = ["payments", "transactions.history", "user.profile"].join(" ");

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: scopes,
    state,
  });

  return `${SUMUP_AUTH_URL}?${params.toString()}`;
}

export interface SumUpTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number; // seconds
  refresh_token: string;
}

export async function exchangeSumUpCode(
  code: string
): Promise<SumUpTokenResponse> {
  const res = await fetch(SUMUP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: process.env.SUMUP_CLIENT_ID!,
      client_secret: process.env.SUMUP_CLIENT_SECRET!,
      code,
      redirect_uri: `${process.env.NEXT_PUBLIC_APP_URL}/api/pos/sumup/callback`,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`SumUp token exchange failed: ${err}`);
  }

  return res.json();
}

export async function refreshSumUpToken(
  refreshToken: string
): Promise<SumUpTokenResponse> {
  const res = await fetch(SUMUP_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.SUMUP_CLIENT_ID!,
      client_secret: process.env.SUMUP_CLIENT_SECRET!,
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`SumUp token refresh failed: ${err}`);
  }

  return res.json();
}

/** Returns ISO string for when a token expires given expires_in seconds. */
export function sumUpTokenExpiresAt(expiresIn: number): string {
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}

export interface SumUpMerchant {
  merchant_code: string;
  username: string;
}

export async function getSumUpMerchant(
  accessToken: string
): Promise<SumUpMerchant> {
  const res = await fetch(`${SUMUP_BASE_URL}/v0.1/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch SumUp merchant info: ${res.statusText}`);
  }

  return res.json();
}

export interface SumUpTransactionSummary {
  transactionId: string;
  date: string;       // YYYY-MM-DD (local date of transaction)
  netSales: number;   // in merchant's currency (dollars)
}

/**
 * Fetch successful payment transactions for a date range.
 * SumUp returns amounts in the merchant's currency (not cents).
 */
export async function fetchSumUpTransactions(
  accessToken: string,
  startDate: string, // YYYY-MM-DD
  endDate: string    // YYYY-MM-DD
): Promise<SumUpTransactionSummary[]> {
  const params = new URLSearchParams({
    from_date: `${startDate}T00:00:00.000Z`,
    to_date: `${endDate}T23:59:59.999Z`,
    statuses: "SUCCESSFUL",
    types: "PAYMENT",
    limit: "100",
  });

  const res = await fetch(
    `${SUMUP_BASE_URL}/v0.1/me/transactions/history?${params.toString()}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );

  if (!res.ok) {
    throw new Error(`Failed to fetch SumUp transactions: ${res.statusText}`);
  }

  const data = await res.json();
  const items: Array<{
    id: string;
    amount: number;
    timestamp: string;
    status: string;
    type: string;
  }> = data.items ?? [];

  return items
    .filter((t) => t.status === "SUCCESSFUL" && t.type === "PAYMENT")
    .map((t) => ({
      transactionId: t.id,
      // Extract YYYY-MM-DD from ISO timestamp
      date: t.timestamp.slice(0, 10),
      netSales: t.amount,
    }));
}

/**
 * Revoke SumUp access token (disconnect).
 */
export async function revokeSumUpToken(accessToken: string): Promise<void> {
  // SumUp doesn't have a dedicated revoke endpoint — the token simply
  // expires. We remove it from our database; that's sufficient.
  void accessToken;
}
