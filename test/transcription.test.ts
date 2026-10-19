import { expect, mock, test } from "bun:test"
import { rejects } from "node:assert/strict"

import type { ArchivedMessage } from "../src/store/archive"
import {
  transcribeAudio,
  TRANSCRIPTION_MODEL,
  withTranscripts,
} from "../src/whatsapp/transcription"

const message = (id: string, kind: ArchivedMessage["kind"] = "voice"): ArchivedMessage => ({
  id,
  kind,
  chatJid: "123@s.whatsapp.net",
  chatName: null,
  fromMe: false,
  senderJid: null,
  senderName: null,
  sentAt: 1,
  text: null,
  quotedId: null,
  mentions: [],
  forwarded: false,
  media: null,
  edited: false,
  deleted: false,
  reactions: [],
})

test("Whisper receives base64 audio, transcribes without translation and trims text", async () => {
  const run = mock(async () => ({ text: "  Hola, usamos WhatsApp.  " }))
  expect(await transcribeAudio(run, "AQID")).toBe("Hola, usamos WhatsApp.")
  expect(run).toHaveBeenCalledWith(TRANSCRIPTION_MODEL, {
    audio: "AQID",
    task: "transcribe",
    vad_filter: true,
    condition_on_previous_text: false,
  })
})

test("empty speech, oversized results and provider failures do not become successful transcripts", async () => {
  for (const text of [undefined, "  ", "x".repeat(32_001)]) {
    await rejects(transcribeAudio(async () => ({ text }), "AQID"))
  }
  await rejects(
    transcribeAudio(async () => {
      throw new Error("quota exceeded")
    }, "AQID"),
    /quota exceeded/,
  )
})

test("chat read bounds work to five newest audio messages while preserving order and input", async () => {
  const messages = Array.from({ length: 7 }, (_, i) => message(String(i)))
  messages.push(message("text", "text"), { ...message("deleted"), deleted: true })
  const transcribe = mock(async (_chat: string, id: string) => `voice ${id}`)
  const results = await withTranscripts(messages, transcribe)
  expect(transcribe).toHaveBeenCalledTimes(5)
  expect(transcribe.mock.calls.map((call) => call[1])).toEqual(["6", "5", "4", "3", "2"])
  expect(results.map((item) => item.id)).toEqual(messages.map((item) => item.id))
  expect(results[0]?.transcript_error).toContain("limit")
  expect(results[6]?.transcript).toBe("voice 6")
  expect(results[7]?.transcript).toBeUndefined()
  expect(results[8]?.transcript).toBeUndefined()
  expect(messages[6]).not.toHaveProperty("transcript")
})

test("one failed voice does not hide text or other voices, or leak provider error data", async () => {
  const results = await withTranscripts(
    [message("ok"), message("bad"), message("text", "text")],
    async (_chat, id) => {
      if (id === "bad") throw new Error("private provider details")
      return "recognized"
    },
  )
  expect(results[0]?.transcript).toBe("recognized")
  expect(results[1]?.transcript_error).toContain("retry")
  expect(JSON.stringify(results)).not.toContain("private provider details")
  expect(results[2]?.id).toBe("text")
})
