# Company Qwen provider

The supplied company test catalog indicates an OpenAI-compatible chat endpoint:

- Base URL: `https://aihub.i-screammedia.com/image-serving-gateway/vlm/v1`
- Text model candidate: `Qwen/Qwen3.6-35B-A3B-FP8`
- Authentication header candidate: `ai-hub-key`

These values are configuration defaults, not proof of production capability. Before enabling agent execution, run and record: text, streaming, JSON mode, tool calling, image input, screenshot understanding, Korean instructions, long context, latency, concurrency limits, and token usage.

If tool calling or vision is unavailable, the worker remains DOM-first and disables coordinate/screenshot actions.
