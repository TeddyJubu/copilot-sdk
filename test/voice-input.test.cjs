const { test, beforeEach, after } = require("node:test");
const assert = require("node:assert/strict");
const {
  VoiceRecorder,
  transcribeRecording,
} = require("../packages/copilot-sdk/dist/core/index.cjs");
const originalNavigator = Object.getOwnPropertyDescriptor(
  globalThis,
  "navigator",
);
const originalRecorder = globalThis.MediaRecorder;
let permissions, tracks, instances, getMedia, supported;
class Recorder {
  static isTypeSupported(type) {
    return supported.includes(type);
  }
  constructor(stream, { mimeType }) {
    this.stream = stream;
    this.mimeType = mimeType;
    this.state = "inactive";
    instances.push(this);
  }
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    queueMicrotask(() => {
      this.ondataavailable?.({
        data: new Blob(["recorded-audio"], { type: this.mimeType }),
      });
      this.onstop?.();
    });
  }
}
beforeEach(() => {
  permissions = 0;
  tracks = 0;
  instances = [];
  supported = ["audio/webm;codecs=opus", "audio/mp4"];
  getMedia = async () => ({
    getTracks: () => [
      {
        stop() {
          tracks++;
        },
      },
    ],
  });
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      mediaDevices: {
        getUserMedia: async () => {
          permissions++;
          return getMedia();
        },
      },
    },
  });
  globalThis.MediaRecorder = Recorder;
});
after(() => {
  if (originalNavigator)
    Object.defineProperty(globalThis, "navigator", originalNavigator);
  else delete globalThis.navigator;
  globalThis.MediaRecorder = originalRecorder;
});
test("recording begins only on start, produces encoded Blob on stop and releases tracks", async () => {
  const states = [];
  const recorder = new VoiceRecorder({ onStateChange: (s) => states.push(s) });
  assert.equal(permissions, 0);
  await recorder.start();
  assert.equal(permissions, 1);
  assert.equal(recorder.state, "recording");
  const stop = recorder.stop();
  assert.strictEqual(recorder.stop(), stop);
  const recording = await stop;
  assert.equal(recording.mediaType, "audio/webm;codecs=opus");
  assert.ok(recording.audio.size);
  assert.equal(tracks, 1);
  assert.deepEqual(states, ["requesting", "recording", "stopping", "idle"]);
  recorder.dispose();
  assert.equal(tracks, 1);
});
test("codec negotiation picks MP4 when WebM is unavailable", async () => {
  supported = ["audio/mp4"];
  const recorder = new VoiceRecorder();
  await recorder.start();
  const audio = await recorder.stop();
  assert.equal(audio.mediaType, "audio/mp4");
});
test("unsupported codecs fail before microphone permission", async () => {
  supported = [];
  await assert.rejects(() => new VoiceRecorder().start(), /No supported/);
  assert.equal(permissions, 0);
});
test("microphone permission rejection resets state", async () => {
  getMedia = async () => {
    throw new DOMException("denied", "NotAllowedError");
  };
  const recorder = new VoiceRecorder();
  await assert.rejects(() => recorder.start(), { name: "NotAllowedError" });
  assert.equal(recorder.state, "idle");
});
test("cancel while permission is pending stops late stream and permits restart", async () => {
  let resolve;
  getMedia = () =>
    new Promise((r) => {
      resolve = r;
    });
  const recorder = new VoiceRecorder();
  const start = recorder.start();
  recorder.cancel();
  resolve({
    getTracks: () => [
      {
        stop() {
          tracks++;
        },
      },
    ],
  });
  await assert.rejects(() => start, { name: "AbortError" });
  assert.ok(tracks >= 1);
  assert.equal(instances.length, 0);
  assert.equal(recorder.state, "idle");
});
test("cancel active recording releases device, discards audio, and cancels pending stop", async () => {
  const recorder = new VoiceRecorder();
  await recorder.start();
  const pending = recorder.stop();
  recorder.cancel();
  await assert.rejects(() => pending, { name: "AbortError" });
  assert.equal(tracks, 1);
  assert.equal(recorder.state, "idle");
});
test("overlapping starts are rejected", async () => {
  const recorder = new VoiceRecorder();
  await recorder.start();
  await assert.rejects(() => recorder.start(), /already active/);
  recorder.dispose();
});
test("size limit stops recording and releases microphone", async () => {
  let error;
  const recorder = new VoiceRecorder({
    maxBytes: 2,
    onError: (e) => {
      error = e;
    },
  });
  await recorder.start();
  instances[0].ondataavailable({ data: new Blob(["too large"]) });
  assert.match(error.message, /size limit/);
  assert.equal(tracks, 1);
  assert.equal(recorder.state, "idle");
});
test("duration limit releases microphone without uploading", async () => {
  let failed;
  const done = new Promise((resolve) => {
    failed = resolve;
  });
  const recorder = new VoiceRecorder({ maxDurationMs: 1, onError: failed });
  await recorder.start();
  const error = await done;
  assert.match(error.message, /duration limit/);
  assert.equal(tracks, 1);
  assert.equal(recorder.state, "idle");
});
test("recorder error resets state and releases microphone", async () => {
  let error;
  const recorder = new VoiceRecorder({
    onError: (e) => {
      error = e;
    },
  });
  await recorder.start();
  instances[0].onerror();
  assert.match(error.message, /recording failed/);
  assert.equal(tracks, 1);
});
test("empty audio rejects stopped recording", async () => {
  const recorder = new VoiceRecorder();
  await recorder.start();
  instances[0].stop = function () {
    this.state = "inactive";
    queueMicrotask(() => this.onstop?.());
  };
  await assert.rejects(() => recorder.stop(), /no audio/);
  assert.equal(tracks, 1);
});
test("upload uses multipart, carries cancellation, returns reviewable transcript provenance", async () => {
  const signal = new AbortController().signal;
  let requests = 0;
  const result = await transcribeRecording(
    {
      audio: new Blob(["audio"], { type: "audio/mp4" }),
      mediaType: "audio/mp4",
      durationMs: 2000,
    },
    {
      url: "/api/transcribe",
      signal,
      headers: { "content-type": "wrong", "x-app-csrf": "test" },
      fetch: async (url, init) => {
        requests++;
        assert.equal(url, "/api/transcribe");
        assert.equal(init.signal, signal);
        assert.equal(init.headers.get("content-type"), null);
        assert.equal(init.headers.get("x-app-csrf"), "test");
        assert.equal(init.body.get("file").name, "recording.m4a");
        return Response.json({
          text: "review this",
          response: { provider: "openai", modelId: "test" },
        });
      },
    },
  );
  assert.equal(requests, 1);
  assert.equal(result.text, "review this");
  assert.deepEqual(result.provenance, {
    source: "recorded_audio",
    mediaType: "audio/mp4",
    durationMs: 2000,
    provider: "openai",
    modelId: "test",
  });
});
for (const kind of [
  "empty",
  "bad-format",
  "provider-failure",
  "invalid-json-shape",
  "aborted",
])
  test(`upload ${kind} failure`, async () => {
    let requests = 0;
    const controller = new AbortController();
    if (kind === "aborted") controller.abort();
    await assert.rejects(() =>
      transcribeRecording(
        {
          audio: new Blob(kind === "empty" ? [] : ["audio"], {
            type: kind === "bad-format" ? "text/plain" : "audio/webm",
          }),
          mediaType: "audio/webm",
          durationMs: 1000,
        },
        {
          url: "/api/transcribe",
          signal: controller.signal,
          fetch: async () => {
            requests++;
            return kind === "provider-failure"
              ? new Response(null, { status: 503 })
              : Response.json({ missing: "text" });
          },
        },
      ),
    );
    assert.equal(
      requests,
      ["provider-failure", "invalid-json-shape"].includes(kind) ? 1 : 0,
    );
  });
