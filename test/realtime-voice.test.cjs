const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const {
  RealtimeVoiceSession,
  realtimeToolDefinitions,
} = require("../packages/copilot-sdk/dist/core/index.cjs");
const originals = Object.fromEntries(
  ["RTCPeerConnection", "document", "navigator", "fetch"].map((k) => [
    k,
    Object.getOwnPropertyDescriptor(globalThis, k),
  ]),
);
let peers, track, stream, audio, getMedia;
const tick = () => new Promise((resolve) => setImmediate(resolve));
class Peer {
  constructor() {
    peers.push(this);
    this.connectionState = "new";
  }
  addTrack() {}
  createDataChannel() {
    return (this.channel = {
      readyState: "connecting",
      bufferedAmount: 0,
      sent: [],
      send(value) {
        this.sent.push(JSON.parse(value));
      },
      close() {
        this.readyState = "closed";
        this.onclose?.();
      },
    });
  }
  async createOffer() {
    return { sdp: "v=0\r\no=offer", type: "offer" };
  }
  async setLocalDescription(value) {
    this.localDescription = value;
  }
  async setRemoteDescription() {
    this.connectionState = "connected";
    this.channel.readyState = "open";
    this.channel.onopen();
    this.emit({ type: "session.created" });
  }
  emit(event) {
    this.channel.onmessage?.({ data: JSON.stringify(event) });
  }
  close() {
    this.connectionState = "closed";
  }
}
beforeEach(() => {
  peers = [];
  track = {
    enabled: true,
    stopped: 0,
    stop() {
      this.stopped++;
    },
  };
  stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  audio = {
    srcObject: null,
    async play() {},
    pause() {
      this.paused = true;
    },
  };
  getMedia = async () => stream;
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { mediaDevices: { getUserMedia: () => getMedia() } },
  });
  globalThis.document = { createElement: () => audio };
  globalThis.RTCPeerConnection = Peer;
});
after(() => {
  for (const [key, desc] of Object.entries(originals))
    if (desc) Object.defineProperty(globalThis, key, desc);
    else delete globalThis[key];
});
function session(options = {}) {
  if (options.getTools) {
    const registered = options.getTools();
    options = { ...options, getTools: () => registered };
  }
  return new RealtimeVoiceSession({
    createCall: async () => ({ sdp: "v=0\r\no=answer" }),
    ...options,
  });
}
function toolCall(id = "call-1", name = "lookup", args = "{}") {
  return {
    type: "response.done",
    response: {
      status: "completed",
      output: [{ type: "function_call", call_id: id, name, arguments: args }],
    },
  };
}
const outputs = (peer) =>
  peer.channel.sent.filter((e) => e.item?.type === "function_call_output");
test("voice connects only on demand, mute clears input, disconnect releases all resources", async () => {
  let requests = 0;
  getMedia = async () => {
    requests++;
    return stream;
  };
  const s = session();
  assert.equal(requests, 0);
  await s.connect();
  assert.equal(s.state, "connected");
  assert.equal(requests, 1);
  s.setMuted(true);
  assert.equal(track.enabled, false);
  assert.equal(s.muted, true);
  assert.equal(peers[0].channel.sent[0].type, "input_audio_buffer.clear");
  s.setMuted(false);
  assert.equal(track.enabled, true);
  s.disconnect();
  assert.equal(track.stopped, 1);
  assert.equal(audio.srcObject, null);
  assert.equal(peers[0].connectionState, "closed");
  s.disconnect();
  assert.equal(track.stopped, 1);
});
test("disconnect during microphone permission stops a late track and never creates a peer", async () => {
  let deliver;
  getMedia = () =>
    new Promise((resolve) => {
      deliver = resolve;
    });
  const s = session();
  const pending = s.connect();
  s.disconnect();
  await assert.rejects(pending, { name: "AbortError" });
  deliver(stream);
  await tick();
  assert.equal(track.stopped, 1);
  assert.equal(peers.length, 0);
});
test("setup timeout releases resources even when server never resolves", async () => {
  const s = session({
    createCall: () => new Promise(() => {}),
    connectionTimeoutMs: 10,
  });
  await assert.rejects(s.connect(), { name: "TimeoutError" });
  assert.equal(track.stopped, 1);
  assert.equal(peers[0].connectionState, "closed");
});
test("permission rejection surfaces without retaining resources", async () => {
  getMedia = async () => {
    throw new DOMException("denied", "NotAllowedError");
  };
  const s = session();
  await assert.rejects(s.connect(), { name: "NotAllowedError" });
  assert.equal(s.state, "error");
});
test("invalid SDP answer releases stream and connection", async () => {
  const s = session({ createCall: async () => ({ sdp: "bad" }) });
  await assert.rejects(s.connect(), /Invalid voice SDP/);
  assert.equal(track.stopped, 1);
});
test("secret setup rejects long-lived and expired keys before sending them", async () => {
  for (const secret of [
    { value: "sk_fixture", expiresAt: 9e12 },
    { value: "ek_old", expiresAt: 1 },
  ]) {
    const s = new RealtimeVoiceSession({ getClientSecret: async () => secret });
    globalThis.fetch = () => {
      throw new Error("must not call");
    };
    await assert.rejects(s.connect(), /ephemeral/);
  }
});
test("secret setup exchanges SDP directly with GA endpoint", async () => {
  globalThis.fetch = async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/realtime/calls");
    assert.deepEqual(init.headers.Authorization.split(" "), ["Bearer", "ek_fixture"]);
    return new Response("v=0\r\no=answer");
  };
  const s = new RealtimeVoiceSession({
    getClientSecret: async () => ({
      value: "ek_fixture",
      expiresAt: Date.now() / 1000 + 60,
    }),
  });
  await s.connect();
  s.disconnect();
});
test("transcript deltas assemble and final text replaces partial text", async () => {
  const values = [];
  const s = session({ onTranscript: (value) => values.push(value) });
  await s.connect();
  peers[0].emit({
    type: "response.output_audio_transcript.delta",
    item_id: "m1",
    delta: "Hello ",
  });
  peers[0].emit({
    type: "response.output_audio_transcript.delta",
    item_id: "m1",
    delta: "world",
  });
  peers[0].emit({
    type: "response.output_audio_transcript.done",
    item_id: "m1",
    transcript: "Hello world.",
  });
  peers[0].emit({
    type: "conversation.item.input_audio_transcription.completed",
    item_id: "u1",
    transcript: "Hi",
  });
  assert.deepEqual(
    values.map((v) => [v.role, v.text, v.final]),
    [
      ["assistant", "Hello ", false],
      ["assistant", "Hello world", false],
      ["assistant", "Hello world.", true],
      ["user", "Hi", true],
    ],
  );
  s.disconnect();
});
test("manual interruption cancels response and clears server playback buffer", async () => {
  const s = session();
  await s.connect();
  const peer = peers[0];
  peer.emit({ type: "response.created" });
  peer.emit({ type: "output_audio_buffer.started" });
  s.interrupt();
  assert.deepEqual(
    peer.channel.sent.map((e) => e.type),
    ["response.cancel", "output_audio_buffer.clear"],
  );
  s.disconnect();
});
test("text and manual audio commits use GA conversation events", async () => {
  const s = session();
  await s.connect();
  s.sendText("hello");
  s.commitAudio();
  assert.equal(peers[0].channel.sent[0].item.content[0].text, "hello");
  assert.equal(peers[0].channel.sent[2].type, "input_audio_buffer.commit");
  s.disconnect();
});
test("tool batches execute exactly once per call ID and continue once after all results", async () => {
  let count = 0;
  const s = session({
    getTools: () => [
      {
        name: "lookup",
        inputSchema: {},
        handler: async (_, context) => {
          count++;
          assert.ok(context.signal);
          return { success: true, data: context.toolCallId };
        },
      },
    ],
  });
  await s.connect();
  const event = toolCall();
  event.response.output.push({
    ...event.response.output[0],
    call_id: "call-2",
  });
  peers[0].emit(event);
  peers[0].emit(event);
  await tick();
  assert.equal(count, 2);
  assert.equal(outputs(peers[0]).length, 2);
  assert.equal(
    peers[0].channel.sent.filter((e) => e.type === "response.create").length,
    1,
  );
  s.disconnect();
});
for (const level of ["ask", "deny_always", "allow_always", "session"])
  test(`voice tool permission ${level}`, async () => {
    let calls = 0,
      approvals = 0;
    const s = session({
      getTools: () => [
        {
          name: "lookup",
          inputSchema: {},
          needsApproval: true,
          handler: async () => {
            calls++;
            return { success: true };
          },
        },
      ],
      getToolPermission: async () => level,
      onApproval: async () => {
        approvals++;
        return { approved: false };
      },
    });
    await s.connect();
    peers[0].emit(toolCall());
    await tick();
    assert.equal(calls, ["allow_always", "session"].includes(level) ? 1 : 0);
    assert.equal(approvals, level === "ask" ? 1 : 0);
    s.disconnect();
  });
test("approved tool receives approval data; conditional approval false skips prompt", async () => {
  let data;
  let needed = true;
  const s = session({
    getTools: () => [
      {
        name: "lookup",
        inputSchema: {},
        needsApproval: async () => needed,
        handler: async (_, context) => {
          data = context.approvalData;
          return { success: true };
        },
      },
    ],
    onApproval: async () => ({ approved: true, data: { selected: 1 } }),
  });
  await s.connect();
  peers[0].emit(toolCall());
  await tick();
  assert.deepEqual(data, { selected: 1 });
  needed = false;
  peers[0].emit(toolCall("call-2"));
  await tick();
  assert.equal(data, undefined);
  s.disconnect();
});
test("required approval without callback is denied", async () => {
  let count = 0;
  const s = session({
    getTools: () => [
      {
        name: "lookup",
        needsApproval: true,
        handler: () => {
          count++;
        },
      },
    ],
  });
  await s.connect();
  peers[0].emit(toolCall());
  await tick();
  assert.equal(count, 0);
  assert.match(outputs(peers[0])[0].item.output, /approval denied/);
  s.disconnect();
});
test("disconnect while approval pending prevents a late approval from executing a tool", async () => {
  let resolve,
    calls = 0;
  const s = session({
    getTools: () => [
      {
        name: "lookup",
        needsApproval: true,
        handler: () => {
          calls++;
        },
      },
    ],
    onApproval: () =>
      new Promise((r) => {
        resolve = r;
      }),
  });
  await s.connect();
  const peer = peers[0];
  peer.emit(toolCall());
  await tick();
  s.disconnect();
  resolve({ approved: true });
  await tick();
  assert.equal(calls, 0);
  assert.equal(outputs(peer).length, 0);
});
test("tool timeout returns failure once and never repeats the handler", async () => {
  let calls = 0;
  const s = session({
    toolTimeoutMs: 10,
    getTools: () => [
      {
        name: "lookup",
        handler: () => {
          calls++;
          return new Promise(() => {});
        },
      },
    ],
  });
  await s.connect();
  peers[0].emit(toolCall());
  await new Promise((r) => setTimeout(r, 25));
  peers[0].emit(toolCall());
  await tick();
  assert.equal(calls, 1);
  assert.equal(outputs(peers[0]).length, 1);
  assert.match(outputs(peers[0])[0].item.output, /timed out/);
  s.disconnect();
});
test("barge-in suppresses stale tool follow-up speech but returns its output", async () => {
  let resolve;
  const s = session({
    getTools: () => [
      {
        name: "lookup",
        handler: () =>
          new Promise((r) => {
            resolve = r;
          }),
      },
    ],
  });
  await s.connect();
  peers[0].emit(toolCall());
  await tick();
  peers[0].emit({ type: "input_audio_buffer.speech_started" });
  resolve({ success: true });
  await tick();
  assert.equal(outputs(peers[0]).length, 1);
  assert.equal(
    peers[0].channel.sent.filter((e) => e.type === "response.create").length,
    0,
  );
  s.disconnect();
});
test("malformed tool arguments and unavailable tools do not execute", async () => {
  let count = 0;
  const s = session({
    getTools: () => [
      {
        name: "lookup",
        available: false,
        handler: () => {
          count++;
        },
      },
    ],
  });
  await s.connect();
  peers[0].emit(toolCall("bad", "lookup", "[]"));
  peers[0].emit(toolCall("missing"));
  await tick();
  assert.equal(count, 0);
  assert.equal(outputs(peers[0]).length, 2);
  s.disconnect();
});
test("failed transport stops capture and requires explicit reconnect", async () => {
  const s = session();
  await s.connect();
  peers[0].connectionState = "disconnected";
  peers[0].onconnectionstatechange();
  assert.equal(s.state, "error");
  assert.equal(track.stopped, 1);
  assert.equal(peers.length, 1);
});
test("session duration cap stops recording", async () => {
  const s = session({ maxDurationMs: 10 });
  await s.connect();
  await new Promise((r) => setTimeout(r, 25));
  assert.equal(s.state, "disconnected");
  assert.equal(track.stopped, 1);
});
test("oversized protocol event closes connection and observer errors cannot block cleanup", async () => {
  const s = session({
    onStateChange() {
      throw new Error("observer");
    },
    onError() {
      throw new Error("observer");
    },
  });
  await s.connect();
  peers[0].channel.onmessage({ data: "x".repeat(1_048_577) });
  assert.equal(s.state, "error");
  assert.equal(track.stopped, 1);
});
test("realtime definitions exclude unavailable tools and all executable handlers", () => {
  const defs = realtimeToolDefinitions([
    {
      name: "x",
      inputSchema: { properties: { a: { type: "string" } } },
      handler() {},
    },
    { name: "hidden", available: false, inputSchema: {} },
  ]);
  assert.equal(defs.length, 1);
  assert.equal(defs[0].handler, undefined);
  assert.equal(defs[0].parameters.type, "object");
});

test("disconnect from the connecting observer never requests microphone access", async () => {
  let count = 0;
  getMedia = async () => {
    count++;
    return stream;
  };
  const s = session({
    onStateChange: (state) => {
      if (state === "connecting") s.disconnect();
    },
  });
  await assert.rejects(s.connect(), { name: "AbortError" });
  assert.equal(count, 0);
});
test("unregistering a tool while approval is pending prevents execution", async () => {
  let approve,
    count = 0;
  const tool = {
    name: "lookup",
    needsApproval: true,
    handler: async () => {
      count++;
      return { success: true };
    },
  };
  let tools = [tool];
  const s = new RealtimeVoiceSession({
    createCall: async () => ({ sdp: "v=0" }),
    getTools: () => tools,
    onApproval: () =>
      new Promise((resolve) => {
        approve = resolve;
      }),
  });
  await s.connect();
  peers[0].emit(toolCall());
  await tick();
  tools = [];
  approve({ approved: true });
  await tick();
  assert.equal(count, 0);
  assert.match(outputs(peers[0])[0].item.output, /Tool changed/);
  s.disconnect();
});
test("a stored denial set while waiting for approval is respected", async () => {
  let approve,
    count = 0,
    permission = "ask";
  const s = session({
    getToolPermission: async () => permission,
    getTools: () => [
      {
        name: "lookup",
        needsApproval: true,
        handler: async () => {
          count++;
          return { success: true };
        },
      },
    ],
    onApproval: () =>
      new Promise((resolve) => {
        approve = resolve;
      }),
  });
  await s.connect();
  peers[0].emit(toolCall());
  await tick();
  permission = "deny_always";
  approve({ approved: true });
  await tick();
  assert.equal(count, 0);
  assert.match(outputs(peers[0])[0].item.output, /permission denied/);
  s.disconnect();
});
test("session tool cap closes rather than executing more side effects", async () => {
  let count = 0;
  const s = session({
    maxToolCalls: 1,
    getTools: () => [
      {
        name: "lookup",
        handler: async () => {
          count++;
          return { success: true };
        },
      },
    ],
  });
  await s.connect();
  peers[0].emit(toolCall());
  await tick();
  peers[0].emit(toolCall("over-limit"));
  await tick();
  assert.equal(count, 1);
  assert.equal(s.state, "error");
  assert.equal(track.stopped, 1);
});
test("oversized SDP from secret endpoint is rejected and cancelled", async () => {
  let cancelled = false;
  globalThis.fetch = async () =>
    new Response(
      new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode("v=0" + "x".repeat(65536)));
        },
        cancel() {
          cancelled = true;
        },
      }),
    );
  const s = new RealtimeVoiceSession({
    getClientSecret: async () => ({
      value: "ek_fixture",
      expiresAt: Date.now() / 1000 + 60,
    }),
  });
  await assert.rejects(s.connect(), /64 KiB/);
  assert.equal(cancelled, true);
  assert.equal(track.stopped, 1);
});
