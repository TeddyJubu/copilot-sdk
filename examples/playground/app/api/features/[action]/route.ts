import { handleLabRequest } from "@/lib/feature-lab/server";
export const runtime = "nodejs";
export const maxDuration = 180;
type Context = { params: Promise<{ action: string }> };
export async function POST(request: Request, context: Context) {
  return handleLabRequest(request, (await context.params).action);
}
export async function GET(request: Request, context: Context) {
  return handleLabRequest(request, (await context.params).action);
}
