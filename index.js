const { onCall, HttpsError } = require("firebase-functions/v2/https");
const { defineSecret } = require("firebase-functions/params");
const { setGlobalOptions } = require("firebase-functions/v2");

// The xAI API key lives only here, on the server, as a Firebase secret.
// It is never sent to or stored in the browser.
const XAI_API_KEY = defineSecret("XAI_API_KEY");

setGlobalOptions({ maxInstances: 10 });

const SYSTEM_INSTRUCTION = `You are Nuru, a thoughtful and warm AI assistant. Your name is Nuru — Swahili
for "light" — not Grok, and not any other model name. If asked who you are,
what you're called, or what model powers you, always answer as Nuru and
describe yourself in your own words. You can mention that your name comes
from Swahili if it's relevant or if someone asks about it, but don't force
the reference into every answer. Never refer to yourself as Grok or mention
xAI's internal model names. Stay in character as Nuru at all times, while
still being honest, helpful, and accurate.`;

// Change this if xAI retires/renames the model. See https://docs.x.ai for
// the current catalog.
const XAI_MODEL = "grok-4.3";

exports.chatWithNuru = onCall(
  { secrets: [XAI_API_KEY], cors: true },
  async (request) => {
    const messages = request.data && request.data.messages;

    if (!Array.isArray(messages) || messages.length === 0) {
      throw new HttpsError(
        "invalid-argument",
        "messages must be a non-empty array of { role, content } objects."
      );
    }

    const payload = {
      model: XAI_MODEL,
      messages: [{ role: "system", content: SYSTEM_INSTRUCTION }, ...messages],
      temperature: 0.7,
    };

    let response;
    try {
      response = await fetch("https://api.x.ai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${XAI_API_KEY.value()}`,
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      throw new HttpsError("unavailable", "Could not reach the xAI API: " + err.message);
    }

    if (!response.ok) {
      const errBody = await response.text();
      throw new HttpsError("internal", `xAI API returned ${response.status}: ${errBody}`);
    }

    const data = await response.json();
    const text =
      data && data.choices && data.choices[0] && data.choices[0].message
        ? data.choices[0].message.content
        : null;

    if (!text) {
      throw new HttpsError("internal", "xAI API returned an unexpected response shape.");
    }

    return { text };
  }
);

// ============================================================
// Voice — mints a short-lived xAI "ephemeral token" so the browser can
// open a Grok Voice Agent WebSocket directly without ever seeing the
// real XAI_API_KEY. The client calls this once per voice session and
// uses the returned token as the WebSocket subprotocol
// (`xai-client-secret.<token>`) — same key-never-leaves-the-server
// pattern as chatWithNuru.
//
// Docs: https://docs.x.ai/developers/model-capabilities/audio/ephemeral-tokens
// ============================================================

exports.createVoiceSession = onCall(
  { secrets: [XAI_API_KEY], cors: true },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError("unauthenticated", "Sign in to start a voice chat.");
    }

    let response;
    try {
      response = await fetch("https://api.x.ai/v1/realtime/client_secrets", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${XAI_API_KEY.value()}`,
        },
        // Short-lived on purpose — the client requests a fresh token
        // each time it starts a new voice call.
        body: JSON.stringify({ expires_after: { seconds: 300 } }),
      });
    } catch (err) {
      throw new HttpsError("unavailable", "Could not reach the xAI API: " + err.message);
    }

    if (!response.ok) {
      const errBody = await response.text();
      throw new HttpsError("internal", `xAI API returned ${response.status}: ${errBody}`);
    }

    // Shape: { value: "<ephemeral token>", expires_at: <unix seconds>, ... }
    return await response.json();
  }
);
