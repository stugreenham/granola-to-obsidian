import { App, normalizePath, TFile } from "obsidian";
import type { MeetingData, Participant } from "./types";

// Default template installed on first use
const DEFAULT_TEMPLATE = `---
granola_id: {{granola_id}}
title: "{{granola_title}}"
date: {{granola_date}}
created: {{granola_created}}
updated: {{granola_updated}}
url: {{granola_url}}
attendees:
{{granola_attendees_linked_list}}
---

# {{granola_title}}

**Date:** {{granola_date}}
**Time:** {{granola_start_time}}
**Attendees:** {{granola_attendees_linked}}

{{#granola_enhanced_notes}}
## Notes

{{granola_enhanced_notes}}

{{/granola_enhanced_notes}}
{{#granola_private_notes}}
## Private Notes

{{granola_private_notes}}

{{/granola_private_notes}}
{{#granola_transcript}}
## Transcript

{{granola_transcript}}

{{/granola_transcript}}
`;

/**
 * Load template from vault. If the file doesn't exist, create it with the
 * default content and return that.
 */
export async function loadTemplate(app: App, templatePath: string): Promise<string> {
  if (!templatePath) return DEFAULT_TEMPLATE;

  const normalised = normalizePath(templatePath);
  const file = app.vault.getAbstractFileByPath(normalised);

  if (file instanceof TFile) {
    return await app.vault.read(file);
  }

  // Create parent folder(s) if needed
  const folder = normalised.lastIndexOf("/") > 0
    ? normalised.substring(0, normalised.lastIndexOf("/"))
    : null;
  if (folder && !app.vault.getAbstractFileByPath(folder)) {
    await app.vault.createFolder(folder);
  }

  await app.vault.create(normalised, DEFAULT_TEMPLATE);
  return DEFAULT_TEMPLATE;
}

/**
 * Resolve a participant display name.
 * If their email matches a vault note's `emails` frontmatter, use that note's title.
 */
export function resolveParticipantName(
  p: Participant,
  emailToNoteTitle: Map<string, string>
): string {
  if (p.email) {
    const match = emailToNoteTitle.get(p.email.toLowerCase());
    if (match) return match;
  }
  return p.name || p.email || "Unknown";
}

/**
 * Apply a Handlebars-lite template.
 *
 * Supported syntax:
 *   {{variable}}                    — simple substitution
 *   {{#variable}}…{{/variable}}    — conditional block (rendered only when non-empty)
 */
export function applyTemplate(
  template: string,
  data: MeetingData,
  emailToNoteTitle: Map<string, string>
): string {
  const names = data.participants.map((p) => resolveParticipantName(p, emailToNoteTitle));

  // Build the full variable map
  const vars: Record<string, string> = {
    granola_id: data.granola_id,
    granola_title: data.granola_title,
    granola_date: data.granola_date,
    granola_created: data.granola_created,
    granola_updated: data.granola_updated,
    granola_start_time: data.granola_start_time,
    granola_end_time: data.granola_end_time,
    granola_duration: data.granola_duration,
    granola_url: data.granola_url,
    granola_enhanced_notes: data.granola_enhanced_notes,
    granola_private_notes: data.granola_private_notes,
    granola_transcript: data.granola_transcript,
    granola_attendees: names.join(", "),
    granola_attendees_linked: names.map((n) => `[[${n}]]`).join(", "),
    granola_attendees_list: names.map((n) => `- ${n}`).join("\n"),
    granola_attendees_linked_list: names.map((n) => `- [[${n}]]`).join("\n"),
  };

  // Conditional blocks first
  let result = template.replace(
    /\{\{#([a-z_]+)\}\}([\s\S]*?)\{\{\/\1\}\}/g,
    (_match, varName: string, content: string) => {
      const value = vars[varName];
      return value && value.trim() ? content : "";
    }
  );

  // Simple substitution
  result = result.replace(/\{\{([a-z_]+)\}\}/g, (_match, varName: string) => {
    return vars[varName] ?? _match;
  });

  return result;
}

export function sanitizeFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|#^[\]]/g, "").slice(0, 100).trim();
}

/**
 * Generate a filename from a pattern.
 * Available placeholders: {date}, {title}, {id}
 */
export function generateFilename(pattern: string, data: MeetingData): string {
  return sanitizeFilename(
    pattern
      .replace("{date}", data.granola_date)
      .replace("{title}", data.granola_title)
      .replace("{id}", data.granola_id)
  );
}
