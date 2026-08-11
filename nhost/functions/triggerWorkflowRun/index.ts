export default async function handler(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  const payload = await req.json().catch(() => ({}));
  console.log("triggerWorkflowRun invoked", payload);

  return Response.json({ ok: true, received: payload });
}
