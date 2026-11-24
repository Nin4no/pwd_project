import "dotenv/config";
import { getSupabase, throwDatabaseError } from "../src/config/supabase";

async function main() {
  for (const table of [
    "profiles",
    "rooms",
    "showroom_posts",
    "showroom_likes",
  ] as const) {
    const { error } = await getSupabase()
      .from(table as any)
      .select("*")
      .limit(1);
    if (error) throwDatabaseError(error);
    console.log(`[Supabase] ${table} 연결 확인 성공`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
