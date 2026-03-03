const { createClient } = require("@supabase/supabase-js");

const supabaseUrl = "https://jckniouvmenfhellqddn.supabase.co";
const serviceRoleKey = "sb_secret_PnTywXnfjv6c8TewtlAgNA_Y2nLZlwz";

const supabase = createClient(supabaseUrl, serviceRoleKey);

async function run() {
  console.log("Triggering Edge Function via HTTP...");
  
  // Try hitting the edge function
  const res = await fetch(`${supabaseUrl}/functions/v1/tick-extraction`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer sb_publishable_bVVYngkgqFokZ3xx1xXPhg_O1EcvWyN`,
      "Content-Type": "application/json"
    }
  });
  
  const text = await res.text();
  console.log("Status:", res.status);
  console.log("Response:", text);

  // Check the DB slots
  const { data } = await supabase.from("extraction_slots").select("*");
  console.log("Slots:", data);
}

run().catch(console.error);
