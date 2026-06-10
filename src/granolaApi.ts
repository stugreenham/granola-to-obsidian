import { requestUrl } from "obsidian";
import type { GranolaDoc, TranscriptEntry } from "./types";

const PLUGIN_VERSION = "1.0.0";

const HEADERS = (token: string) => ({
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
  Accept: "*/*",
  "User-Agent": `GranolaObsidianPlugin/${PLUGIN_VERSION}`,
  "X-Client-Version": `GranolaObsidianPlugin/${PLUGIN_VERSION}`,
});

async function fetchDocumentPage(
  accessToken: string,
  limit: number,
  offset: number
): Promise<GranolaDoc[]> {
  const res = await requestUrl({
    url: "https://api.granola.ai/v2/get-documents",
    method: "POST",
    headers: HEADERS(accessToken),
    body: JSON.stringify({ limit, offset, include_last_viewed_panel: true }),
  });

  const data = res.json as GranolaDoc[] | { documents: GranolaDoc[] } | null;
  if (!data) return [];
  if (Array.isArray(data)) return data;
  if (Array.isArray((data as { documents: GranolaDoc[] }).documents)) {
    return (data as { documents: GranolaDoc[] }).documents;
  }
  return [];
}

export async function getDocumentsSince(
  accessToken: string,
  daysBack: number
): Promise<GranolaDoc[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - daysBack);

  const all: GranolaDoc[] = [];
  const limit = 100;
  let offset = 0;

  while (true) {
    const page = await fetchDocumentPage(accessToken, limit, offset);
    if (page.length === 0) break;

    for (const doc of page) {
      if (doc.deleted_at) continue;
      const ts = doc.updated_at ?? doc.created_at;
      if (!ts || new Date(ts) >= cutoff) {
        all.push(doc);
      }
    }

    if (page.length < limit) break;

    // Stop if the oldest doc in this page predates the cutoff
    const oldest = page[page.length - 1];
    const oldestTs = oldest.updated_at ?? oldest.created_at;
    if (oldestTs && new Date(oldestTs) < cutoff) break;

    offset += limit;
  }

  return all;
}

export async function fetchTranscript(
  accessToken: string,
  docId: string
): Promise<TranscriptEntry[]> {
  const res = await requestUrl({
    url: "https://api.granola.ai/v1/get-document-transcript",
    method: "POST",
    headers: HEADERS(accessToken),
    body: JSON.stringify({ document_id: docId }),
  });

  const data = res.json as TranscriptEntry[] | null;
  if (!Array.isArray(data)) return [];
  return data;
}
