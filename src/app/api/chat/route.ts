import { NextRequest, NextResponse } from 'next/server';
import { runOrchestrator, getDemoResponse } from '@/lib/agents/orchestrator';
import { ChatRequest, LearnerState } from '@/types';
import { LLMProvider } from '@/lib/llm/client';
import { createDefaultLearnerState } from '@/lib/memory/learner-state';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as ChatRequest;

    // Validate required fields
    if (!body.messages || !Array.isArray(body.messages)) {
      return NextResponse.json({ error: 'messages is required' }, { status: 400 });
    }

    const learnerState: LearnerState = body.learnerState || createDefaultLearnerState();

    // Demo mode: no API key provided
    if (!body.apiKey) {
      const result = getDemoResponse(body.messages, learnerState, body.context);
      return NextResponse.json({
        content: result.content,
        agentTrail: result.agentTrail,
        intent: detectIntent(body.messages),
        demoMode: true,
      });
    }

    // Real mode: use LLM with API key
    const provider: LLMProvider = body.provider || 'volcengine';

    const { content, agentTrail } = await runOrchestrator(body.messages, {
      provider,
      apiKey: body.apiKey,
      learnerState,
      context: body.context,
    });

    return NextResponse.json({
      content,
      agentTrail,
      intent: detectIntent(body.messages),
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : 'Unknown error';
    console.error('Chat API error:', errMsg);
    return NextResponse.json(
      { error: `Internal error: ${errMsg}` },
      { status: 500 }
    );
  }
}

function detectIntent(messages: { content: string }[]): string {
  const lastMsg = messages[messages.length - 1]?.content || '';
  const lower = lastMsg.toLowerCase();

  if (lower.includes('练习') || lower.includes('做题') || lower.includes('/practice')) {
    return 'practice';
  }
  if (lower.includes('计划') || lower.includes('路径') || lower.includes('/plan')) {
    return 'plan';
  }
  if (lower.includes('提交') || lower.includes('/submit')) {
    return 'review';
  }
  return 'chat';
}
