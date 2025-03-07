import { serve } from "https://deno.land/std@0.192.0/http/server.ts";

serve((req) => {
  return new Response("Hello World! Queue System is coming soon.", {
    headers: { "content-type": "text/plain" },
  });
}); 