// Throwaway test route — hit /api/sentry-test in the browser to fire
// an unhandled server-side error that Sentry's onRequestError hook
// will capture. Used to flip a freshly-wired Sentry project off the
// 'Set up the SDK' empty state and into the Issues view.
//
// Delete this file once a test event is confirmed in Sentry.

export async function GET() {
  throw new Error(
    "Sentry wiring smoke test — fired from /api/sentry-test on " +
      new Date().toISOString()
  );
}
