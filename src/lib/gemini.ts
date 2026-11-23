import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';
import {
  listCalendarEvents,
  listMailMessages,
  listMapLocations,
  listMeetSessions,
  listNotes,
  listTasks,
  listWorkspaceRecords,
} from '../db/queries.ts';

export type SupportedGeminiModel = 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite';

export const ALLOWED_GEMINI_MODELS: SupportedGeminiModel[] = [
  'gemini-4-hydrogen',
  'gemini-3.1-flash-lite',
];

export function normalizeGeminiModel(model?: string): SupportedGeminiModel {
  if (model === 'gemini-3.1-flash-lite') {
    return 'gemini-3.1-flash-lite';
  }
  return 'gemini-4-hydrogen';
}

function getGenAIClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured. Please check Settings > Secrets in AI Studio.'
    );
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

export function formatGeminiError(error: unknown): { status: number; message: string } {
  const raw = error instanceof Error ? error.message : String(error);
  const statusMatch = (error as { status?: number })?.status;

  if (
    raw.includes('GEMINI_API_KEY is not configured') ||
    raw.includes('API_KEY_INVALID') ||
    raw.includes('PERMISSION_DENIED') ||
    statusMatch === 403
  ) {
    return {
      status: 403,
      message:
        'Gemini API access could not be authorized. Verify your Gemini API key in Settings > Secrets.',
    };
  }
  if (raw.includes('RESOURCE_EXHAUSTED') || statusMatch === 429) {
    return {
      status: 429,
      message:
        'Gemini API quota reached. Please wait briefly or select a billing-enabled key in Settings > Secrets.',
    };
  }
  if (raw.includes('NOT_FOUND') || statusMatch === 404) {
    return {
      status: 404,
      message: 'Requested Gemini model was not found. Falling back to Gemini 4 Hydrogen is recommended.',
    };
  }
  return {
    status: 500,
    message: raw || 'Gemini API request failed.',
  };
}

export async function buildWorkspaceContext(userId: number): Promise<{
  contextText: string;
  contextRefs: string[];
}> {
  const [records, events, mails, taskList, noteList, locations, meets] = await Promise.all([
    listWorkspaceRecords(userId, undefined, false),
    listCalendarEvents(userId),
    listMailMessages(userId),
    listTasks(userId),
    listNotes(userId),
    listMapLocations(userId),
    listMeetSessions(userId),
  ]);

  const refs: string[] = [];
  const sections: string[] = [];

  if (records.length > 0) {
    refs.push(`Drive/Docs/Sheets (${records.length})`);
    sections.push(
      'WORKSPACE FILES (Drive, Docs, Sheets, Slides, Forms):\n' +
        records
          .slice(0, 12)
          .map(
            (r) =>
              `- [${r.service.toUpperCase()}] "${r.title}" — ${r.summary || 'No summary'} (Updated ${new Date(r.updatedAt).toISOString().slice(0, 10)})`
          )
          .join('\n')
    );
  }

  if (events.length > 0) {
    refs.push(`Calendar (${events.length})`);
    sections.push(
      'CALENDAR EVENTS:\n' +
        events
          .slice(0, 10)
          .map(
            (e) =>
              `- "${e.title}" from ${new Date(e.startTime).toISOString()} to ${new Date(e.endTime).toISOString()}${e.location ? ` @ ${e.location}` : ''}${e.meetLink ? ` [Meet attached]` : ''}`
          )
          .join('\n')
    );
  }

  if (mails.length > 0) {
    refs.push(`Gmail (${mails.length})`);
    sections.push(
      'RECENT GMAIL MESSAGES:\n' +
        mails
          .slice(0, 10)
          .map(
            (m) =>
              `- [${m.isUnread ? 'UNREAD' : 'READ'}] From: ${m.fromEmail} | Subject: "${m.subject}" | Snippet: ${m.snippet}`
          )
          .join('\n')
    );
  }

  if (taskList.length > 0) {
    refs.push(`Tasks (${taskList.length})`);
    sections.push(
      'TASKS:\n' +
        taskList
          .slice(0, 15)
          .map(
            (t) =>
              `- [${t.status === 'completed' ? 'DONE' : 'TODO'} | ${t.priority}] ${t.title}${t.dueDate ? ` (Due ${t.dueDate})` : ''}`
          )
          .join('\n')
    );
  }

  if (noteList.length > 0) {
    refs.push(`Keep Notes (${noteList.length})`);
    sections.push(
      'KEEP NOTES & CHECKLISTS:\n' +
        noteList
          .slice(0, 10)
          .map((n) => {
            const checklistStr =
              n.checklist.length > 0
                ? ` Checklist: ${n.checklist.map((c) => `[${c.checked ? 'x' : ' '}] ${c.text}`).join('; ')}`
                : '';
            return `- "${n.title || 'Untitled Note'}": ${n.content.slice(0, 200)}${checklistStr}`;
          })
          .join('\n')
    );
  }

  if (locations.length > 0) {
    refs.push(`Maps (${locations.length})`);
    sections.push(
      'SAVED MAP LOCATIONS:\n' +
        locations
          .slice(0, 10)
          .map((l) => `- [${l.category}] ${l.name} (${l.address}) [${l.lat.toFixed(4)}, ${l.lng.toFixed(4)}]`)
          .join('\n')
    );
  }

  if (meets.length > 0) {
    refs.push(`Meet (${meets.length})`);
    sections.push(
      'MEET SESSIONS:\n' +
        meets
          .slice(0, 6)
          .map((m) => `- "${m.title}" (Code: ${m.meetingCode || 'N/A'}, Status: ${m.status})`)
          .join('\n')
    );
  }

  if (sections.length === 0) {
    return {
      contextText: 'No synced workspace records are currently stored in Cloud SQL for this account.',
      contextRefs: [],
    };
  }

  return {
    contextText: sections.join('\n\n'),
    contextRefs: refs,
  };
}

export async function streamWorkspaceGeminiReply(params: {
  model: SupportedGeminiModel;
  history: Array<{ role: 'user' | 'model'; content: string }>;
  userPrompt: string;
  userDisplayName: string;
  userEmail: string;
  workspaceContext?: string;
  onChunk: (deltaText: string) => void;
}): Promise<string> {
  const ai = getGenAIClient();

  const systemParts = [
    'You are Google Gemini integrated inside Google Unite, a unified workspace platform connecting Google Drive, Docs, Sheets, Slides, Forms, Gmail, Calendar, Meet, Tasks, Keep Notes, Team Chat, and Google Maps.',
    `Current user: ${params.userDisplayName} (${params.userEmail}). Current timestamp: ${new Date().toISOString()}.`,
    'Be concise, structured, accurate, and actionable. Format responses cleanly in plain readable markdown (short headings, bullet lists, clear priorities). Never fabricate emails, files, events, or coordinates that are not present in the provided workspace context.',
  ];

  if (params.workspaceContext) {
    systemParts.push(
      'LIVE CLOUD SQL WORKSPACE CONTEXT FOR THIS USER:\n' + params.workspaceContext
    );
  }

  const contents = [
    ...params.history.slice(-16).map((m) => ({
      role: m.role,
      parts: [{ text: m.content }],
    })),
    {
      role: 'user' as const,
      parts: [{ text: params.userPrompt }],
    },
  ];

  const config: Record<string, unknown> = {
    systemInstruction: systemParts.join('\n\n'),
  };

  if (params.model === 'gemini-3.1-flash-lite') {
    config.thinkingConfig = { thinkingLevel: ThinkingLevel.LOW };
  }

  const stream = await ai.models.generateContentStream({
    model: params.model,
    contents,
    config,
  });

  let fullText = '';
  for await (const chunk of stream) {
    const piece = chunk.text ?? '';
    if (piece) {
      fullText += piece;
      params.onChunk(piece);
    }
  }

  return fullText.trim();
}

export interface ExtractedActionPlan {
  noteTitle: string;
  noteSummary: string;
  tasks: Array<{
    title: string;
    priority: 'high' | 'medium' | 'low';
    notes: string;
  }>;
}

export async function extractStructuredWorkspaceActions(params: {
  sourceText: string;
  workspaceContext?: string;
}): Promise<ExtractedActionPlan> {
  const ai = getGenAIClient();

  const prompt = [
    'Analyze the following conversation or workspace summary and extract concrete, prioritized action items and a concise Keep checklist summary.',
    params.workspaceContext ? `Workspace Context:\n${params.workspaceContext}\n` : '',
    `Source Content:\n${params.sourceText}`,
  ]
    .filter(Boolean)
    .join('\n\n');

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: prompt,
    config: {
      systemInstruction:
        'Extract crisp, executable workspace tasks (max 6) and a short Keep note summary from the provided text.',
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          noteTitle: {
            type: Type.STRING,
            description: 'Short descriptive title for a Keep checklist note.',
          },
          noteSummary: {
            type: Type.STRING,
            description: 'One-paragraph executive summary for the Keep note.',
          },
          tasks: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                title: {
                  type: Type.STRING,
                  description: 'Actionable task title under 100 characters.',
                },
                priority: {
                  type: Type.STRING,
                  description: 'Must be one of: high, medium, low.',
                },
                notes: {
                  type: Type.STRING,
                  description: 'Brief context or next step.',
                },
              },
              required: ['title', 'priority', 'notes'],
            },
          },
        },
        required: ['noteTitle', 'noteSummary', 'tasks'],
      },
    },
  });

  const parsed = JSON.parse((response.text ?? '{}').trim() || '{}') as Partial<ExtractedActionPlan>;
  const safeTasks = Array.isArray(parsed.tasks)
    ? parsed.tasks.slice(0, 6).map((t) => ({
        title: String(t.title || 'Follow-up task').slice(0, 200),
        priority: (['high', 'medium', 'low'].includes(String(t.priority))
          ? t.priority
          : 'medium') as 'high' | 'medium' | 'low',
        notes: String(t.notes || '').slice(0, 500),
      }))
    : [];

  return {
    noteTitle: String(parsed.noteTitle || 'Gemini Action Brief').slice(0, 160),
    noteSummary: String(parsed.noteSummary || '').slice(0, 1200),
    tasks: safeTasks,
  };
}
