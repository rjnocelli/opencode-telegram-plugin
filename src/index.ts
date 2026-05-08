import type { Plugin, PluginOptions } from "@opencode-ai/plugin"

const ASK_TOOLS = new Set(["ask", "question", "confirm"])

type TelegramPluginOptions = PluginOptions & {
  botToken?: string
  chatId?: string
  message?: string
  debug?: boolean
}

const opencodeTelegramPlugin: Plugin = async ({ $ }, options?: TelegramPluginOptions) => {
  let sendTimer: ReturnType<typeof setTimeout> | null = null
  let wasBusy = false
  let logEvents = false
  let currentSessionId: string | null = null
  const sessionNames = new Map<string, string>()

  if (options?.debug) {
    logEvents = true
    const { appendFile } = await import("node:fs/promises")
    await appendFile("/tmp/opencode-telegram-debug.log", "--- plugin started ---\n").catch(() => {})
  }

  const log = async (msg: string) => {
    if (!logEvents) return
    const { appendFile } = await import("node:fs/promises")
    await appendFile("/tmp/opencode-telegram-debug.log", `${Date.now()} ${msg}\n`).catch(() => {})
  }

  const sendTelegram = async () => {
    sendTimer = null
    await log("sendTelegram()")

    const token = options?.botToken || process.env.TELEGRAM_BOT_TOKEN
    const chat = options?.chatId || process.env.TELEGRAM_CHAT_ID
    if (!token || !chat) {
      await log("  missing botToken or chatId — skipping")
      return
    }

    let text = options?.message || "opencode agent is waiting for your input"
    if (currentSessionId) {
      const name = sessionNames.get(currentSessionId)
      text += ` [session: ${name || currentSessionId}]`
    }
    const url = `https://api.telegram.org/bot${token}/sendMessage`

    try {
      await ($ as any)`curl -s -X POST ${url} -d chat_id=${chat} -d text='${text}'`.quiet()
      await log("  sent successfully")
    } catch {
      await log("  send failed (silent)")
    }
  }

  const cancelSend = () => {
    if (sendTimer) {
      clearTimeout(sendTimer)
      sendTimer = null
      log("cancelSend()")
    }
  }

  const scheduleSend = () => {
    if (!sendTimer) {
      sendTimer = setTimeout(sendTelegram, 500)
      log("scheduleSend()")
    }
  }

  return {
    event: async ({ event }) => {
      await log(`event: ${event.type}`)

      if (event.type === "session.status") {
        currentSessionId = (event.properties as any).sessionID || currentSessionId
        const status = event.properties.status.type
        await log(`  session.status=${status} wasBusy=${wasBusy}`)
        if (status === "busy" || status === "retry") {
          wasBusy = true
          cancelSend()
        } else if (status === "idle" && wasBusy) {
          wasBusy = false
          scheduleSend()
        }
      } else if (event.type === "session.created" || event.type === "session.updated") {
        const info = (event.properties as any)?.info
        if (info?.id && info?.title) {
          sessionNames.set(info.id, info.title)
          currentSessionId = info.id
          await log(`  session name: "${info.title}" (${info.id})`)
        }
      } else if (event.type === "session.idle") {
        currentSessionId = (event.properties as any).sessionID || currentSessionId
        await log(`  session.idle wasBusy=${wasBusy}`)
        if (wasBusy) {
          wasBusy = false
          scheduleSend()
        }
      } else if (event.type === "permission.updated") {
        currentSessionId = (event.properties as any).sessionID || currentSessionId
        await log("  permission.updated → scheduleSend")
        scheduleSend()
      } else if (event.type === "permission.replied") {
        currentSessionId = (event.properties as any).sessionID || currentSessionId
        await log("  permission.replied → cancelSend")
        cancelSend()
      }
    },
    "tool.execute.before": async (input, _output) => {
      currentSessionId = input.sessionID || currentSessionId
      await log(`tool.execute.before: ${input.tool}`)
      if (ASK_TOOLS.has(input.tool)) {
        await log(`  ask tool ${input.tool} → scheduleSend`)
        scheduleSend()
      }
    },
  }
}

export default opencodeTelegramPlugin
