import { z } from "zod";

export const FlowNodeSchema = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["task", "decision", "start", "end"]).default("task"),
  condition: z.string().optional(),
});

export const FlowEdgeSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().optional(),
});

export const FlowSchema = z.object({
  title: z.string().optional(),
  nodes: z.array(FlowNodeSchema).min(1),
  edges: z.array(FlowEdgeSchema).optional().default([]),
});

export type Flow = z.infer<typeof FlowSchema>;

export type Text2FlowResult = {
  flow_json: Flow;
  mermaid: string;
  steps: string[];
  conditions: Array<{ condition: string; yes?: string; no?: string }>;
  dify_template: string;
  explanation: string;
  debug?: any;
};
