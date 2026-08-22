const key = process.env.QWEN_API_KEY;
if (!key) throw new Error("QWEN_API_KEY is required.");

const base = "https://aihub.i-screammedia.com/image-serving-gateway/vlm/v1";
const model = "Qwen/Qwen3.6-35B-A3B-FP8";
const results = [];

async function call(name, path, body) {
  const started = performance.now();
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "ai-hub-key": key },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  results.push({
    name,
    status: response.status,
    latencyMs: Math.round(performance.now() - started),
    contentType: response.headers.get("content-type"),
    hasText: Boolean(data?.choices?.[0]?.message?.content),
    hasUsage: Boolean(data?.usage),
    hasToolCall: Boolean(data?.choices?.[0]?.message?.tool_calls?.length),
    streamFinished: typeof data === "string" ? data.includes("[DONE]") : undefined,
    error: response.ok ? undefined : (data?.error?.message ?? data?.message ?? String(data).slice(0, 180)),
  });
}

await call("text-korean", "/chat/completions", { model, messages: [{ role: "user", content: "한국어로 '브라우저 작업 준비 완료'라고만 답해." }], max_tokens: 30, temperature: 0 });
await call("stream", "/chat/completions", { model, stream: true, messages: [{ role: "user", content: "한 단어로 준비 상태를 답해." }], max_tokens: 20, temperature: 0 });
await call("json", "/chat/completions", { model, response_format: { type: "json_object" }, messages: [{ role: "user", content: "JSON 객체로 {\"ready\":true}만 반환해." }], max_tokens: 30, temperature: 0 });
await call("tool-calling", "/chat/completions", { model, messages: [{ role: "user", content: "example.com의 페이지 제목을 얻어야 한다. 제공된 도구를 호출해." }], tools: [{ type: "function", function: { name: "browser_get_title", description: "Return a web page title.", parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"], additionalProperties: false } } }], tool_choice: "auto", max_tokens: 100, temperature: 0 });

console.log(JSON.stringify({ base, model, results }));
