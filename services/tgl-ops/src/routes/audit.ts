// services/tgl-ops/src/routes/audit.ts
import { Router, type Request, type Response } from "express";
import { runShortFormAuditCli } from "../scripts/run-short-form-audit.js";

export const auditRouter = Router();

const handleShortFormAudit = async (req: Request, res: Response): Promise<void> => {
  const brand = (req.body?.brand || req.query?.brand || "The Growth Lab") as string;
  const domain = (req.body?.domain || req.query?.domain || "thegrowthlab.co.in") as string;

  try {
    console.log(`[Audit Route] Triggered short-form audit for: ${brand} (${domain})`);
    const result = await runShortFormAuditCli(brand, domain);
    res.status(200).json({
      ok: true,
      ...result,
    });
  } catch (err: any) {
    console.error("[Audit Route Error]", err);
    res.status(500).json({
      ok: false,
      error: err.message || String(err),
    });
  }
};

auditRouter.post("/short-form", handleShortFormAudit);
auditRouter.get("/short-form", handleShortFormAudit);
