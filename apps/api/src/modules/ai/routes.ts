import type { FastifyInstance } from "fastify";
import type { AiCopilotService } from "./copilot-service.ts";

const queryBodySchema = {
  type: "object",
  required: ["question"],
  properties: {
    question: { type: "string", minLength: 1, maxLength: 1000 },
    context: {
      type: "object",
      properties: {
        intersectionId: { type: "string", maxLength: 64 },
        emergencyId: { type: "integer", minimum: 1 },
        decisionId: { type: "string", maxLength: 64 },
        focus: { type: "string", maxLength: 128 },
      },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
} as const;

export async function aiRoutes(
  app: FastifyInstance,
  options: { copilotService: AiCopilotService },
): Promise<void> {
  const { copilotService } = options;

  app.post("/api/ai/copilot", { schema: { body: queryBodySchema } }, async (request) => {
    const body = request.body as {
      question: string;
      context?: {
        intersectionId?: string;
        emergencyId?: number;
        decisionId?: string;
        focus?: string;
      };
    };
    return copilotService.ask(body);
  });
}
