# Granola to Obsidian

Sync your [Granola](https://www.granola.ai) meeting notes into Obsidian with fully customisable templates.

Works on the **free tier** — transcripts included.

---

## How it works

The plugin reads your auth credentials directly from the Granola desktop app's local storage (the same encrypted file the Granola app itself uses), then calls the Granola API directly. This means:

- No MCP server required
- No paid Granola subscription required for transcripts
- Transcripts are fetched via the same API endpoint the desktop app uses

---

## Installation

This plugin is not in the Obsidian community plugins directory. Install it manually:

1. Clone or download this repository
2. Run `npm install && npm run build`
3. Copy `main.js` and `manifest.json` into your vault:

```bash
VAULT=~/path/to/your/vault
mkdir -p "$VAULT/.obsidian/plugins/obsidian-granola-archive"
cp main.js manifest.json "$VAULT/.obsidian/plugins/obsidian-granola-archive/"
```

4. In Obsidian: **Settings → Community Plugins → reload** → enable **Granola Notes**

**Requirements:**
- macOS (Windows/Linux support planned)
- The [Granola desktop app](https://www.granola.ai) installed and signed in

---

## Settings

| Setting | Default | Description |
|---|---|---|
| Folder path | `Meetings` | Vault folder where notes are saved |
| Filename pattern | `{date} {title}` | Placeholders: `{date}`, `{title}`, `{id}` |
| Template path | `Templates/granola-meeting.md` | Created with defaults if it doesn't exist |
| Automatic sync | Manual only | Background sync frequency |
| Time range | Last 30 days | How far back to fetch meetings |
| Sync transcripts | Off | Fetches the full transcript (one extra API call per meeting) |
| Skip existing notes | On | Leave existing notes untouched; turn off to update them when Granola content changes |
| Match attendees by email | On | Link attendees to vault notes whose frontmatter has a matching `emails` property |
| Show ribbon icon | On | Sync button in the left sidebar |

---

## Templates

On first run the plugin creates a default template at your configured template path. You can edit it freely — the template uses a simple Handlebars-style syntax.

### Syntax

```
{{variable}}                  simple substitution
{{#variable}}…{{/variable}}  conditional block — only rendered when the variable is non-empty
```

### Available variables

| Variable | Contents |
|---|---|
| `{{granola_id}}` | Unique meeting ID |
| `{{granola_title}}` | Meeting title |
| `{{granola_date}}` | Date in `YYYY-MM-DD` format |
| `{{granola_created}}` | ISO 8601 creation timestamp |
| `{{granola_updated}}` | ISO 8601 last-updated timestamp |
| `{{granola_start_time}}` | Start time, e.g. `2:30 PM` |
| `{{granola_url}}` | Link to the meeting in Granola |
| `{{granola_enhanced_notes}}` | AI-enhanced notes (the main Granola output) |
| `{{granola_private_notes}}` | Your private handwritten notes |
| `{{granola_transcript}}` | Full transcript (requires "Sync transcripts" to be on) |
| `{{granola_attendees}}` | Comma-separated attendee names, e.g. `Alice, Bob` |
| `{{granola_attendees_linked}}` | Wiki-linked, e.g. `[[Alice]], [[Bob]]` |
| `{{granola_attendees_list}}` | Bulleted list — one attendee per line |
| `{{granola_attendees_linked_list}}` | Bulleted wiki-linked list |

### Attendee linking

If **Match attendees by email** is enabled, the plugin looks through your vault for notes whose frontmatter contains an `emails` property matching a meeting attendee's email address. When a match is found, the attendee's display name is replaced with that note's title — so `[[Alice Smith]]` becomes a real vault link.

Example frontmatter in a person note:

```yaml
---
name: Alice Smith
emails:
  - alice@example.com
---
```

### Example template

```markdown
---
granola_id: {{granola_id}}
title: "{{granola_title}}"
date: {{granola_date}}
attendees: [{{granola_attendees}}]
url: {{granola_url}}
---

# {{granola_title}}

**Date:** {{granola_date}} at {{granola_start_time}}  
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
```

---

## Credits

This plugin is a hybrid of two excellent open-source projects:

**[obsidian-granola-sync](https://github.com/tomelliot/obsidian-granola-sync) by [Tom Elliot](https://github.com/tomelliot)**
The credential loading and API approach — reading Granola's encrypted local credentials via the macOS keychain, then calling the Granola API directly — comes entirely from this plugin. The ProseMirror-to-Markdown and HTML-to-Markdown converters are also taken from this codebase.

**[obsidian-granola-plugin](https://github.com/philfreo/obsidian-granola-plugin) by [Phil Freo](https://github.com/philfreo)**
The template system — `{{variable}}` substitution, `{{#var}}conditional blocks{{/var}}`, attendee wiki-linking, and the full set of template variable names — is modelled on this plugin.

Both are released under the MIT licence.

---

## Licence

MIT
