import { NextResponse } from "next/server";

export const maxDuration = 60;

const NVIDIA_TIMEOUT_MS = 45000;

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

type Action =
  | "analyzeWord"
  | "interview"
  | "evaluateInterview"
  | "reading";

function extractJson(text: string) {
  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    // Some reasoning models still leak a <think>...</think> block into the
    // content field even with thinking disabled. Strip it defensively.
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .trim();

  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");

  if (first >= 0 && last > first) {
    return cleaned.slice(first, last + 1);
  }

  return cleaned;
}

function buildPrompt(action: Action, input: Record<string, unknown>) {
  if (action === "analyzeWord") {
    const word = String(input.word || "");

    return {
      system: `
You are an expert English dictionary, etymology, vocabulary and interview-English tutor.

Analyze the requested English word in depth.

Return ONLY valid JSON.
Do not use markdown.
Do not put JSON inside code fences.

Include:
- pronunciation
- part of speech
- major/common meanings
- Korean meanings
- example sentences
- etymology and roots
- synonyms
- antonyms
- related words
- collocations
- interview usage
- academic usage

Be accurate. If a word has multiple parts of speech or meanings, include them separately.

JSON format:
{
  "word": "",
  "pronunciation": "",
  "partOfSpeech": "",
  "meanings": [
    {
      "meaning": "",
      "korean": "",
      "example": ""
    }
  ],
  "etymology": "",
  "synonyms": [],
  "antonyms": [],
  "relatedWords": [],
  "collocations": [],
  "examples": [],
  "interviewUsage": "",
  "academicUsage": ""
}
`,
      user: `Analyze this English word: ${word}`,
    };
  }

  if (action === "interview") {
    const level = String(input.level || "Intermediate");
    const type = String(input.type || "General");

    return {
      system: `
You are an English interview coach.

Create one realistic English interview question.

Return ONLY valid JSON.
Do not use markdown.

JSON:
{
  "question": "",
  "context": "",
  "sampleAnswer": "",
  "keyPoints": [],
  "followUp": ""
}

The sample answer should sound natural rather than like a textbook.
`,
      user: `Level: ${level}
Interview type: ${type}`,
    };
  }

  if (action === "evaluateInterview") {
    const question = String(input.question || "");
    const answer = String(input.answer || "");

    return {
      system: `
You are an expert English speaking and interview evaluator.

Evaluate the user's English answer.

Return ONLY valid JSON.
Do not use markdown.

JSON:
{
  "score": 0,
  "strengths": [],
  "corrections": [
    {
      "original": "",
      "better": "",
      "reason": ""
    }
  ],
  "improvedAnswer": "",
  "nextTip": ""
}

Score from 0 to 100.

Focus on:
- grammar
- vocabulary
- naturalness
- clarity
- organization
- interview suitability

Write explanations in Korean, but corrected English should remain English.
`,
      user: `
Interview question:
${question}

User answer:
${answer}
`,
    };
  }

  if (action === "reading") {
    const topic = String(input.topic || "Technology");
    const level = String(input.level || "Intermediate");

    return {
      system: `
You are an expert English reading teacher.

Create a useful English reading passage and four multiple-choice questions.

Return ONLY valid JSON.
Do not use markdown.

JSON:
{
  "title": "",
  "passage": "",
  "questions": [
    {
      "question": "",
      "options": ["", "", "", ""],
      "answer": 0,
      "explanation": ""
    }
  ]
}

answer must be the zero-based index of the correct option.

The passage should be appropriate for the requested level.
`,
      user: `Topic: ${topic}
Level: ${level}`,
    };
  }

  throw new Error("Unknown action");
}

export async function POST(request: Request) {
  try {
    const body = await request.json();

    const action = body.action as Action;

    if (
      action !== "analyzeWord" &&
      action !== "interview" &&
      action !== "evaluateInterview" &&
      action !== "reading"
    ) {
      return NextResponse.json(
        { error: "지원하지 않는 AI 작업입니다." },
        { status: 400 }
      );
    }

    const apiKey = process.env.NVIDIA_API_KEY;
    const model = process.env.NVIDIA_MODEL;

    if (!apiKey) {
      return NextResponse.json(
        { error: "NVIDIA_API_KEY가 설정되지 않았습니다." },
        { status: 500 }
      );
    }

    if (!model) {
      return NextResponse.json(
        { error: "NVIDIA_MODEL이 설정되지 않았습니다." },
        { status: 500 }
      );
    }

    if (model.toLowerCase().includes("content-safety")) {
      return NextResponse.json(
        {
          error:
            "현재 NVIDIA_MODEL이 Content Safety 모델입니다. 일반적인 텍스트 생성용 Instruction 모델로 NVIDIA_MODEL을 변경해주세요.",
        },
        { status: 400 }
      );
    }

    const prompt = buildPrompt(action, body);

    let response: Response;

    try {
      response = await fetch(NVIDIA_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "system",
            content: prompt.system,
          },
          {
            role: "user",
            content: prompt.user,
          },
        ],
        temperature: 0.4,
        max_tokens: action === "analyzeWord" ? 2000 : action === "reading" ? 2200 : 1400,
        // Nemotron 3.5 Lightning defaults to "thinking" mode, which burns
        // max_tokens on chain-of-thought before writing the JSON answer and
        // can truncate or corrupt the JSON we need. Turn it off explicitly.
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: AbortSignal.timeout(NVIDIA_TIMEOUT_MS),
    });
    } catch (error) {
      if (error instanceof DOMException && error.name === "TimeoutError") {
        return NextResponse.json(
          { error: "NVIDIA AI 응답 시간이 초과되었습니다. 잠시 후 다시 시도해주세요." },
          { status: 504 }
        );
      }

      return NextResponse.json(
        {
          error:
            error instanceof Error
              ? `NVIDIA API 연결 실패: ${error.message}`
              : "NVIDIA API 연결에 실패했습니다.",
        },
        { status: 502 }
      );
    }

    const rawResponse = await response.text();

    if (!response.ok) {
      return NextResponse.json(
        {
          error: "NVIDIA API 요청에 실패했습니다.",
          details: rawResponse.slice(0, 2000),
        },
        { status: response.status }
      );
    }

    let data: any;

    try {
      data = JSON.parse(rawResponse);
    } catch {
      return NextResponse.json(
        {
          error: "NVIDIA API 응답을 JSON으로 읽을 수 없습니다.",
          details: rawResponse.slice(0, 2000),
        },
        { status: 500 }
      );
    }

    const finishReason = data?.choices?.[0]?.finish_reason;
    const content = data?.choices?.[0]?.message?.content;

    if (finishReason === "length" && (!content || content.length < 20)) {
      return NextResponse.json(
        {
          error:
            "AI 응답이 max_tokens 제한으로 잘렸습니다. 잠시 후 다시 시도해주세요.",
        },
        { status: 500 }
      );
    }

    if (!content) {
      return NextResponse.json(
        {
          error: "NVIDIA API에서 생성된 내용이 없습니다.",
          details: JSON.stringify(data).slice(0, 2000),
        },
        { status: 500 }
      );
    }

    const jsonText = extractJson(
      typeof content === "string" ? content : JSON.stringify(content)
    );

    let result: any;

    try {
      result = JSON.parse(jsonText);
    } catch {
      return NextResponse.json(
        {
          error: "AI가 올바른 JSON을 생성하지 못했습니다.",
          raw: content,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      result,
    });
  } catch (error) {
    console.error(error);

    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "알 수 없는 서버 오류가 발생했습니다.",
      },
      { status: 500 }
    );
  }
}