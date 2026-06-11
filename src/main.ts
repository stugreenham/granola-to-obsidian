import { Notice, Plugin, TFile, normalizePath } from "obsidian";
import {
  GranolaNotesSettings,
  DEFAULT_SETTINGS,
  GranolaNotesSettingTab,
  SYNC_FREQUENCY_MS,
  SYNC_TIME_RANGE_DAYS,
} from "./settings";
import { loadCredentials } from "./credentials";
import { getDocumentsSince, fetchTranscript } from "./granolaApi";
import { loadTemplate, applyTemplate, generateFilename } from "./template";
import { convertProsemirrorToMarkdown } from "./prosemirrorMarkdown";
import { convertHtmlToMarkdown } from "./htmlMarkdown";
import type { GranolaDoc, TranscriptEntry, MeetingData, Participant } from "./types";

export default class GranolaNotesPlugin extends Plugin {
  settings: GranolaNotesSettings = DEFAULT_SETTINGS;
  private isSyncing = false;
  private syncIntervalId: number | null = null;
  private ribbonIconEl: HTMLElement | null = null;

  override async onload(): Promise<void> {
    await this.loadSettings();

    this.updateRibbonIcon();

    this.addCommand({
      id: "sync-meetings",
      name: "Sync meetings from Granola",
      callback: () => void this.syncMeetings(true),
    });

    this.addCommand({
      id: "open-settings",
      name: "Open Granola Notes settings",
      callback: () => {
        const app = this.app as typeof this.app & {
          setting: { open: () => void; openTabById: (id: string) => void };
        };
        app.setting.open();
        app.setting.openTabById(this.manifest.id);
      },
    });

    this.addSettingTab(new GranolaNotesSettingTab(this.app, this));

    this.app.workspace.onLayoutReady(() => {
      if (this.settings.syncFrequency === "startup" || this.settings.syncFrequency !== "manual") {
        void this.syncMeetings();
      }
      this.setupSyncInterval();
    });
  }

  override onunload(): void {
    this.clearSyncInterval();
  }

  setupSyncInterval(): void {
    this.clearSyncInterval();
    const ms = SYNC_FREQUENCY_MS[this.settings.syncFrequency];
    if (ms) {
      this.syncIntervalId = window.setInterval(() => void this.syncMeetings(), ms);
      this.registerInterval(this.syncIntervalId);
    }
  }

  private clearSyncInterval(): void {
    if (this.syncIntervalId !== null) {
      window.clearInterval(this.syncIntervalId);
      this.syncIntervalId = null;
    }
  }

  updateRibbonIcon(): void {
    if (this.settings.showRibbonIcon && !this.ribbonIconEl) {
      this.ribbonIconEl = this.addRibbonIcon("wheat", "Sync Granola meetings", () => {
        void this.syncMeetings(true);
      });
    } else if (!this.settings.showRibbonIcon && this.ribbonIconEl) {
      this.ribbonIconEl.remove();
      this.ribbonIconEl = null;
    }
  }

  async loadSettings(): Promise<void> {
    const data = (await this.loadData()) as Partial<GranolaNotesSettings> | null;
    this.settings = { ...DEFAULT_SETTINGS, ...data };
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  async syncMeetings(manual = false): Promise<void> {
    if (this.isSyncing) {
      if (manual) new Notice("Granola sync already in progress…");
      return;
    }
    this.isSyncing = true;
    try {
      await this.doSync(manual);
    } finally {
      this.isSyncing = false;
    }
  }

  private async doSync(manual: boolean): Promise<void> {
    // ── Load credentials ───────────────────────────────────────────────────
    const { accessToken, error } = await loadCredentials();
    if (!accessToken) {
      if (manual) {
        new Notice(`Granola Notes: ${error ?? "Failed to load credentials"}`, 8000);
      } else {
        console.error("Granola Notes: credential error —", error);
      }
      return;
    }

    if (manual) new Notice("Granola Notes: syncing…");

    // ── Load template ──────────────────────────────────────────────────────
    let template: string;
    try {
      template = await loadTemplate(this.app, this.settings.templatePath);
    } catch (e) {
      new Notice(`Granola Notes: error loading template — ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    // ── Ensure destination folder exists ───────────────────────────────────
    const folderPath = normalizePath(this.settings.folderPath || DEFAULT_SETTINGS.folderPath);
    if (!this.app.vault.getAbstractFileByPath(folderPath)) {
      try {
        await this.app.vault.createFolder(folderPath);
      } catch (e) {
        new Notice(`Granola Notes: could not create folder '${folderPath}'`);
        return;
      }
    }

    // ── Build index of already-synced notes (granola_id → file) ───────────
    const existingDocs = new Map<string, TFile>();
    const folderPrefix = folderPath + "/";
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(folderPrefix)) continue;
      const cache = this.app.metadataCache.getFileCache(file);
      const id = cache?.frontmatter?.granola_id as string | undefined;
      if (id) existingDocs.set(id, file);
    }

    // ── Build email → note-title map for attendee linking ─────────────────
    const emailToNoteTitle = new Map<string, string>();
    if (this.settings.matchAttendeesByEmail) {
      for (const file of this.app.vault.getMarkdownFiles()) {
        const cache = this.app.metadataCache.getFileCache(file);
        const emails: unknown = cache?.frontmatter?.emails;
        if (Array.isArray(emails)) {
          for (const e of emails) {
            if (typeof e === "string") emailToNoteTitle.set(e.toLowerCase(), file.basename);
          }
        } else if (typeof emails === "string") {
          emailToNoteTitle.set(emails.toLowerCase(), file.basename);
        }
      }
    }

    // ── Fetch documents ────────────────────────────────────────────────────
    const daysBack = SYNC_TIME_RANGE_DAYS[this.settings.syncTimeRange];
    let docs: GranolaDoc[];
    try {
      docs = await getDocumentsSince(accessToken, daysBack);
    } catch (e) {
      new Notice(`Granola Notes: API error — ${e instanceof Error ? e.message : String(e)}`);
      return;
    }

    // ── Sync each document ─────────────────────────────────────────────────
    let created = 0;
    let updated = 0;
    let skipped = 0;

    for (const doc of docs) {
      try {
        const existingFile = existingDocs.get(doc.id);
        if (this.settings.skipExistingNotes && existingFile) {
          skipped++;
          continue;
        }

        // Skip meetings with no notes content yet
        if (!doc.last_viewed_panel?.content) {
          skipped++;
          continue;
        }

        // Optionally fetch transcript (one extra API call each)
        let transcriptEntries: TranscriptEntry[] = [];
        if (this.settings.syncTranscripts) {
          try {
            transcriptEntries = await fetchTranscript(accessToken, doc.id);
          } catch (e) {
            console.warn(`Granola Notes: transcript fetch failed for ${doc.id}`, e);
          }
        }

        const meetingData = buildMeetingData(doc, transcriptEntries);
        const content = applyTemplate(template, meetingData, emailToNoteTitle);

        if (existingFile) {
          await this.app.vault.modify(existingFile, content);
          updated++;
        } else {
          const filename = generateFilename(this.settings.filenamePattern, meetingData);
          const filePath = normalizePath(`${folderPath}/${filename}.md`);
          const newFile = await this.app.vault.create(filePath, content);
          existingDocs.set(doc.id, newFile);
          created++;
        }
      } catch (e) {
        console.error(`Granola Notes: failed to sync doc ${doc.id}`, e);
      }
    }

    // ── Report ─────────────────────────────────────────────────────────────
    if (manual) {
      if (this.settings.skipExistingNotes) {
        new Notice(
          `Granola Notes: ${created} new meeting${created !== 1 ? "s" : ""} synced` +
          (skipped > 0 ? ` (${skipped} skipped)` : "")
        );
      } else {
        new Notice(
          `Granola Notes: ${created} created, ${updated} updated` +
          (skipped > 0 ? `, ${skipped} skipped` : "")
        );
      }
    }
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────

function buildMeetingData(doc: GranolaDoc, transcriptEntries: TranscriptEntry[]): MeetingData {
  const createdAt = doc.created_at ?? new Date().toISOString();
  const updatedAt = doc.updated_at ?? createdAt;
  const startDate = new Date(createdAt);

  const content = doc.last_viewed_panel?.content;
  let enhancedNotes = "";
  if (content) {
    if (typeof content === "string") {
      enhancedNotes = convertHtmlToMarkdown(content).trim();
    } else if (content && typeof content === "object" && content.type === "doc") {
      enhancedNotes = convertProsemirrorToMarkdown(content).trim();
    }
  }

  const participants: Participant[] = (doc.people?.attendees ?? []).map((a) => ({
    name: a.name ?? "",
    email: a.email ?? "",
  }));

  return {
    granola_id: doc.id,
    granola_title: doc.title?.trim() || "Untitled Meeting",
    granola_date: formatDate(startDate),
    granola_created: createdAt,
    granola_updated: updatedAt,
    granola_start_time: formatTime(startDate),
    granola_end_time: "",
    granola_duration: "",
    granola_url: `https://notes.granola.ai/d/${doc.id}`,
    granola_enhanced_notes: enhancedNotes,
    granola_private_notes: doc.notes_markdown?.trim() ?? "",
    granola_transcript: formatTranscript(transcriptEntries),
    participants,
  };
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function formatTime(d: Date): string {
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${ampm}`;
}

function formatIsoTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, "0");
  const ampm = hours >= 12 ? "PM" : "AM";
  hours = hours % 12 || 12;
  return `${hours}:${minutes} ${ampm}`;
}

function formatTranscript(entries: TranscriptEntry[]): string {
  if (entries.length === 0) return "";

  return entries
    .filter((e) => e.text?.trim())
    .map((e) => {
      const speaker = e.source === "microphone" ? "You" : (e.detected_speaker_name || "Them");
      const ts = e.start_timestamp ? ` (${formatIsoTime(e.start_timestamp)})` : "";
      return `${speaker}${ts}: ${e.text.trim()}`;
    })
    .join("\n");
}
