import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  analyzeSessionApi,
  ApiError,
  changePasswordApi,
  createPartRecommendationApi,
  createContactRequestApi,
  createHandoffApi,
  createSessionApi,
  createToolRecommendationApi,
  describeApiError,
  emailReportCopyApi,
  getHandoffApi,
  getOwnTechnicianProfileApi,
  getTechnicianCardApi,
  getReportApi,
  getSessionDetailApi,
  knowledgeSearchApi,
  listContactRequestsApi,
  listPartRecommendationsApi,
  listSegmentationsApi,
  listToolRecommendationsApi,
  loginApi,
  logoutApi,
  meApi,
  mfaChallengeApi,
  mfaDisableApi,
  mfaEnrollApi,
  mfaStatusApi,
  mfaVerifyApi,
  myReportsApi,
  mySessionsApi,
  parseApiResponse,
  recordTestResultApi,
  registerApi,
  searchTechniciansApi,
  segmentEvidenceApi,
  forgotPasswordApi,
  getVoiceCapabilitiesApi,
  getVoicePreferencesApi,
  logVoiceInteractionApi,
  requestSpeakPolicyApi,
  resendConfirmationApi,
  resetPasswordApi,
  transcribeVoiceApi,
  transitionSafetyApi,
  updateContactRequestApi,
  updatePartRecommendationApi,
  upsertOwnTechnicianProfileApi,
  updateProfileApi,
  updateToolRecommendationApi,
  updateVoicePreferencesApi,
  verifyEmailApi,
  verifyHypothesisApi,
} from "./api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SESSION = {
  id: "11111111-1111-4111-8111-111111111111",
  device_type: "laptop",
  manufacturer: "Acme",
  model: "AcmeBook Pro 14",
  operating_system: null,
  symptoms: "Will not power on.",
  problem_started_at: null,
  problem_started_note: null,
  recent_events: null,
  user_mode: "everyday",
  status: "open",
  safety_state: "normal",
  created_at: "2026-10-30T09:00:00.000Z",
  updated_at: "2026-10-30T09:00:00.000Z",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("parseApiResponse", () => {
  it("returns contract-valid success payloads", async () => {
    const schema = z.object({ ok: z.boolean() });
    const result = await parseApiResponse(
      { status: 200, json: async () => ({ ok: true }) },
      (data) => schema.safeParse(data),
      "Probe",
    );
    expect(result).toEqual({ ok: true });
  });

  it("throws ApiError with the server code on failures", async () => {
    await expect(
      parseApiResponse(
        {
          status: 403,
          json: async () => ({
            error: { code: "forbidden", message: "Nope." },
          }),
        },
        (data) => z.object({}).safeParse(data),
        "Probe",
      ),
    ).rejects.toMatchObject({ status: 403, code: "forbidden" });
  });

  it("throws bad_response when success payloads misshape", async () => {
    await expect(
      parseApiResponse(
        { status: 200, json: async () => ({ wrong: 1 }) },
        (data) => z.object({ ok: z.boolean() }).safeParse(data),
        "Probe",
      ),
    ).rejects.toMatchObject({ code: "bad_response" });
  });
});

describe("createSessionApi", () => {
  it("posts the input and returns session plus token", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(201, { session: SESSION, accessToken: "tok" }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await createSessionApi({
      device_type: "laptop",
      symptoms: "Will not power on.",
      user_mode: "everyday",
    });
    expect(result.session.id).toBe(SESSION.id);
    expect(result.accessToken).toBe("tok");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/sessions"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("surfaces validation errors from the envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(400, {
          error: { code: "invalid_request", message: "symptoms: Required" },
        }),
      ),
    );
    await expect(
      createSessionApi({
        device_type: "laptop",
        symptoms: "",
        user_mode: "everyday",
      }),
    ).rejects.toMatchObject({ status: 400, code: "invalid_request" });
  });
});

describe("getSessionDetailApi", () => {
  it("sends the bearer token", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { session: SESSION, evidence: [], observations: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await getSessionDetailApi(SESSION.id, "tok");
    expect(result.evidence).toEqual([]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/v1/sessions/${SESSION.id}`),
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer tok",
        }),
      }),
    );
  });
});

const SEGMENTATION_IDS = {
  session: "11111111-1111-4111-8111-111111111111",
  file: "7a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d",
  annotation: "3f2a9b1e-0a8c-4c3f-8e1d-9d2f3a4b5c6d",
  run: "9a1b2c3d-4e5f-4a6b-8c9d-0e1f2a3b4c5d",
};

const BOX_ANNOTATION = {
  id: SEGMENTATION_IDS.annotation,
  evidence_file_id: SEGMENTATION_IDS.file,
  kind: "box",
  coordinates: { x: 10, y: 20, width: 6, height: 4 },
  label: "battery",
  producer: "sam-3.1",
  image_width: 100,
  image_height: 80,
  model_run_id: SEGMENTATION_IDS.run,
  svg_path: null,
  created_at: "2026-10-31T00:00:00.000Z",
};

describe("segmentation api", () => {
  it("posts concepts with the session token", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(201, {
        annotations: [BOX_ANNOTATION],
        runs: [
          {
            id: SEGMENTATION_IDS.run,
            concept: "battery",
            status: "succeeded",
            model_id: "sam-3.1",
          },
        ],
        concepts_used: ["battery"],
        warnings: [],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await segmentEvidenceApi(
      SEGMENTATION_IDS.session,
      SEGMENTATION_IDS.file,
      "tok",
      ["battery"],
    );
    expect(result.concepts_used).toEqual(["battery"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(
      `/api/v1/sessions/${SEGMENTATION_IDS.session}/evidence/${SEGMENTATION_IDS.file}/segmentations`,
    );
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer tok");
    expect(init.body).toBe(JSON.stringify({ concepts: ["battery"] }));
  });

  it("lists persisted annotations", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, {
          annotations: [BOX_ANNOTATION],
          image_width: 100,
          image_height: 80,
        }),
      ),
    );
    const result = await listSegmentationsApi(
      SEGMENTATION_IDS.session,
      SEGMENTATION_IDS.file,
      "tok",
    );
    expect(result.annotations).toHaveLength(1);
  });

  it("surfaces provider failures as ApiError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(502, {
          error: { code: "provider_failed", message: "Model unavailable." },
        }),
      ),
    );
    await expect(
      segmentEvidenceApi(SEGMENTATION_IDS.session, SEGMENTATION_IDS.file, "tok"),
    ).rejects.toMatchObject({ code: "provider_failed" });
  });
});

const LOOP_IDS = {
  session: "11111111-1111-4111-8111-111111111111",
  hypothesis: "44444444-4444-4444-8444-444444444444",
  test: "66666666-6666-4666-8666-666666666666",
  result: "77777777-7777-4777-8777-777777777777",
  run: "cccccccc-cccc-4ccc-cccc-cccccccccccc",
  report: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  safety: "dddddddd-dddd-4ddd-dddd-dddddddddddd",
};

const HYPOTHESIS = {
  id: LOOP_IDS.hypothesis,
  session_id: LOOP_IDS.session,
  title: "Failing battery",
  description: null,
  supporting_observations: [],
  contradicting_observations: [],
  confidence_label: "medium",
  confidence_rationale: null,
  status: "proposed",
  suggested_next_test_id: null,
  verified_by_test_result_id: null,
  created_at: "2026-10-30T09:05:00.000Z",
  updated_at: "2026-10-30T09:05:00.000Z",
};

describe("diagnostic loop api", () => {
  it("posts analysis and returns hypotheses plus tests", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, {
          assessment: minimalAssessment(),
          hypotheses: [HYPOTHESIS],
          tests: [],
          run: {
            id: LOOP_IDS.run,
            status: "succeeded",
            model_id: "muse-spark-1.3",
          },
          warnings: [],
        }),
      ),
    );
    const result = await analyzeSessionApi(LOOP_IDS.session, "tok");
    expect(result.hypotheses).toHaveLength(1);
  });

  it("records results and unwraps the envelope responses", async () => {
    const test = {
      id: LOOP_IDS.test,
      session_id: LOOP_IDS.session,
      name: "Charger swap",
      objective: "Rule out the adapter.",
      rationale: null,
      required_tools: [],
      skill_level: "beginner",
      safety_classification: "safe",
      instructions: [{ step: 1, text: "Swap." }],
      expected_outcomes: null,
      result_options: [{ value: "boots", label: "It boots" }],
      position: 0,
      status: "completed",
      created_at: "2026-10-30T09:05:00.000Z",
      updated_at: "2026-10-30T09:06:00.000Z",
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(201, {
          result: {
            id: LOOP_IDS.result,
            test_id: LOOP_IDS.test,
            session_id: LOOP_IDS.session,
            selected_option: "boots",
            observation: null,
            source: "user_reported",
            created_at: "2026-10-30T09:06:00.000Z",
          },
          test,
          reassessment_applied: false,
          reassessment_error: null,
          hypotheses: [HYPOTHESIS],
        }),
      ),
    );
    const recorded = await recordTestResultApi(LOOP_IDS.session, LOOP_IDS.test, "tok", {
      selected_option: "boots",
    });
    expect(recorded.result.source).toBe("user_reported");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { hypothesis: HYPOTHESIS })),
    );
    const verified = await verifyHypothesisApi(
      LOOP_IDS.session,
      LOOP_IDS.hypothesis,
      "tok",
      "Confirmed on bench.",
    );
    expect(verified.id).toBe(LOOP_IDS.hypothesis);

    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, {
          safety_event: {
            id: LOOP_IDS.safety,
            session_id: LOOP_IDS.session,
            previous_state: "critical_stop",
            new_state: "review_required",
            trigger_type: "policy_rule",
            trigger_detail: "Bench check done.",
            evidence_file_id: null,
            blocked_action: "analyze,record_result",
            safe_next_steps: "Proceed carefully.",
            created_at: "2026-10-30T09:07:00.000Z",
          },
        }),
      ),
    );
    const event = await transitionSafetyApi(LOOP_IDS.session, "tok", {
      to_state: "review_required",
      rationale: "Bench check done.",
    });
    expect(event.new_state).toBe("review_required");
  });

  it("loads the report snapshot", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(200, {
          report: {
            id: LOOP_IDS.report,
            session_id: LOOP_IDS.session,
            status: "ready",
            report_data: {
              device: {
                device_type: "laptop",
                manufacturer: null,
                model: null,
                operating_system: null,
              },
              symptoms: "Will not power on.",
              evidence_ids: [],
              observable_facts: [],
              hypotheses: [],
              tests_performed: [],
              sources: [],
              remaining_uncertainty: [],
              recommended_next_steps: [],
              safety_summary: [],
            },
            error_message: null,
            created_at: "2026-10-30T09:08:00.000Z",
            updated_at: "2026-10-30T09:08:00.000Z",
          },
        }),
      ),
    );
    const report = await getReportApi(LOOP_IDS.session, "tok");
    expect(report.status).toBe("ready");
  });
});

function minimalAssessment() {
  return {
    summary: "Possible battery fault.",
    observed_evidence: [],
    hypotheses: [],
    recommended_tests: [],
    safety_warnings: [],
    missing_information: [],
    citations: [],
    suggested_next_action: { action: "Swap the charger." },
  };
}

const USER = {
  id: "22222222-2222-4222-8222-222222222222",
  email: "tech@example.com",
  name: "Tech",
  created_at: "2026-10-30T09:00:00.000Z",
};

const AUTH = { user: USER, token: "tok", expires_at: "2026-11-29T09:00:00.000Z" };

function bearerCall(urlPart: string) {
  return [
    expect.stringContaining(urlPart),
    expect.objectContaining({
      headers: expect.objectContaining({ Authorization: "Bearer tok" }),
    }),
  ] as const;
}

describe("auth apis", () => {
  it("registers without signing in (confirmation required)", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(201, { user: USER, confirmation_required: true }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await registerApi({ name: "Tech", email: "tech@example.com", password: "password123" });
    expect(result.confirmation_required).toBe(true);
    expect(result.user.email).toBe("tech@example.com");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/auth/register"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("verifies email, resends confirmation, and runs the reset flow", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.includes("/verify-email") && !href.includes("/resend")) {
        return jsonResponse(200, AUTH);
      }
      return jsonResponse(200, { ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);
    const verified = await verifyEmailApi("0".repeat(64));
    expect(verified.token).toBe("tok");
    await resendConfirmationApi("tech@example.com");
    await forgotPasswordApi("tech@example.com");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/auth/verify-email/resend"),
      expect.objectContaining({ method: "POST" }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/auth/password/forgot"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("resets the password from a link token", async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await resetPasswordApi({ token: "0".repeat(64), new_password: "new-password-1" });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/auth/password/reset"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("logs in and surfaces uniform credential errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(401, { error: { code: "invalid_credentials", message: "Invalid email or password." } }),
      ),
    );
    await expect(
      loginApi({ email: "tech@example.com", password: "wrong-password" }),
    ).rejects.toMatchObject({ status: 401, code: "invalid_credentials" });
  });

  it("parses an MFA challenge login and completes it with a code", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.includes("/mfa/challenge")) {
        return jsonResponse(200, AUTH);
      }
      return jsonResponse(200, { mfa_required: true, mfa_token: "m".repeat(64) });
    });
    vi.stubGlobal("fetch", fetchMock);
    const login = await loginApi({ email: "tech@example.com", password: "password123" });
    if (!("mfa_required" in login)) {
      throw new Error("expected an MFA challenge");
    }
    expect(login.mfa_token).toHaveLength(64);
    const authed = await mfaChallengeApi({ mfa_token: login.mfa_token, code: "123456" });
    expect(authed.token).toBe("tok");
  });

  it("covers the MFA status, enroll, verify, and disable calls", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.includes("/status")) {
        return jsonResponse(200, { enabled: false, verified_at: null });
      }
      if (href.includes("/enroll")) {
        return jsonResponse(200, { otpauth_url: "otpauth://totp/x", secret: "ABC" });
      }
      if (href.includes("/disable")) {
        return jsonResponse(200, { disabled: true });
      }
      return jsonResponse(200, { verified: true, backup_codes: ["a-b", "c-d"] });
    });
    vi.stubGlobal("fetch", fetchMock);
    const status = await mfaStatusApi("tok");
    expect(status.enabled).toBe(false);
    const enroll = await mfaEnrollApi("tok");
    expect(enroll.secret).toBe("ABC");
    const verify = await mfaVerifyApi("tok", { code: "123456" });
    expect(verify.backup_codes).toHaveLength(2);
    await mfaDisableApi("tok", { code: "123456" });
    expect(fetchMock).toHaveBeenCalledWith(...bearerCall("/api/v1/auth/mfa/status"));
    expect(fetchMock).toHaveBeenCalledWith(...bearerCall("/api/v1/auth/mfa/disable"));
  });

  it("sends the Bearer token on me, logout, profile, and password calls", async () => {
    const fetchMock = vi.fn(async (url: string | URL, _init?: RequestInit) => {
      const href = String(url);
      if (href.includes("/api/v1/auth/password") || href.includes("/api/v1/auth/logout")) {
        return new Response(null, { status: 204 });
      }
      return jsonResponse(200, { user: USER });
    });
    vi.stubGlobal("fetch", fetchMock);
    await meApi("tok");
    await logoutApi("tok");
    await updateProfileApi("tok", { name: "New Name" });
    await changePasswordApi("tok", { current_password: "old-password", new_password: "new-password" });
    expect(fetchMock).toHaveBeenCalledWith(...bearerCall("/api/v1/auth/me"));
    expect(fetchMock).toHaveBeenCalledWith(...bearerCall("/api/v1/auth/logout"));
    const patchCall = fetchMock.mock.calls.find((call) =>
      String(call[0]).includes("/api/v1/auth/me") && call[1]?.method === "PATCH",
    );
    expect(patchCall).toBeDefined();
    expect(fetchMock).toHaveBeenCalledWith(...bearerCall("/api/v1/auth/password"));
  });
});

describe("owned-list apis", () => {
  it("fetches the caller's sessions and reports with auth", async () => {
    const fetchMock = vi.fn(async (url: string | URL) => {
      const href = String(url);
      if (href.includes("/reports")) {
        return jsonResponse(
          200,
          { reports: [{ id: "33333333-3333-4333-8333-333333333333", session_id: SESSION.id, status: "ready", device_type: "laptop", manufacturer: "Acme", model: "AcmeBook", symptoms: SESSION.symptoms, created_at: SESSION.created_at }] },
        );
      }
      return jsonResponse(
        200,
        { sessions: [{ ...SESSION, test_count: 2, tests_recorded: 1, evidence_count: 1 }] },
      );
    });
    vi.stubGlobal("fetch", fetchMock);
    const sessions = await mySessionsApi("tok");
    expect(sessions.sessions).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(...bearerCall("/api/v1/users/me/sessions"));
    const reports = await myReportsApi("tok");
    expect(reports.reports[0]?.session_id).toBe(SESSION.id);
    expect(fetchMock).toHaveBeenCalledWith(...bearerCall("/api/v1/users/me/reports"));
  });
});

describe("knowledgeSearchApi", () => {
  it("posts the query and returns hits with references", async () => {
    const hit = {
      chunk_id: "44444444-4444-4444-8444-444444444444",
      document_id: "55555555-5555-4555-8555-555555555555",
      document_title: "Acme Service Manual",
      page_number: 12,
      heading: "Power",
      excerpt: "Check the charger LED before opening the chassis.",
      rank: 0.9,
    };
    const fetchMock = vi.fn(async () => jsonResponse(200, { hits: [hit] }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await knowledgeSearchApi({ query: "charger LED", limit: 10 });
    expect(result.hits).toHaveLength(1);
    expect(result.hits[0]?.document_title).toBe("Acme Service Manual");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/knowledge/search"),
      expect.objectContaining({ method: "POST" }),
    );
  });
});

describe("voice apis", () => {
  const USER_ID = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
  const PREFS = {
    preferences: {
      user_id: USER_ID,
      spoken_responses: true,
      voice_id: null,
      rate: 1,
      language: "en",
      created_at: "2026-11-01T00:00:00.000Z",
      updated_at: "2026-11-01T00:00:00.000Z",
    },
  };
  const CAPS = {
    stt: {
      provider: "meta-voice",
      model_id: "muse-voice-transcribe-1.0",
      configured: true,
      enabled: true,
      available: true,
      accepts: ["audio/wav", "audio/x-wav"],
      max_audio_mb: 32,
      max_audio_bytes: 33554432,
    },
    tts: {
      provider: "browser-speech-synthesis",
      mode: "browser-speech-synthesis",
      server_audio: false,
      configured: true,
    },
  };

  it("loads and updates voice preferences", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, PREFS));
    vi.stubGlobal("fetch", fetchMock);
    const prefs = await getVoicePreferencesApi("tok");
    expect(prefs.preferences.language).toBe("en");
    expect(fetchMock).toHaveBeenCalledWith(
      ...bearerCall("/api/v1/voice/preferences"),
    );

    const putMock = vi.fn(async () =>
      jsonResponse(200, {
        preferences: { ...PREFS.preferences, rate: 1.25 },
      }),
    );
    vi.stubGlobal("fetch", putMock);
    const updated = await updateVoicePreferencesApi("tok", { rate: 1.25 });
    expect(updated.preferences.rate).toBe(1.25);
    expect(putMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/voice/preferences"),
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("logs voice interactions with the session id", async () => {
    const logged = {
      interaction: {
        id: "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb",
        session_id: SESSION.id,
        user_id: null,
        role: "user",
        text: "It still will not power on.",
        audio_storage_key: null,
        created_at: "2026-11-01T00:00:00.000Z",
        updated_at: "2026-11-01T00:00:00.000Z",
      },
      safety_state: "normal",
      warnings: [],
      blocked: false,
    };
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) => jsonResponse(201, logged),
    );
    vi.stubGlobal("fetch", fetchMock);
    const result = await logVoiceInteractionApi(SESSION.id, "tok", {
      role: "user",
      text: "It still will not power on.",
    });
    expect(result.interaction.session_id).toBe(SESSION.id);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/voice/interactions/log"),
      expect.objectContaining({ method: "POST" }),
    );
    const init = fetchMock.mock.calls[0]?.[1];
    if (typeof init?.body !== "string") {
      throw new Error("voice log request missing JSON body");
    }
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body["session_id"]).toBe(SESSION.id);
  });

  it("loads capabilities and requests speak policies", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, CAPS));
    vi.stubGlobal("fetch", fetchMock);
    const caps = await getVoiceCapabilitiesApi("tok");
    expect(caps.stt.available).toBe(true);
    expect(caps.tts.server_audio).toBe(false);

    const policy = {
      text: "Test 1 of 2: Charger swap.",
      ssml: "<speak>Test 1 of 2: Charger swap.</speak>",
      language: "en",
      rate: 1,
      voice_id: null,
      mode: "browser-speech-synthesis",
      audio_base64: null,
      substituted: false,
      safety_state: "normal",
      warnings: [],
    };
    const speakMock = vi.fn(async () => jsonResponse(200, policy));
    vi.stubGlobal("fetch", speakMock);
    const result = await requestSpeakPolicyApi("tok", {
      text: "Test 1 of 2: Charger swap.",
      session_id: SESSION.id,
    });
    expect(result.mode).toBe("browser-speech-synthesis");
    expect(result.audio_base64).toBeNull();
  });

  it("surfaces voice_disabled from capabilities load", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(503, {
        error: { code: "voice_disabled", message: "Voice is off." },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(getVoiceCapabilitiesApi("tok")).rejects.toMatchObject({
      status: 503,
      code: "voice_disabled",
    });
  });

  it("uploads WAV clips with session fields over XHR", async () => {
    const TRANSCRIBE = {
      transcript: "It still will not power on.",
      audio_duration_ms: 2500,
      turns: [],
      provider: "meta-voice",
      model_id: "muse-voice-transcribe-1.0",
      transcription_id: "cccccccc-0000-4000-8000-cccccccccccc",
      interaction_id: "dddddddd-0000-4000-8000-dddddddddddd",
      model_run_id: "eeeeeeee-0000-4000-8000-eeeeeeeeeeee",
      safety_state: "normal",
      warnings: [],
      blocked: false,
    };
    class FakeXHR {
      static last: FakeXHR | null = null;
      upload: Record<string, unknown> = {};
      status = 0;
      responseText = "";
      method = "";
      url = "";
      headers: Record<string, string> = {};
      body: unknown = null;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;

      open(method: string, url: string) {
        this.method = method;
        this.url = url;
      }

      setRequestHeader(key: string, value: string) {
        this.headers[key] = value;
      }

      send(body: unknown) {
        this.body = body;
        FakeXHR.last = this;
      }

      abort() {
        this.onabort?.();
      }
    }
    FakeXHR.last = null;
    vi.stubGlobal("XMLHttpRequest", FakeXHR);
    const pending = transcribeVoiceApi(SESSION.id, "tok", new Blob(["RIFF"]), {
      languageBias: "en",
    });
    // Cast resets narrowing: FakeXHR.last was reset to null above.
    const xhr = FakeXHR.last as FakeXHR | null;
    expect(xhr).not.toBeNull();
    if (!xhr) {
      throw new Error("XHR was not created");
    }
    expect(xhr.method).toBe("POST");
    expect(xhr.url).toContain("/api/v1/voice/transcribe");
    expect(xhr.headers["Authorization"]).toBe("Bearer tok");
    const form = xhr.body as FormData;
    expect(form.get("session_id")).toBe(SESSION.id);
    expect(form.get("languageBias")).toBe("en");
    expect(form.get("audio")).toBeInstanceOf(Blob);
    xhr.status = 201;
    xhr.responseText = JSON.stringify(TRANSCRIBE);
    xhr.onload?.();
    await expect(pending).resolves.toMatchObject({
      transcript: "It still will not power on.",
      blocked: false,
    });
  });

  it("rejects transcription failures with the server code", async () => {
    class FailingXHR {
      static last: FailingXHR | null = null;
      upload: Record<string, unknown> = {};
      status = 0;
      responseText = "";
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      onabort: (() => void) | null = null;

      open() {}

      setRequestHeader() {}

      send() {
        FailingXHR.last = this;
      }

      abort() {
        this.onabort?.();
      }
    }
    FailingXHR.last = null;
    vi.stubGlobal("XMLHttpRequest", FailingXHR);
    const pending = transcribeVoiceApi(SESSION.id, "tok", new Blob(["RIFF"]));
    // Cast resets narrowing: FailingXHR.last was reset to null above.
    const xhr = FailingXHR.last as FailingXHR | null;
    if (!xhr) {
      throw new Error("XHR was not created");
    }
    xhr.status = 503;
    xhr.responseText = JSON.stringify({
      error: { code: "voice_disabled", message: "Voice is off." },
    });
    xhr.onload?.();
    await expect(pending).rejects.toMatchObject({
      status: 503,
      code: "voice_disabled",
    });
  });
});

describe("describeApiError", () => {
  it("maps failures to readable messages", () => {
    expect(describeApiError(new ApiError(403, "forbidden", "Nope."))).toBe(
      "Nope.",
    );
    expect(describeApiError(new TypeError("fetch failed"))).toMatch(
      /Cannot reach the API/,
    );
    expect(describeApiError(new Error("boom"))).toBe("boom");
    expect(describeApiError(null)).toBe("Something went wrong.");
  });
});

const PART_IDS = {
  session: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa",
  hypothesis: "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb",
  test: "cccccccc-3333-4333-8333-cccccccccccc",
  part: "dddddddd-4444-4444-8444-dddddddddddd",
  tool: "eeeeeeee-5555-4555-8555-eeeeeeeeeeee",
};

const PART = {
  id: PART_IDS.part,
  session_id: PART_IDS.session,
  hypothesis_id: PART_IDS.hypothesis,
  test_id: null,
  part_name: "Battery pack",
  part_number: "ACM-BAT-42",
  manufacturer: "Acme",
  model_compat: "AcmeBook Pro 14",
  chunk_id: null,
  excerpt: null,
  status: "proposed",
  created_at: "2026-11-02T00:00:00.000Z",
};

const TOOL = {
  id: PART_IDS.tool,
  session_id: PART_IDS.session,
  test_id: PART_IDS.test,
  tool_name: "Phillips #0 screwdriver",
  spec: "ESD-safe handle",
  chunk_id: null,
  status: "proposed",
  created_at: "2026-11-02T00:00:00.000Z",
};

describe("parts advisor apis", () => {
  it("lists part and tool recommendations", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { recommendations: [PART] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const parts = await listPartRecommendationsApi(PART_IDS.session, "tok");
    expect(parts.recommendations).toHaveLength(1);
    expect(parts.recommendations[0]?.part_name).toBe("Battery pack");
    expect(fetchMock).toHaveBeenCalledWith(
      ...bearerCall(`/api/v1/sessions/${PART_IDS.session}/parts/recommendations`),
    );

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(200, { recommendations: [TOOL] })));
    const tools = await listToolRecommendationsApi(PART_IDS.session, "tok");
    expect(tools.recommendations).toHaveLength(1);
    expect(tools.recommendations[0]?.tool_name).toBe("Phillips #0 screwdriver");
  });

  it("creates recommendations and unwraps the envelope", async () => {
    const partMock = vi.fn(async () => jsonResponse(201, { recommendation: PART }));
    vi.stubGlobal("fetch", partMock);
    const part = await createPartRecommendationApi(PART_IDS.session, "tok", {
      hypothesis_id: PART_IDS.hypothesis,
      part_name: "Battery pack",
    });
    expect(part.id).toBe(PART_IDS.part);
    expect(partMock).toHaveBeenCalledWith(
      ...bearerCall(`/api/v1/sessions/${PART_IDS.session}/parts/recommendations`),
    );
    expect(partMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: "POST" }),
    );

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(201, { recommendation: TOOL })));
    const tool = await createToolRecommendationApi(PART_IDS.session, "tok", {
      test_id: PART_IDS.test,
      tool_name: "Phillips #0 screwdriver",
    });
    expect(tool.id).toBe(PART_IDS.tool);
  });

  it("accepts and dismisses recommendations", async () => {
    const accepted = { ...PART, status: "accepted" };
    const partMock = vi.fn(async () => jsonResponse(200, { recommendation: accepted }));
    vi.stubGlobal("fetch", partMock);
    const part = await updatePartRecommendationApi(PART_IDS.session, PART_IDS.part, "tok", {
      status: "accepted",
    });
    expect(part.status).toBe("accepted");
    expect(partMock).toHaveBeenCalledWith(
      ...bearerCall(
        `/api/v1/sessions/${PART_IDS.session}/parts/recommendations/${PART_IDS.part}`,
      ),
    );
    expect(partMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ method: "PATCH" }),
    );

    const dismissed = { ...TOOL, status: "dismissed" };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse(200, { recommendation: dismissed })),
    );
    const tool = await updateToolRecommendationApi(PART_IDS.session, PART_IDS.tool, "tok", {
      status: "dismissed",
    });
    expect(tool.status).toBe("dismissed");
  });

  it("surfaces the server error when a recommendation is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(404, {
          error: { code: "recommendation_not_found", message: "No such part recommendation." },
        }),
      ),
    );
    await expect(
      updatePartRecommendationApi(PART_IDS.session, PART_IDS.part, "tok", {
        status: "accepted",
      }),
    ).rejects.toMatchObject({ status: 404, code: "recommendation_not_found" });
  });
});

describe("technician directory apis", () => {
  const TECH_ID = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
  const REQ_ID = "bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb";
  const LIST_ITEM = {
    user_id: TECH_ID,
    display_name: "Riley Repairs",
    city: "Austin",
    region: "TX",
    postal_code: null,
    latitude: null,
    longitude: null,
    specialties: ["board repair"],
    device_types: ["laptop"],
    about: null,
    accepting_requests: true,
    verified: false,
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
    distance_km: 3.24,
  };
  const REQUEST = {
    id: REQ_ID,
    session_id: null,
    requester_user_id: "cccccccc-0000-4000-8000-cccccccccccc",
    technician_user_id: TECH_ID,
    message: "My laptop will not power on.",
    contact_method: null,
    preferred_time: null,
    status: "submitted",
    created_at: "2026-11-01T00:00:00.000Z",
    updated_at: "2026-11-01T00:00:00.000Z",
  };

  it("searches without auth and encodes filters as query params", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { technicians: [LIST_ITEM] }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await searchTechniciansApi({
      city: "Austin",
      lat: 30.27,
      lng: -97.74,
      radius_km: 25,
    });
    expect(result.technicians).toHaveLength(1);
    expect(result.technicians[0]?.distance_km).toBe(3.24);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/v1/technicians?");
    expect(url).toContain("city=Austin");
    expect(url).toContain("lat=30.27");
    expect(url).toContain("radius_km=25");
    expect(init.headers ?? {}).not.toHaveProperty("Authorization");
  });

  it("loads a public card and unwraps the envelope", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        technician: { ...LIST_ITEM, phone: null, contact_email: "r@example.com", whatsapp: null },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const card = await getTechnicianCardApi(TECH_ID);
    expect(card.contact_email).toBe("r@example.com");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/v1/technicians/${TECH_ID}`),
      expect.anything(),
    );
  });

  it("sends contact requests with auth", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(201, { request: REQUEST }));
    vi.stubGlobal("fetch", fetchMock);
    const created = await createContactRequestApi(TECH_ID, "tok", {
      session_id: null,
      message: "My laptop will not power on.",
    });
    expect(created.id).toBe(REQ_ID);
    expect(fetchMock).toHaveBeenCalledWith(...bearerCall(`/api/v1/technicians/${TECH_ID}/contact`));
  });

  it("lists the inbox by role with auth", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { requests: [REQUEST] }));
    vi.stubGlobal("fetch", fetchMock);
    const inbox = await listContactRequestsApi("tok", "received");
    expect(inbox.requests).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledWith(...bearerCall("/api/v1/technicians/requests?role=received"));
  });

  it("patches request status and unwraps the envelope", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { request: { ...REQUEST, status: "accepted" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const updated = await updateContactRequestApi(REQ_ID, "tok", "accepted");
    expect(updated.status).toBe("accepted");
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/v1/technicians/requests/${REQ_ID}`),
      expect.objectContaining({ method: "PATCH" }),
    );
  });

  it("creates consented handoffs with auth", async () => {
    const handoff = {
      id: "dddddddd-0000-4000-8000-dddddddddddd",
      request_id: REQ_ID,
      session_id: SESSION.id,
      shared_evidence_ids: [],
      shared_report: true,
      created_by_user_id: "cccccccc-0000-4000-8000-cccccccccccc",
      created_at: "2026-11-01T00:00:00.000Z",
    };
    const fetchMock = vi.fn(async () => jsonResponse(201, { handoff }));
    vi.stubGlobal("fetch", fetchMock);
    const created = await createHandoffApi(REQ_ID, "tok", {
      session_id: SESSION.id,
      shared_evidence_ids: [],
      shared_report: true,
    });
    expect(created.shared_report).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`/api/v1/technicians/requests/${REQ_ID}/handoff`),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("reads handoff detail with session summary and consent scope", async () => {
    const handoff = {
      id: "dddddddd-0000-4000-8000-dddddddddddd",
      request_id: REQ_ID,
      session_id: SESSION.id,
      shared_evidence_ids: [],
      shared_report: false,
      created_by_user_id: "cccccccc-0000-4000-8000-cccccccccccc",
      created_at: "2026-11-01T00:00:00.000Z",
    };
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, { handoff, session: SESSION, evidence: [], report: null }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const detail = await getHandoffApi(REQ_ID, "tok");
    expect(detail.session.id).toBe(SESSION.id);
    expect(detail.report).toBeNull();
    expect(fetchMock).toHaveBeenCalledWith(...bearerCall(`/api/v1/technicians/requests/${REQ_ID}/handoff`));
  });

  it("surfaces contact errors from the envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(422, {
          error: { code: "not_accepting", message: "Not accepting requests right now." },
        }),
      ),
    );
    await expect(
      createContactRequestApi(TECH_ID, "tok", { session_id: null, message: "Hi" }),
    ).rejects.toMatchObject({ status: 422, code: "not_accepting" });
  });

  it("loads the own technician card and unwraps the envelope", async () => {
    const { distance_km: _ignored, ...card } = LIST_ITEM;
    const fetchMock = vi.fn(async () =>
      jsonResponse(200, {
        technician: { ...card, phone: null, contact_email: null, whatsapp: null },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const own = await getOwnTechnicianProfileApi("tok");
    expect(own?.display_name).toBe("Riley Repairs");
    expect(fetchMock).toHaveBeenCalledWith(...bearerCall("/api/v1/technicians/me"));
  });

  it("returns null when the caller has no technician profile", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse(404, {
        error: { code: "profile_not_found", message: "You have no technician profile yet." },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(getOwnTechnicianProfileApi("tok")).resolves.toBeNull();
  });

  it("upserts the own profile with auth and unwraps the envelope", async () => {
    const { distance_km: _ignored, ...card } = LIST_ITEM;
    const fetchMock = vi.fn(async () =>
      jsonResponse(201, {
        technician: { ...card, city: "Dallas", phone: null, contact_email: null, whatsapp: null },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const saved = await upsertOwnTechnicianProfileApi("tok", {
      display_name: "Riley Repairs",
      city: "Dallas",
      region: "TX",
      postal_code: null,
      latitude: null,
      longitude: null,
      specialties: [],
      device_types: [],
      phone: null,
      contact_email: null,
      whatsapp: null,
      about: null,
      accepting_requests: true,
    });
    expect(saved.city).toBe("Dallas");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/v1/technicians/me");
    expect(init.method).toBe("PUT");
  });
});

describe("emailReportCopyApi", () => {
  it("posts to the session report email endpoint", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(200, { ok: true }));
    vi.stubGlobal("fetch", fetchMock);
    await emailReportCopyApi("session-1", "tok");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/v1/sessions/session-1/report/email");
    expect(init.method).toBe("POST");
  });
});
