import { Router, type Request, type Response } from "express";
import { config } from "../config.js";
import { getCurrentTimeIST, getTodayDateString } from "../lib/standup.js";

export const healthRouter = Router();

healthRouter.get("/", (_req: Request, res: Response): void => {
  res.status(200).json({
    status: "ok",
    service: "tgl-ops",
    timestamp: new Date().toISOString(),
    ist_time: `${getCurrentTimeIST()} IST`,
    date: getTodayDateString(),
    environment: {
      owner: config.githubOwner,
      repo: config.githubRepo,
      approvalsChannel: config.approvalsChannelId,
      standupChannel: config.standupChannelId,
    },
  });
});
