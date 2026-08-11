export default async function handler(req: any, res: any) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const payload = req.body || {};

  console.log("triggerWorkflowRun invoked", payload);

  return res.status(200).json({
    ok: true,
    received: payload,
  });
}