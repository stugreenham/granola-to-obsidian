import fs from "fs";
import path from "path";
import os from "os";
import crypto from "crypto";
import { execFileSync } from "child_process";
import { Platform, requestUrl } from "obsidian";

// === Path resolution ===

function getGranolaDir(): string {
  if (Platform.isWin) return path.join(os.homedir(), "AppData", "Roaming", "Granola");
  if (Platform.isLinux) return path.join(os.homedir(), ".config", "Granola");
  return path.join(os.homedir(), "Library", "Application Support", "Granola");
}

// === macOS keychain ===

function getMacKeychainPassword(): string {
  try {
    return execFileSync(
      "security",
      ["find-generic-password", "-s", "Granola Safe Storage", "-a", "Granola Key", "-w"],
      { encoding: "utf-8" }
    ).trim();
  } catch (e) {
    throw new Error(
      `Could not read Granola credentials from macOS keychain. ` +
      `Make sure the Granola app is installed and you have logged in. ` +
      `(${e instanceof Error ? e.message : String(e)})`
    );
  }
}

// === Crypto helpers (mirrors Granola's Electron safeStorage scheme) ===

const V10_PREFIX = "v10";
const PBKDF2_SALT = "saltysalt";
const PBKDF2_ITERATIONS = 1003;
const PBKDF2_KEY_LENGTH = 16;
const GCM_IV_LENGTH = 12;
const GCM_TAG_LENGTH = 16;

function stripV10(blob: Buffer, label: string): Buffer {
  if (blob.subarray(0, V10_PREFIX.length).toString("utf8") !== V10_PREFIX) {
    throw new Error(`${label} does not start with expected '${V10_PREFIX}' prefix`);
  }
  return blob.subarray(V10_PREFIX.length);
}

function decryptGcm(key: Buffer, blob: Buffer): Buffer {
  if (blob.length < GCM_IV_LENGTH + GCM_TAG_LENGTH) {
    throw new Error("Encrypted payload is too short");
  }
  const iv = blob.subarray(0, GCM_IV_LENGTH);
  const tag = blob.subarray(blob.length - GCM_TAG_LENGTH);
  const ciphertext = blob.subarray(GCM_IV_LENGTH, blob.length - GCM_TAG_LENGTH);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch (e) {
    throw new Error(`AES-GCM decryption failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function decryptCredentialsOnMac(dir: string): Promise<string> {
  const dekPath = path.join(dir, "storage.dek");
  const encPath = path.join(dir, "stored-accounts.json.enc");

  const password = getMacKeychainPassword();
  const dekBlob = await fs.promises.readFile(dekPath);

  // Unwrap the DEK: PBKDF2 → AES-128-CBC
  const wrappedCiphertext = stripV10(dekBlob, "storage.dek");
  const wrappingKey = crypto.pbkdf2Sync(password, PBKDF2_SALT, PBKDF2_ITERATIONS, PBKDF2_KEY_LENGTH, "sha1");
  const cbcIv = Buffer.alloc(16, 0x20);
  const cbcDecipher = crypto.createDecipheriv("aes-128-cbc", wrappingKey, cbcIv);
  const dekPlaintext = Buffer.concat([cbcDecipher.update(wrappedCiphertext), cbcDecipher.final()]);
  const dek = Buffer.from(dekPlaintext.toString("utf8"), "base64");

  if (dek.length !== 32) {
    throw new Error(`Expected 32-byte DEK, got ${dek.length}`);
  }

  // Decrypt the credentials file: AES-256-GCM
  const encBlob = await fs.promises.readFile(encPath);
  return decryptGcm(dek, encBlob).toString("utf-8");
}

// === Token parsing & refresh ===

interface WorkosTokens {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  token_type: string;
  obtained_at: number;
}

interface StoredAccountsFile {
  accounts: string | Array<{ tokens: string | WorkosTokens }>;
}

function parseTokens(fileContents: string): WorkosTokens {
  const data = JSON.parse(fileContents) as StoredAccountsFile;
  if (!data.accounts) {
    throw new Error("Missing 'accounts' field. Please ensure the Granola app is up to date.");
  }
  const accounts: Array<{ tokens: string | WorkosTokens }> =
    typeof data.accounts === "string"
      ? (JSON.parse(data.accounts) as Array<{ tokens: string | WorkosTokens }>)
      : data.accounts;

  if (!Array.isArray(accounts) || accounts.length === 0) {
    throw new Error("No accounts found. Please sign in via the Granola app.");
  }

  const { tokens } = accounts[0];
  if (!tokens) throw new Error("Missing 'tokens' field on account.");
  return typeof tokens === "string" ? (JSON.parse(tokens) as WorkosTokens) : tokens;
}

function isTokenExpired(tokens: WorkosTokens): boolean {
  const bufferMs = 5 * 60 * 1000;
  return Date.now() >= tokens.obtained_at + tokens.expires_in * 1000 - bufferMs;
}

async function refreshAccessToken(tokens: WorkosTokens): Promise<WorkosTokens> {
  const res = await requestUrl({
    url: "https://api.granola.ai/v1/refresh-access-token",
    method: "POST",
    headers: {
      Authorization: `Bearer ${tokens.access_token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ refresh_token: tokens.refresh_token, provider: "workos" }),
  });
  const data = res.json as {
    access_token: string;
    expires_in: number;
    refresh_token?: string;
    token_type: string;
  };
  return {
    ...tokens,
    access_token: data.access_token,
    expires_in: data.expires_in,
    token_type: data.token_type,
    obtained_at: Date.now(),
    refresh_token: data.refresh_token ?? tokens.refresh_token,
  };
}

// === Public API ===

export interface CredentialsResult {
  accessToken: string | null;
  error: string | null;
}

export async function loadCredentials(): Promise<CredentialsResult> {
  if (Platform.isMobile) {
    return { accessToken: null, error: "Granola Notes does not support Obsidian mobile." };
  }

  if (!Platform.isMacOS) {
    return {
      accessToken: null,
      error: "Granola Notes currently supports macOS only. Windows/Linux support is planned.",
    };
  }

  const dir = getGranolaDir();
  let fileContents: string;

  try {
    fileContents = await decryptCredentialsOnMac(dir);
  } catch (encError) {
    // Fall back to unencrypted file (older Granola versions)
    try {
      fileContents = await fs.promises.readFile(path.join(dir, "stored-accounts.json"), "utf-8");
    } catch {
      return {
        accessToken: null,
        error:
          `Could not load Granola credentials. Make sure the Granola desktop app is installed ` +
          `and you have signed in. (${encError instanceof Error ? encError.message : String(encError)})`,
      };
    }
  }

  try {
    let tokens = parseTokens(fileContents);
    if (isTokenExpired(tokens)) {
      tokens = await refreshAccessToken(tokens);
    }
    return { accessToken: tokens.access_token, error: null };
  } catch (e) {
    return {
      accessToken: null,
      error: `Failed to parse Granola credentials: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
