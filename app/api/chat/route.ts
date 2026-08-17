import { NextResponse } from 'next/server';
import { asc, eq } from 'drizzle-orm';
import { auth } from '@/lib/auth';
import { db } from '@/lib/db';
import { chatMessages } from '@/lib/db/schema';
import {
  AccessError, assertCanRead, requireOwnedDocument, resolveShareToken, sessionKeyFor,
  type Viewer,
} from '@/lib/authz';
import { getAi, CHAT_MODEL } from '@/lib/ai/gemini';
import { CHAT_SYSTEM, chatUser } from '@/lib/ai/prompts';
import { buildChatContext, trimHistory, type Message } from '@/lib/ai/retrieve';
import { chatSchema } from '@/lib/validation';
import { toErrorResponse } from '@/lib/api-error';

export const maxDuration = 60;

/**
 * Resolves the caller to a Viewer plus its document, for either entry point:
 * a guest holding a share token, or an authenticated owner.
 */
async function resolveViewer(documentId: string, shareToken?: string) {
  if (shareToken) {
    const resolved = await resolveShareToken(shareToken);
    if (!resolved || resolved.document.id !== documentId) {
      throw new AccessError(404, 'Not found');
    }
    return { viewer: resolved.viewer, doc: resolved.document };
  }

  const session = await auth();
  if (!session?.user?.id) throw new AccessError(404, 'Not found');
  const doc = await requireOwnedDocument(documentId, session.user.id);
  const viewer: Viewer = { kind: 'owner', userId: session.user.id };
  return { viewer, doc };
}

/** Prior turns for this viewer's private thread. */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const documentId = url.searchParams.get('documentId') ?? '';
    const shareToken = url.searchParams.get('shareToken') ?? undefined;

    const { viewer, doc } = await resolveViewer(documentId, shareToken);
    assertCanRead(viewer, doc);

    const rows = await db
      .select({ role: chatMessages.role, content: chatMessages.content })
      .from(chatMessages)
      .where(eq(chatMessages.sessionKey, sessionKeyFor(viewer)))
      .orderBy(asc(chatMessages.createdAt));

    return NextResponse.json({ messages: rows });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(req: Request) {
  try {
    const parsed = chatSchema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: 'Invalid request' }, { status: 400 });
    }
    const { documentId, question, shareToken } = parsed.data;

    const { viewer, doc } = await resolveViewer(documentId, shareToken);
    assertCanRead(viewer, doc);

    if (doc.hasExtractableText === false) {
      return NextResponse.json(
        { error: 'This document has no extractable text, so it cannot be queried.' },
        { status: 400 },
      );
    }
    if (doc.status !== 'ready') {
      return NextResponse.json(
        { error: 'This document is still being processed.' },
        { status: 409 },
      );
    }

    const sessionKey = sessionKeyFor(viewer);

    const priorRows = await db
      .select({ role: chatMessages.role, content: chatMessages.content })
      .from(chatMessages)
      .where(eq(chatMessages.sessionKey, sessionKey))
      .orderBy(asc(chatMessages.createdAt));

    const history = trimHistory(priorRows as Message[]);
    const context = await buildChatContext(doc, question);

    await db.insert(chatMessages).values({
      documentId, sessionKey, role: 'user', content: question,
    });

    // Gemini names the assistant role "model".
    const contents = [
      ...history.map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }],
      })),
      { role: 'user', parts: [{ text: chatUser(context, question) }] },
    ];

    const geminiStream = await getAi().models.generateContentStream({
      model: CHAT_MODEL,
      contents,
      config: {
        systemInstruction: CHAT_SYSTEM,
        temperature: 0.2,
        maxOutputTokens: 1600,
        // Thinking tokens count against maxOutputTokens and would eat the budget
        // before any visible text is produced.
        thinkingConfig: { thinkingBudget: 0 },
      },
    });

    let answer = '';
    const encoder = new TextEncoder();

    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of geminiStream) {
            const text = chunk.text ?? '';
            if (!text) continue;
            answer += text;
            controller.enqueue(encoder.encode(text));
          }
        } catch (error) {
          console.error('chat stream failed', error);
          if (!answer) {
            controller.enqueue(
              encoder.encode('The answer stream failed before producing any text. Please try again.'),
            );
          }
        } finally {
          controller.close();
          // Persist only a completed answer, so a broken stream leaves no
          // half-turn in the history to confuse the next question.
          if (answer.trim()) {
            await db
              .insert(chatMessages)
              .values({ documentId, sessionKey, role: 'assistant', content: answer })
              .catch((e) => console.error('failed to persist answer', e));
          }
        }
      },
    });

    return new Response(stream, {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        'cache-control': 'no-store',
        // Discourage proxy buffering, which would defeat token-by-token streaming.
        'x-accel-buffering': 'no',
      },
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
