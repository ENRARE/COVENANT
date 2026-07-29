import { z } from "zod";
import { DemoError } from "./errors.js";

export const DEMO_ACTIONS = [
  "RESET",
  "SEED",
  "RUN_DEMO",
  "GET_HEALTH",
  "GET_STATE",
] as const;

export const demoActionSchema = z.enum(DEMO_ACTIONS);
export type DemoAction = z.infer<typeof demoActionSchema>;

export function parseDemoAction(value: unknown): DemoAction {
  const result = demoActionSchema.safeParse(value);
  if (!result.success) throw new DemoError("MALFORMED_ACTION");
  return result.data;
}
