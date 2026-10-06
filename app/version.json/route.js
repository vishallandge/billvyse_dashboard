// The build this server is running, for components/AppUpdater.js to compare against the
// build an open tab was loaded with. Prerendered at build time, so it is answered by the
// same `.next` the server is serving — a tab is never told "new version" by a fresh build
// on disk that the running process has not restarted onto yet.
export const dynamic = 'force-static';

export function GET() {
  return Response.json({ build: process.env.NEXT_PUBLIC_APP_BUILD || '' });
}
