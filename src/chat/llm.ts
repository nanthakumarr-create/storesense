// ============================================================================
// LLM HOOK: phraseWithLLM
// ----------------------------------------------------------------------------
// Every answer is built from engine data by answer.ts (template mode). When an
// LLM is wired in (serverless /api/chat), it may ONLY rephrase `reply.text` for
// tone: it must not add numbers, decisions or reasons that are not in the reply.
// On any error, timeout or rate limit, return the template text unchanged so the
// chat never breaks.
// ============================================================================
import type { Reply } from './answer';

export const LLM_ENABLED = false;

export async function phraseWithLLM(reply: Reply, _question: string): Promise<string> {
  if (!LLM_ENABLED) return reply.text;
  // Wiring point (later): POST { question, text: reply.text, facts: reply.sections } to /api/chat,
  // use the response only if it arrives within ~4 s, else fall back to reply.text.
  return reply.text;
}
