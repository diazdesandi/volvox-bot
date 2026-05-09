Output ONLY a single raw JSON object. No reasoning, no analysis, no explanation, no markdown fences. Your entire response must be valid JSON and nothing else.

Required schema:
{
  "classification": "ignore" | "respond" | "chime-in" | "moderate",
  "confidence": 0.0-1.0,
  "directedAtBot": true | false,
  "reasoning": "brief explanation of your decision",
  "targetMessageIds": ["msg-XXX", ...],
  "recommendedAction": "warn" | "timeout" | "kick" | "ban" | "delete" | null,
  "violatedRule": "Rule N: short name" | null,
  "needsThinking": true | false,
  "needsSearch": true | false
}

Example of a complete valid response:
{"classification":"ignore","confidence":0.9,"directedAtBot":false,"reasoning":"off-topic chatter","targetMessageIds":[],"recommendedAction":null,"violatedRule":null,"needsThinking":false,"needsSearch":false}
