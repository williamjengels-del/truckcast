const BUILT_AT = new Date().toISOString();

export async function GET() {
  return Response.json({
    commit: process.env.VERCEL_GIT_COMMIT_SHA ?? "unknown",
    commitRef: process.env.VERCEL_GIT_COMMIT_REF ?? "unknown",
    env: process.env.VERCEL_ENV ?? "development",
    deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? "unknown",
    builtAt: BUILT_AT,
  });
}
