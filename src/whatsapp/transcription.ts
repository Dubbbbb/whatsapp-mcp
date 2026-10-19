import type { ArchivedMessage } from "../store/archive"

export const TRANSCRIPTION_MODEL = "@cf/openai/whisper-large-v3-turbo"

export async function transcribeDuringRollout(
  current: () => Promise<string>,
  fallback: () => Promise<string>,
): Promise<string> {
  try {
    return await current()
  } catch (error) {
    // Workers and their Durable Objects can run different versions during rollout.
    if (
      !(error instanceof Error) ||
      !error.message.includes('does not implement the method "transcribeAudio"')
    )
      throw error
    return fallback()
  }
}

export async function transcribeAudio(
  run: (
    model: typeof TRANSCRIPTION_MODEL,
    input: Ai_Cf_Openai_Whisper_Large_V3_Turbo_Input,
  ) => Promise<{ text?: string }>,
  audio: string,
): Promise<string> {
  const result = await run(TRANSCRIPTION_MODEL, {
    audio,
    task: "transcribe",
    vad_filter: true,
    condition_on_previous_text: false,
  })
  const text = result.text?.trim()
  if (!text) throw new Error("No speech could be recognized in this audio")
  if (text.length > 32_000) throw new Error("Audio transcript exceeds the text limit")
  return text
}

// Bound inference work per chat read; remaining audio can be requested individually.
export async function withTranscripts(
  messages: readonly ArchivedMessage[],
  transcribe: (chat: string, id: string) => Promise<string>,
): Promise<readonly (ArchivedMessage & { transcript?: string; transcript_error?: string })[]> {
  const output = messages.map((message) => ({ ...message })) as (ArchivedMessage & {
    transcript?: string
    transcript_error?: string
  })[]
  let attempted = 0
  for (const message of output.toReversed()) {
    if (message.deleted || (message.kind !== "voice" && message.kind !== "audio")) continue
    if (attempted++ >= 5) {
      message.transcript_error =
        "Use transcribe_audio for this message; chat read limit is 5 audio messages"
      continue
    }
    try {
      message.transcript = await transcribe(message.chatJid, message.id)
    } catch {
      message.transcript_error =
        "Transcription failed; use transcribe_audio to retry or inspect the error"
    }
  }
  return output
}
