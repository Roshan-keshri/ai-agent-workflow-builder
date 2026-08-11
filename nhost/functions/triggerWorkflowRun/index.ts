import type { Request, Response } from "express";

export default (req: Request, res: Response) => {
  if (req.method !== "POST") {
    return res.status(405).json({
      error: "Method Not Allowed",
    });
  }

  console.log("triggerWorkflowRun invoked", req.body);

  return res.status(200).json({
    ok: true,
    received: req.body,
  });
};