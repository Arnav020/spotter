import { NextResponse } from "next/server";
import { isConfigured, MOCK, MODELS, spendStatus } from "@/lib/nebius";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({
    tokenFactory: isConfigured(),
    mock: MOCK,
    tavily: Boolean(process.env.TAVILY_API_KEY),
    models: MODELS,
    spend: spendStatus(),
  });
}
