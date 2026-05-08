import { describe, it, expect, afterAll } from "bun:test"
import opencodeTelegramPlugin from "../src/index"

const makeMock$ = () => {
  const captured: any[] = []
  const run = (strings: TemplateStringsArray, ...values: any[]) => {
    const cmd = strings.reduce((acc, s, i) => acc + s + (values[i] ?? ""), "")
    captured.push(cmd)
    return { stdout: "", stderr: "", exitCode: 0 }
  }
  const mock$ = ((strings: TemplateStringsArray, ...values: any[]) => ({
    then: (resolve: (val: any) => void) => resolve(run(strings, ...values)),
    quiet: () => ({
      then: (resolve: (val: any) => void) => resolve(run(strings, ...values)),
    }),
  })) as any
  return { mock$, captured }
}

const to = (type: string, s?: string) => ({
  event: {
    type,
    properties: s ? { sessionID: "s1", status: { type: s } } : { sessionID: "s1" },
  } as any,
})
const idle = () => to("session.status", "idle")
const busy = () => to("session.status", "busy")
const retry = () => to("session.status", "retry")
const sessIdle = () => to("session.idle")
const permUpd = () => ({ event: { type: "permission.updated", properties: {} } } as any)
const permRepl = () => ({ event: { type: "permission.replied", properties: { sessionID: "s1", permissionID: "p1", response: "yes" } } } as any)
const sessionCreated = (id: string, title: string) => ({
  event: { type: "session.created", properties: { info: { id, title } } },
} as any)
const sessionUpdated = (id: string, title: string) => ({
  event: { type: "session.updated", properties: { info: { id, title } } },
} as any)

describe("opencode-telegram-plugin", () => {
  it("should be a function", () => {
    expect(typeof opencodeTelegramPlugin).toBe("function")
  })

  it("should return hooks with event handler", async () => {
    const { mock$ } = makeMock$()
    const hooks = await opencodeTelegramPlugin({ $: mock$ } as any)
    expect(hooks).toBeDefined()
    expect(typeof hooks.event).toBe("function")
  })

  it("should ignore non-relevant events", async () => {
    const { mock$, captured } = makeMock$()
    const hooks = await opencodeTelegramPlugin({ $: mock$ } as any)
    await hooks.event!({ event: { type: "file.edited" } as any })
    await Bun.sleep(600)
    expect(captured.length).toBe(0)
  })

  describe("session.status", () => {
    it("should ignore idle at startup (no prior busy)", async () => {
      const { mock$, captured } = makeMock$()
      const hooks = await opencodeTelegramPlugin({ $: mock$ } as any)
      await hooks.event!(idle())
      await Bun.sleep(600)
      expect(captured.length).toBe(0)
    })

    it("should send for busy→idle", async () => {
      const { mock$, captured } = makeMock$()
      const hooks = await opencodeTelegramPlugin({ $: mock$ } as any, { botToken: "t", chatId: "c" })
      await hooks.event!(busy())
      await hooks.event!(idle())
      await Bun.sleep(600)
      expect(captured.length).toBeGreaterThanOrEqual(1)
      expect(captured.some((c: string) => c.includes("api.telegram.org"))).toBe(true)
    })

    it("should cancel if busy re-enters before timer", async () => {
      const { mock$, captured } = makeMock$()
      const hooks = await opencodeTelegramPlugin({ $: mock$ } as any, { botToken: "t", chatId: "c" })
      await hooks.event!(busy())
      await hooks.event!(idle())
      await Bun.sleep(200)
      await hooks.event!(busy())
      await Bun.sleep(600)
      expect(captured.length).toBe(0)
    })

    it("should cancel on retry during timer", async () => {
      const { mock$, captured } = makeMock$()
      const hooks = await opencodeTelegramPlugin({ $: mock$ } as any, { botToken: "t", chatId: "c" })
      await hooks.event!(busy())
      await hooks.event!(idle())
      await Bun.sleep(200)
      await hooks.event!(retry())
      await Bun.sleep(600)
      expect(captured.length).toBe(0)
    })

    it("should send once on final idle after multiple cycles", async () => {
      const { mock$, captured } = makeMock$()
      const hooks = await opencodeTelegramPlugin({ $: mock$ } as any, { botToken: "t", chatId: "c" })
      await hooks.event!(busy())
      await hooks.event!(idle())
      await Bun.sleep(100)
      await hooks.event!(busy())
      await hooks.event!(idle())
      await Bun.sleep(100)
      await hooks.event!(busy())
      await hooks.event!(idle())
      await Bun.sleep(600)
      expect(captured.length).toBe(1)
    })

    it("should not resend on consecutive idle", async () => {
      const { mock$, captured } = makeMock$()
      const hooks = await opencodeTelegramPlugin({ $: mock$ } as any, { botToken: "t", chatId: "c" })
      await hooks.event!(busy())
      await hooks.event!(idle())
      await Bun.sleep(600)
      await hooks.event!(idle())
      await Bun.sleep(600)
      expect(captured.length).toBe(1)
    })
  })

  describe("session.idle fallback", () => {
    it("should fire when wasBusy is true", async () => {
      const { mock$, captured } = makeMock$()
      const hooks = await opencodeTelegramPlugin({ $: mock$ } as any, { botToken: "t", chatId: "c" })
      await hooks.event!(busy())
      await hooks.event!(sessIdle())
      await Bun.sleep(600)
      expect(captured.length).toBeGreaterThanOrEqual(1)
    })

    it("should ignore if not wasBusy", async () => {
      const { mock$, captured } = makeMock$()
      const hooks = await opencodeTelegramPlugin({ $: mock$ } as any, { botToken: "t", chatId: "c" })
      await hooks.event!(sessIdle())
      await Bun.sleep(600)
      expect(captured.length).toBe(0)
    })
  })

  describe("permission events", () => {
    it("should send on permission.updated", async () => {
      const { mock$, captured } = makeMock$()
      const hooks = await opencodeTelegramPlugin({ $: mock$ } as any, { botToken: "t", chatId: "c" })
      await hooks.event!(permUpd())
      await Bun.sleep(600)
      expect(captured.length).toBeGreaterThanOrEqual(1)
    })

    it("should cancel on permission.replied", async () => {
      const { mock$, captured } = makeMock$()
      const hooks = await opencodeTelegramPlugin({ $: mock$ } as any, { botToken: "t", chatId: "c" })
      await hooks.event!(permUpd())
      await Bun.sleep(200)
      await hooks.event!(permRepl())
      await Bun.sleep(600)
      expect(captured.length).toBe(0)
    })
  })

  describe("tool.execute.before", () => {
    it("should send for ask tool", async () => {
      const { mock$, captured } = makeMock$()
      const hooks = await opencodeTelegramPlugin({ $: mock$ } as any, { botToken: "t", chatId: "c" })
      await (hooks as any)["tool.execute.before"]!({ tool: "ask", sessionID: "s1", callID: "c1" }, { args: {} })
      await Bun.sleep(600)
      expect(captured.length).toBeGreaterThanOrEqual(1)
    })

    it("should send for question tool", async () => {
      const { mock$, captured } = makeMock$()
      const hooks = await opencodeTelegramPlugin({ $: mock$ } as any, { botToken: "t", chatId: "c" })
      await (hooks as any)["tool.execute.before"]!({ tool: "question", sessionID: "s1", callID: "c1" }, { args: {} })
      await Bun.sleep(600)
      expect(captured.length).toBeGreaterThanOrEqual(1)
    })

    it("should ignore non-ask tools like write", async () => {
      const { mock$, captured } = makeMock$()
      const hooks = await opencodeTelegramPlugin({ $: mock$ } as any, { botToken: "t", chatId: "c" })
      await (hooks as any)["tool.execute.before"]!({ tool: "write", sessionID: "s1", callID: "c1" }, { args: {} })
      await Bun.sleep(600)
      expect(captured.length).toBe(0)
    })

    it("should ignore read tool", async () => {
      const { mock$, captured } = makeMock$()
      const hooks = await opencodeTelegramPlugin({ $: mock$ } as any, { botToken: "t", chatId: "c" })
      await (hooks as any)["tool.execute.before"]!({ tool: "read", sessionID: "s1", callID: "c1" }, { args: {} })
      await Bun.sleep(600)
      expect(captured.length).toBe(0)
    })
  })

  describe("missing credentials", () => {
    const OLD_TOKEN = process.env.TELEGRAM_BOT_TOKEN
    const OLD_CHAT = process.env.TELEGRAM_CHAT_ID

    afterAll(() => {
      process.env.TELEGRAM_BOT_TOKEN = OLD_TOKEN
      process.env.TELEGRAM_CHAT_ID = OLD_CHAT
    })

    it("should not crash when botToken is missing", async () => {
      delete process.env.TELEGRAM_BOT_TOKEN
      delete process.env.TELEGRAM_CHAT_ID
      const { mock$, captured } = makeMock$()
      const hooks = await opencodeTelegramPlugin({ $: mock$ } as any, { chatId: "c" })
      await hooks.event!(busy())
      await hooks.event!(idle())
      await Bun.sleep(600)
      expect(captured.length).toBe(0)
    })

    it("should not crash when chatId is missing", async () => {
      delete process.env.TELEGRAM_BOT_TOKEN
      delete process.env.TELEGRAM_CHAT_ID
      const { mock$, captured } = makeMock$()
      const hooks = await opencodeTelegramPlugin({ $: mock$ } as any, { botToken: "t" })
      await hooks.event!(busy())
      await hooks.event!(idle())
      await Bun.sleep(600)
      expect(captured.length).toBe(0)
    })
  })

  describe("custom message", () => {
    it("should use custom message when provided", async () => {
      const { mock$, captured } = makeMock$()
      const hooks = await opencodeTelegramPlugin({ $: mock$ } as any, { botToken: "t", chatId: "c", message: "custom msg" })
      await hooks.event!(busy())
      await hooks.event!(idle())
      await Bun.sleep(600)
      expect(captured.some((c: string) => c.includes("text='custom msg [session: s1]'"))).toBe(true)
    })
  })

  describe("session id", () => {
    it("should include session id in message from session.status", async () => {
      const { mock$, captured } = makeMock$()
      const hooks = await opencodeTelegramPlugin({ $: mock$ } as any, { botToken: "t", chatId: "c" })
      await hooks.event!(busy())
      await hooks.event!(idle())
      await Bun.sleep(600)
      expect(captured.some((c: string) => c.includes("[session: s1]"))).toBe(true)
    })

    it("should include session id from session.idle fallback", async () => {
      const { mock$, captured } = makeMock$()
      const hooks = await opencodeTelegramPlugin({ $: mock$ } as any, { botToken: "t", chatId: "c" })
      await hooks.event!(busy())
      await hooks.event!(sessIdle())
      await Bun.sleep(600)
      expect(captured.some((c: string) => c.includes("[session: s1]"))).toBe(true)
    })

    it("should include session id from tool.execute.before for ask tools", async () => {
      const { mock$, captured } = makeMock$()
      const hooks = await opencodeTelegramPlugin({ $: mock$ } as any, { botToken: "t", chatId: "c" })
      await (hooks as any)["tool.execute.before"]!({ tool: "ask", sessionID: "s2", callID: "c1" }, { args: {} })
      await Bun.sleep(600)
      expect(captured.some((c: string) => c.includes("[session: s2]"))).toBe(true)
    })

    it("should append session id to custom message", async () => {
      const { mock$, captured } = makeMock$()
      const hooks = await opencodeTelegramPlugin({ $: mock$ } as any, { botToken: "t", chatId: "c", message: "custom msg" })
      await hooks.event!(busy())
      await hooks.event!(idle())
      await Bun.sleep(600)
      const msg = captured.find((c: string) => c.includes("api.telegram.org"))
      expect(msg).toBeDefined()
      expect(msg).toContain("text='custom msg")
      expect(msg).toContain("[session: s1]")
    })
  })

  describe("session name", () => {
    it("should use session name from session.created when available", async () => {
      const { mock$, captured } = makeMock$()
      const hooks = await opencodeTelegramPlugin({ $: mock$ } as any, { botToken: "t", chatId: "c" })
      await hooks.event!(sessionCreated("s1", "my-feature"))
      await hooks.event!(busy())
      await hooks.event!(idle())
      await Bun.sleep(600)
      expect(captured.some((c: string) => c.includes("[session: my-feature]"))).toBe(true)
    })

    it("should use session name from session.updated when changed", async () => {
      const { mock$, captured } = makeMock$()
      const hooks = await opencodeTelegramPlugin({ $: mock$ } as any, { botToken: "t", chatId: "c" })
      await hooks.event!(sessionCreated("s1", "old-name"))
      await hooks.event!(sessionUpdated("s1", "renamed-feature"))
      await hooks.event!(busy())
      await hooks.event!(idle())
      await Bun.sleep(600)
      expect(captured.some((c: string) => c.includes("[session: renamed-feature]"))).toBe(true)
    })

    it("should fall back to session id when name is unknown", async () => {
      const { mock$, captured } = makeMock$()
      const hooks = await opencodeTelegramPlugin({ $: mock$ } as any, { botToken: "t", chatId: "c" })
      await hooks.event!(busy())
      await hooks.event!(idle())
      await Bun.sleep(600)
      expect(captured.some((c: string) => c.includes("[session: s1]"))).toBe(true)
    })

    it("should show session name in custom message", async () => {
      const { mock$, captured } = makeMock$()
      const hooks = await opencodeTelegramPlugin({ $: mock$ } as any, { botToken: "t", chatId: "c", message: "needs review" })
      await hooks.event!(sessionCreated("s1", "bug-fix"))
      await hooks.event!(busy())
      await hooks.event!(idle())
      await Bun.sleep(600)
      expect(captured.some((c: string) => c.includes("text='needs review [session: bug-fix]'"))).toBe(true)
    })

    it("should track multiple sessions", async () => {
      const { mock$, captured } = makeMock$()
      const hooks = await opencodeTelegramPlugin({ $: mock$ } as any, { botToken: "t", chatId: "c" })
      await hooks.event!(sessionCreated("s1", "feature-a"))
      await hooks.event!(sessionCreated("s2", "feature-b"))
      await (hooks as any)["tool.execute.before"]!({ tool: "ask", sessionID: "s2", callID: "c1" }, { args: {} })
      await Bun.sleep(600)
      expect(captured.some((c: string) => c.includes("[session: feature-b]"))).toBe(true)
    })
  })

  describe("environment variable fallback", () => {
    const OLD_TOKEN = process.env.TELEGRAM_BOT_TOKEN
    const OLD_CHAT = process.env.TELEGRAM_CHAT_ID

    afterAll(() => {
      process.env.TELEGRAM_BOT_TOKEN = OLD_TOKEN
      process.env.TELEGRAM_CHAT_ID = OLD_CHAT
    })

    it("should use env vars when options are missing", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "env_token"
      process.env.TELEGRAM_CHAT_ID = "env_chat"
      const { mock$, captured } = makeMock$()
      const hooks = await opencodeTelegramPlugin({ $: mock$ } as any)
      await hooks.event!(busy())
      await hooks.event!(idle())
      await Bun.sleep(600)
      expect(captured.length).toBeGreaterThanOrEqual(1)
      expect(captured.some((c: string) => c.includes("env_token"))).toBe(true)
    })

    it("options should override env vars", async () => {
      process.env.TELEGRAM_BOT_TOKEN = "env_token"
      process.env.TELEGRAM_CHAT_ID = "env_chat"
      const { mock$, captured } = makeMock$()
      const hooks = await opencodeTelegramPlugin({ $: mock$ } as any, { botToken: "opt_token", chatId: "opt_chat" })
      await hooks.event!(busy())
      await hooks.event!(idle())
      await Bun.sleep(600)
      expect(captured.some((c: string) => c.includes("opt_token"))).toBe(true)
      expect(captured.some((c: string) => c.includes("env_token"))).toBe(false)
    })
  })
})
