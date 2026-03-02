Deno.serve(() => {
  return new Response(JSON.stringify({ ok: true, function: "tick-extraction" }), {
    headers: { "Content-Type": "application/json" },
  });
});
