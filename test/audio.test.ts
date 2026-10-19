import { describe, expect, mock, test } from "bun:test"
import { rejects } from "node:assert/strict"

import { downloadAudio, MAX_AUDIO_BYTES } from "../src/whatsapp/audio"
import type { KeyedMessage } from "../src/whatsapp/raw"

const voice: KeyedMessage = {
  key: { remoteJid: "5511999999999@s.whatsapp.net", id: "VOICE1", fromMe: false },
  message: { audioMessage: { ptt: true, mimetype: "audio/ogg; codecs=opus", fileLength: 3 } },
}

describe("downloadAudio", () => {
  test("returns original binary audio with a clean MIME type, without media keys", async () => {
    const download = mock(async () => new Uint8Array([0, 128, 255]))
    expect(await downloadAudio(voice, 3, download)).toEqual({ mimeType: "audio/ogg", data: "AID/" })
    expect(download).toHaveBeenCalledWith(voice)
  })

  test("handles audio inside an ephemeral-message wrapper", async () => {
    const wrapped = { ...voice, message: { ephemeralMessage: { message: voice.message } } }
    expect(await downloadAudio(wrapped, 3, async () => new Uint8Array([1, 2, 3]))).toEqual({
      mimeType: "audio/ogg",
      data: "AQID",
    })
  })

  test("rejects non-audio, invalid MIME types and oversized or unknown files before downloading", async () => {
    const download = mock(async () => new Uint8Array([1]))
    await rejects(
      downloadAudio({ ...voice, message: { conversation: "hi" } }, 1, download),
      /not an audio/,
    )
    await rejects(
      downloadAudio(
        { ...voice, message: { audioMessage: { mimetype: "text/html" } } },
        1,
        download,
      ),
      /MIME/,
    )
    for (const size of [null, 0, -1, NaN, 1.5, MAX_AUDIO_BYTES + 1]) {
      await rejects(downloadAudio(voice, size, download))
    }
    expect(download).not.toHaveBeenCalled()
  })

  test("checks actual download size and propagates unavailable-media errors", async () => {
    await rejects(
      downloadAudio(voice, 1, async () => new Uint8Array(0)),
      /empty/,
    )
    await rejects(
      downloadAudio(voice, 1, async () => new Uint8Array(MAX_AUDIO_BYTES + 1)),
      /2 MiB/,
    )
    await rejects(
      downloadAudio(voice, 1, async () => {
        throw new Error("media expired")
      }),
      /media expired/,
    )
  })

  test("base64 encoding works across chunk boundaries", async () => {
    const bytes = Uint8Array.from({ length: 40_000 }, (_, i) => i % 256)
    const audio = await downloadAudio(voice, bytes.length, async () => bytes)
    expect(Buffer.from(audio.data, "base64")).toEqual(Buffer.from(bytes))
  })
})
