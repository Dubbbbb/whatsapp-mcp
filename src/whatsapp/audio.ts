import { normalizeMessageContent } from "@oxidezap/baileyrs/lib/Media/content.js"

import type { KeyedMessage } from "./raw"

// Keep inline MCP audio small enough for the Worker and its clients.
export const MAX_AUDIO_BYTES = 2 * 1024 * 1024

export async function downloadAudio(
  message: KeyedMessage,
  expectedBytes: number | null,
  download: (message: KeyedMessage) => Promise<Uint8Array>,
): Promise<{ readonly mimeType: string; readonly data: string }> {
  const audio = normalizeMessageContent(message.message)?.audioMessage
  if (!audio) throw new Error("message is not an audio or voice message")
  const mimeType = audio.mimetype?.split(";", 1)[0]?.trim().toLowerCase()
  if (!mimeType || !/^audio\/[a-z0-9.+-]+$/.test(mimeType)) {
    throw new Error("audio message has no valid audio MIME type")
  }
  if (expectedBytes === null || !Number.isSafeInteger(expectedBytes) || expectedBytes <= 0) {
    throw new Error("audio message has no valid file size")
  }
  if (expectedBytes > MAX_AUDIO_BYTES) throw new Error("audio exceeds the 2 MiB inline limit")

  const bytes = await download(message)
  if (bytes.length === 0) throw new Error("WhatsApp returned empty audio")
  if (bytes.length > MAX_AUDIO_BYTES) throw new Error("audio exceeds the 2 MiB inline limit")
  let binary = ""
  for (let offset = 0; offset < bytes.length; offset += 16_384) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 16_384))
  }
  return { mimeType, data: btoa(binary) }
}
