import { App, PluginSettingTab, Setting } from "obsidian";
import type GranolaNotesPlugin from "./main";

export type SyncFrequency = "manual" | "startup" | "15m" | "30m" | "60m" | "12h";
export type SyncTimeRange = "this_week" | "last_week" | "last_30_days" | "last_90_days";

const SYNC_FREQUENCY_LABELS: Record<SyncFrequency, string> = {
  manual: "Manual only",
  startup: "On startup only",
  "15m": "Every 15 minutes",
  "30m": "Every 30 minutes",
  "60m": "Every hour",
  "12h": "Every 12 hours",
};

export const SYNC_FREQUENCY_MS: Record<SyncFrequency, number | null> = {
  manual: null,
  startup: null,
  "15m": 15 * 60 * 1000,
  "30m": 30 * 60 * 1000,
  "60m": 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
};

const SYNC_TIME_RANGE_LABELS: Record<SyncTimeRange, string> = {
  this_week: "This week",
  last_week: "Last week (7 days)",
  last_30_days: "Last 30 days",
  last_90_days: "Last 90 days",
};

export const SYNC_TIME_RANGE_DAYS: Record<SyncTimeRange, number> = {
  this_week: 7,
  last_week: 7,
  last_30_days: 30,
  last_90_days: 90,
};

export interface GranolaNotesSettings {
  folderPath: string;
  filenamePattern: string;
  templatePath: string;
  syncFrequency: SyncFrequency;
  syncTimeRange: SyncTimeRange;
  syncTranscripts: boolean;
  skipExistingNotes: boolean;
  matchAttendeesByEmail: boolean;
  showRibbonIcon: boolean;
}

export const DEFAULT_SETTINGS: GranolaNotesSettings = {
  folderPath: "Meetings",
  filenamePattern: "{date} {title}",
  templatePath: "Templates/granola-meeting.md",
  syncFrequency: "manual",
  syncTimeRange: "last_30_days",
  syncTranscripts: false,
  skipExistingNotes: true,
  matchAttendeesByEmail: true,
  showRibbonIcon: true,
};

export class GranolaNotesSettingTab extends PluginSettingTab {
  plugin: GranolaNotesPlugin;

  constructor(app: App, plugin: GranolaNotesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  override display(): void {
    const { containerEl } = this;
    containerEl.empty();

    // ── Sync ────────────────────────────────────────────────────────────────

    new Setting(containerEl).setName("Sync").setHeading();

    new Setting(containerEl)
      .setName("Sync now")
      .setDesc("Immediately fetch new meetings from Granola")
      .addButton((btn) =>
        btn
          .setButtonText("Sync now")
          .setCta()
          .onClick(() => void this.plugin.syncMeetings(true))
      );

    new Setting(containerEl)
      .setName("Automatic sync")
      .setDesc("How often to sync in the background")
      .addDropdown((dd) => {
        for (const [value, label] of Object.entries(SYNC_FREQUENCY_LABELS)) {
          dd.addOption(value, label);
        }
        dd.setValue(this.plugin.settings.syncFrequency).onChange(async (value) => {
          this.plugin.settings.syncFrequency = value as SyncFrequency;
          await this.plugin.saveSettings();
          this.plugin.setupSyncInterval();
        });
      });

    new Setting(containerEl)
      .setName("Time range")
      .setDesc("How far back to look for meetings when syncing")
      .addDropdown((dd) => {
        for (const [value, label] of Object.entries(SYNC_TIME_RANGE_LABELS)) {
          dd.addOption(value, label);
        }
        dd.setValue(this.plugin.settings.syncTimeRange).onChange(async (value) => {
          this.plugin.settings.syncTimeRange = value as SyncTimeRange;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Sync transcripts")
      .setDesc(
        "Include full meeting transcripts in notes. Requires one extra API call per meeting."
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.syncTranscripts).onChange(async (value) => {
          this.plugin.settings.syncTranscripts = value;
          await this.plugin.saveSettings();
        })
      );

    // ── Notes ────────────────────────────────────────────────────────────────

    new Setting(containerEl).setName("Notes").setHeading();

    new Setting(containerEl)
      .setName("Folder path")
      .setDesc("Vault folder where meeting notes are saved")
      .addText((text) =>
        text
          .setPlaceholder("Meetings")
          .setValue(this.plugin.settings.folderPath)
          .onChange(async (value) => {
            this.plugin.settings.folderPath = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Filename pattern")
      .setDesc("Placeholders: {date}, {title}, {id}")
      .addText((text) =>
        text
          .setPlaceholder("{date} {title}")
          .setValue(this.plugin.settings.filenamePattern)
          .onChange(async (value) => {
            this.plugin.settings.filenamePattern = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Template path")
      .setDesc(
        "Path to a Markdown template in your vault. Created with defaults if it doesn't exist. " +
        "Available variables: {{granola_id}}, {{granola_title}}, {{granola_date}}, " +
        "{{granola_created}}, {{granola_updated}}, {{granola_start_time}}, " +
        "{{granola_url}}, {{granola_enhanced_notes}}, {{granola_private_notes}}, " +
        "{{granola_transcript}}, {{granola_attendees}}, {{granola_attendees_linked}}, " +
        "{{granola_attendees_list}}, {{granola_attendees_linked_list}}. " +
        "Wrap in {{#var}}…{{/var}} for conditional blocks."
      )
      .addText((text) =>
        text
          .setPlaceholder("Templates/granola-meeting.md")
          .setValue(this.plugin.settings.templatePath)
          .onChange(async (value) => {
            this.plugin.settings.templatePath = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Skip existing notes")
      .setDesc(
        "When on, notes already in the folder are left untouched. " +
        "Turn off to overwrite notes when meeting content changes in Granola."
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.skipExistingNotes).onChange(async (value) => {
          this.plugin.settings.skipExistingNotes = value;
          await this.plugin.saveSettings();
        })
      );

    new Setting(containerEl)
      .setName("Match attendees by email")
      .setDesc(
        "Link attendees to existing vault notes whose frontmatter has a matching 'emails' property. " +
        "Matched notes are used with [[wiki-link]] syntax in templates."
      )
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.matchAttendeesByEmail).onChange(async (value) => {
          this.plugin.settings.matchAttendeesByEmail = value;
          await this.plugin.saveSettings();
        })
      );

    // ── UI ────────────────────────────────────────────────────────────────

    new Setting(containerEl).setName("Interface").setHeading();

    new Setting(containerEl)
      .setName("Show ribbon icon")
      .setDesc("Show a sync button in the left sidebar")
      .addToggle((toggle) =>
        toggle.setValue(this.plugin.settings.showRibbonIcon).onChange(async (value) => {
          this.plugin.settings.showRibbonIcon = value;
          await this.plugin.saveSettings();
          this.plugin.updateRibbonIcon();
        })
      );
  }
}
