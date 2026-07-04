import { NextResponse } from "next/server";

import { getTelegramBotInfo } from "@/lib/telegram-alerts";

export async function GET() {
  const info = await getTelegramBotInfo();

  return NextResponse.json(info, {
    headers: {
      "Cache-Control": "public, max-age=300, s-maxage=300",
    },
  });
}
