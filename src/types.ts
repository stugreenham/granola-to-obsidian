export interface ProseMirrorNode {
  type: string;
  content?: ProseMirrorNode[];
  text?: string;
  attrs?: { [key: string]: unknown };
}

export interface ProseMirrorDoc {
  type: "doc";
  content: ProseMirrorNode[];
}

export interface GranolaDoc {
  id: string;
  title: string | null;
  created_at?: string;
  updated_at?: string;
  deleted_at?: string | null;
  people?: {
    attendees?: Array<{
      name?: string;
      email?: string;
    }>;
  };
  last_viewed_panel?: {
    content?: ProseMirrorDoc | string | null;
    updated_at?: string | null;
  } | null;
  notes_markdown?: string;
}

export interface TranscriptWord {
  word: string;
  start_time?: number;
  end_time?: number;
}

export interface TranscriptEntry {
  source: string;
  speaker?: string;
  start_time?: number;
  end_time?: number;
  words: TranscriptWord[];
}

export interface Participant {
  name: string;
  email: string;
}

export interface MeetingData {
  granola_id: string;
  granola_title: string;
  granola_date: string;
  granola_created: string;
  granola_updated: string;
  granola_start_time: string;
  granola_end_time: string;
  granola_duration: string;
  granola_url: string;
  granola_enhanced_notes: string;
  granola_private_notes: string;
  granola_transcript: string;
  participants: Participant[];
}
