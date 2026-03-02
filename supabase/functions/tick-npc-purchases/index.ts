Deno.serve(() => {
  return new Response(JSON.stringify({ ok: true, function: "tick-npc-purchases" }), {
    headers: { "Content-Type": "application/json" },
  });
});
