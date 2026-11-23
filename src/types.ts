export type NavSection =
  | 'overview'
  | 'gemini'
  | 'maps'
  | 'communications'
  | 'drive'
  | 'tasks_keep'
  | 'classroom_contacts'
  | 'chat'
  | 'admin';

export interface DbUser {
  id: number;
  uid: string;
  email: string;
  displayName: string;
  photoUrl: string;
  role: 'admin' | 'member';
  connectedServices: string[];
  lastSyncedAt: string | null;
  createdAt: string;
}

export interface WorkspaceRecord {
  id: number;
  userId: number;
  service: 'drive' | 'docs' | 'sheets' | 'slides' | 'forms';
  externalId: string;
  title: string;
  mimeType: string;
  summary: string;
  webViewLink: string;
  payload: Record<string, unknown>;
  isStarred: boolean;
  isShared: boolean;
  updatedAt: string;
  createdAt: string;
}

export interface CalendarEventRecord {
  id: number;
  userId: number;
  externalId: string;
  title: string;
  description: string;
  location: string;
  startTime: string;
  endTime: string;
  meetLink: string;
  status: string;
  updatedAt: string;
  createdAt: string;
}

export interface MailMessageRecord {
  id: number;
  userId: number;
  externalId: string;
  threadId: string;
  fromEmail: string;
  toEmail: string;
  subject: string;
  snippet: string;
  body: string;
  labels: string[];
  isUnread: boolean;
  receivedAt: string;
  createdAt: string;
}

export interface TaskRecord {
  id: number;
  userId: number;
  externalId: string;
  listId: string;
  listTitle: string;
  title: string;
  notes: string;
  dueDate: string;
  status: 'needsAction' | 'completed';
  priority: 'high' | 'medium' | 'low';
  updatedAt: string;
  createdAt: string;
}

export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

export interface NoteRecord {
  id: number;
  userId: number;
  externalId?: string;
  title: string;
  content: string;
  checklist: ChecklistItem[];
  color: string;
  isPinned: boolean;
  isShared: boolean;
  updatedAt: string;
  createdAt: string;
}

export interface ChatSpaceRecord {
  id: number;
  slug: string;
  name: string;
  description: string;
  externalSpaceName: string;
  createdByUserId: number | null;
  createdAt: string;
}

export interface ChatMessageRecord {
  id: number;
  spaceId: number;
  userId: number;
  senderName: string;
  senderEmail: string;
  content: string;
  externalMessageName: string;
  createdAt: string;
}

export interface MeetSessionRecord {
  id: number;
  userId: number;
  title: string;
  meetingUri: string;
  meetingCode: string;
  spaceName: string;
  status: string;
  scheduledFor: string | null;
  notes: string;
  createdAt: string;
}

export interface MapLocationRecord {
  id: number;
  userId: number;
  placeId: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  category: 'office' | 'client' | 'meeting' | 'logistics';
  notes: string;
  isShared: boolean;
  createdAt: string;
}

export interface AuditLogRecord {
  id: number;
  userId: number | null;
  actorEmail: string;
  action: string;
  service: string;
  detail: string;
  createdAt: string;
}

export interface PlatformStats {
  users: number;
  workspaceRecords: number;
  calendarEvents: number;
  mailMessages: number;
  tasks: number;
  notes: number;
  chatMessages: number;
  meetSessions: number;
  mapLocations: number;
  geminiThreads?: number;
  classroomCourses?: number;
  contacts?: number;
}

export interface OnlineUser {
  uid: string;
  email: string;
  displayName: string;
  role: string;
}

export interface PendingConfirmation {
  title: string;
  description: string;
  serviceLabel: string;
  confirmLabel?: string;
  isDestructive?: boolean;
  items?: string[];
  onConfirm: () => Promise<void> | void;
}

export interface GeminiThreadRecord {
  id: number;
  userId: number;
  title: string;
  model: 'gemini-4-hydrogen' | 'gemini-3.1-flash-lite';
  groundWithWorkspace: boolean;
  updatedAt: string;
  createdAt: string;
}

export interface GeminiMessageRecord {
  id: number;
  threadId: number;
  userId: number;
  role: 'user' | 'model';
  content: string;
  contextRefs: string[];
  createdAt: string;
}

export interface GeminiActionPlan {
  noteTitle: string;
  noteSummary: string;
  tasks: Array<{
    title: string;
    priority: 'high' | 'medium' | 'low';
    notes: string;
  }>;
}

export interface ClassroomCourseRecord {
  id: number;
  userId: number;
  externalId: string;
  name: string;
  section: string;
  descriptionHeading: string;
  room: string;
  courseState: string;
  alternateLink: string;
  enrollmentCode: string;
  updatedAt: string;
  createdAt: string;
}

export interface ClassroomItemRecord {
  id: number;
  courseId: number;
  userId: number;
  itemType: 'coursework' | 'announcement' | 'material';
  externalId: string;
  title: string;
  description: string;
  state: string;
  dueDate: string;
  alternateLink: string;
  materials: Array<{ title: string; url: string; type: string }>;
  updatedAt: string;
  createdAt: string;
}

export interface ContactRecord {
  id: number;
  userId: number;
  externalId: string;
  displayName: string;
  email: string;
  phone: string;
  organization: string;
  jobTitle: string;
  address: string;
  photoUrl: string;
  source: string;
  notes: string;
  isShared: boolean;
  updatedAt: string;
  createdAt: string;
}
