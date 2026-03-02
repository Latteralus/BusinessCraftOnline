Deno.serve(() => {
  return new Response(JSON.stringify({ ok: true, function: "tick-manufacturing" }), {
    headers: { "Content-Type": "application/json" },
  });
});
