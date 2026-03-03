const { createClient } = require("@supabase/supabase-js");
const supabaseUrl = "https://jckniouvmenfhellqddn.supabase.co";
const serviceRoleKey = "sb_secret_PnTywXnfjv6c8TewtlAgNA_Y2nLZlwz";
const supabase = createClient(supabaseUrl, serviceRoleKey);

async function run() {
  const { data, error } = await supabase
    .from("manufacturing_jobs")
    .select("*, business:businesses!inner(name, type, player_id)")
    .eq("businesses.player_id", "7d07ce2d-067b-44eb-a100-c80a697c74d6")
    .eq("status", "active")
    .limit(1);
  
  console.log("businesses.player_id error:", error?.message);

  const { data: d2, error: e2 } = await supabase
    .from("manufacturing_jobs")
    .select("*, business:businesses!inner(name, type, player_id)")
    .eq("business.player_id", "7d07ce2d-067b-44eb-a100-c80a697c74d6")
    .eq("status", "active")
    .limit(1);
  
  console.log("business.player_id error:", e2?.message);
}
run();