const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const tickSecret = process.env.TICK_FUNCTION_SECRET;

if (!supabaseUrl || !anonKey || !serviceRoleKey || !tickSecret) {
  throw new Error(
    "Missing NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, or TICK_FUNCTION_SECRET."
  );
}

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function run() {
  console.log("Triggering tick-extraction via HTTP...");

  const res = await fetch(`${supabaseUrl}/functions/v1/tick-extraction`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${anonKey}`,
      "Content-Type": "application/json",
      "x-tick-secret": tickSecret,
    },
  });

  const text = await res.text();
  console.log("Status:", res.status);
  console.log("Response:", text);

  const { data, error } = await supabase
    .from("tick_run_logs")
    .select("tick_name,status,started_at,metrics,error_message")
    .eq("tick_name", "tick-extraction")
    .order("started_at", { ascending: false })
    .limit(5);

  if (error) throw error;
  console.log("Recent extraction logs:", data);
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
