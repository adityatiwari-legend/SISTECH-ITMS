"use client";

import React from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "@/lib/api";
import { formatJunction } from "@/lib/naming";

export interface AiCopilotModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialQuestion?: string;
  initialPrompt?: string;
  context?: {
    intersectionId?: string;
    emergencyId?: number;
    decisionId?: string;
    focus?: string;
  };
}

interface Message {
  role: "user" | "copilot";
  content: string;
  source?: string;
  citations?: string[];
  timestamp: string;
}

const SUGGESTED_QUESTIONS = [
  "Why is the corridor active?",
  "Why did the route change?",
  "Why is this signal green?",
  "What is causing congestion?",
  "What happens next?",
  "Explain the current emergency.",
];

export function AiCopilotModal({
  isOpen,
  onClose,
  initialQuestion,
  initialPrompt,
  context,
}: AiCopilotModalProps) {
  const [messages, setMessages] = React.useState<Message[]>([]);
  const [inputQuestion, setInputQuestion] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const messagesEndRef = React.useRef<HTMLDivElement | null>(null);

  // Auto-scroll messages
  React.useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Execute initial question if provided when opened
  React.useEffect(() => {
    const q = initialQuestion ?? initialPrompt;
    if (isOpen && q) {
      handleAsk(q);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, initialQuestion, initialPrompt]);

  const handleAsk = async (q: string) => {
    const questionText = q.trim();
    if (!questionText || loading) return;

    setError(null);
    setInputQuestion("");
    const userMsg: Message = {
      role: "user",
      content: questionText,
      timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
    };

    setMessages((prev) => [...prev, userMsg]);
    setLoading(true);

    try {
      const res = await api.askAiCopilot(questionText, context);
      const copilotMsg: Message = {
        role: "copilot",
        content: res.answer,
        source: res.source,
        citations: res.citations,
        timestamp: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }),
      };
      setMessages((prev) => [...prev, copilotMsg]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to reach dhaara AI Copilot.");
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
        {/* Backdrop */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 bg-black/75 backdrop-blur-sm"
          onClick={onClose}
        />

        {/* Modal Window */}
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 15 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 15 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="relative flex h-[620px] w-full max-w-2xl flex-col rounded-xl border border-[rgba(255,255,255,0.1)] bg-[#0A0F16] shadow-2xl overflow-hidden font-sans"
        >
          {/* Header */}
          <div className="flex h-14 shrink-0 items-center justify-between border-b border-[rgba(255,255,255,0.08)] bg-[#0E141D] px-4">
            <div className="flex items-center gap-2.5">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[rgba(139,124,255,0.15)] text-[#8B7CFF]">
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </span>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold uppercase tracking-wider text-[#F4F7FA]">
                    dhaara AI COPILOT
                  </span>
                  <span className="rounded bg-[#8B7CFF]/15 px-1.5 py-0.5 font-mono text-[9px] font-bold text-[#8B7CFF]">
                    OPERATOR ASSISTANCE
                  </span>
                </div>
                <div className="text-[11px] text-[#8D9AAA]">
                  Grounded in real-time SUMO TraCI state & decisions
                </div>
              </div>
            </div>

            {/* Close button */}
            <button
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded text-[#8D9AAA] hover:bg-[#121A24] hover:text-[#F4F7FA] transition-colors"
              title="Close Copilot"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Context Banner (if context provided) */}
          {context?.intersectionId && (
            <div className="flex items-center gap-2 border-b border-[rgba(255,255,255,0.06)] bg-[#121A24]/70 px-4 py-2 text-xs">
              <span className="font-mono text-[10px] text-[#8B7CFF] uppercase">FOCUSED INTERSECTION:</span>
              <span className="font-semibold text-[#F4F7FA]">
                {formatJunction(context.intersectionId)}
              </span>
              <span className="font-mono text-[10px] text-[#5E6B7A]">(SUMO: {context.intersectionId})</span>
            </div>
          )}

          {/* Messages Container */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
            {messages.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center text-center p-6">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[rgba(139,124,255,0.12)] text-2xl mb-3">
                  🤖
                </span>
                <span className="text-sm font-semibold text-[#F4F7FA]">
                  How can the AI Copilot assist you?
                </span>
                <p className="mt-1 max-w-sm text-xs text-[#8D9AAA] leading-relaxed">
                  Ask any question about active emergency corridors, traffic signals, congestion, or recent AI decisions. Answers cite verified live simulation state.
                </p>

                {/* Suggested questions */}
                <div className="mt-6 flex flex-wrap justify-center gap-2 max-w-md">
                  {SUGGESTED_QUESTIONS.map((q) => (
                    <button
                      key={q}
                      onClick={() => handleAsk(q)}
                      className="rounded-full border border-[rgba(255,255,255,0.08)] bg-[#0E141D] px-3 py-1.5 text-xs text-[#8D9AAA] hover:border-[#8B7CFF]/50 hover:bg-[#121A24] hover:text-[#F4F7FA] transition-all"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, idx) => (
                <div
                  key={idx}
                  className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}
                >
                  <div className="flex items-center gap-2 mb-1 px-1">
                    <span className="font-mono text-[10px] font-semibold uppercase text-[#5E6B7A]">
                      {m.role === "user" ? "Traffic Operator" : "AI Copilot"}
                    </span>
                    <span className="font-mono text-[9px] text-[#5E6B7A]">{m.timestamp}</span>
                    {m.source && (
                      <span className="rounded bg-[#8B7CFF]/10 px-1 font-mono text-[8px] font-bold text-[#8B7CFF]">
                        {m.source === "vultr_serverless" ? "VULTR LLM" : "GROUNDED ENGINE"}
                      </span>
                    )}
                  </div>

                  <div
                    className={`max-w-[85%] rounded-xl px-4 py-2.5 text-xs leading-relaxed ${
                      m.role === "user"
                        ? "bg-[#121A24] border border-[rgba(255,255,255,0.1)] text-[#F4F7FA]"
                        : "bg-[#0E141D] border border-[rgba(139,124,255,0.2)] text-[#F4F7FA]"
                    }`}
                  >
                    {m.content}

                    {/* Citations */}
                    {m.citations && m.citations.length > 0 && (
                      <div className="mt-2.5 pt-2 border-t border-[rgba(255,255,255,0.06)] flex flex-wrap gap-1.5">
                        <span className="font-mono text-[9px] text-[#5E6B7A] uppercase mr-1">Citations:</span>
                        {m.citations.map((c, cIdx) => (
                          <span
                            key={cIdx}
                            className="rounded bg-[#05070B] border border-[rgba(255,255,255,0.06)] px-1.5 py-0.5 font-mono text-[9px] text-[#8D9AAA]"
                          >
                            {c}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}

            {/* Loading Indicator */}
            {loading && (
              <div className="flex items-center gap-2 text-xs text-[#8D9AAA] p-2">
                <span className="h-2 w-2 rounded-full bg-[#8B7CFF] animate-ping" />
                <span className="font-mono text-[11px]">Analyzing live telemetry & decisions…</span>
              </div>
            )}

            {/* Error Message */}
            {error && (
              <div className="rounded-lg border border-[#FF3B4E]/30 bg-[#FF3B4E]/10 p-3 text-xs text-[#FF3B4E]">
                <div className="font-semibold uppercase tracking-wider font-mono text-[10px]">
                  AI EXPLANATION UNAVAILABLE
                </div>
                <div className="mt-0.5 text-[#8D9AAA]">
                  {error}. The live traffic system is still fully operational.
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Quick Prompts Bar (when conversation started) */}
          {messages.length > 0 && (
            <div className="flex gap-1.5 overflow-x-auto border-t border-[rgba(255,255,255,0.06)] bg-[#0E141D] px-3 py-1.5 no-scrollbar">
              {SUGGESTED_QUESTIONS.slice(0, 4).map((q) => (
                <button
                  key={q}
                  onClick={() => handleAsk(q)}
                  disabled={loading}
                  className="shrink-0 rounded border border-[rgba(255,255,255,0.06)] bg-[#0A0F16] px-2 py-1 font-mono text-[10px] text-[#8D9AAA] hover:text-[#F4F7FA] hover:border-[#8B7CFF]/40 disabled:opacity-50"
                >
                  {q}
                </button>
              ))}
            </div>
          )}

          {/* Input Footer */}
          <div className="shrink-0 border-t border-[rgba(255,255,255,0.08)] bg-[#0A0F16] p-3">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleAsk(inputQuestion);
              }}
              className="flex items-center gap-2"
            >
              <input
                type="text"
                value={inputQuestion}
                onChange={(e) => setInputQuestion(e.target.value)}
                placeholder="Ask about signals, emergency route, green corridor, or congestion..."
                disabled={loading}
                className="flex-1 rounded-lg border border-[rgba(255,255,255,0.1)] bg-[#05070B] px-3.5 py-2 text-xs text-[#F4F7FA] placeholder-[#5E6B7A] focus:border-[#8B7CFF] focus:outline-none"
              />
              <button
                type="submit"
                disabled={!inputQuestion.trim() || loading}
                className="flex items-center gap-1.5 rounded-lg bg-[#8B7CFF] px-4 py-2 font-mono text-xs font-semibold text-[#05070B] hover:bg-[#9E92FF] transition-all disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span>Ask</span>
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
                </svg>
              </button>
            </form>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
