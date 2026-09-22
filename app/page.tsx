"use client";

import { useEffect, useMemo, useState } from "react";
import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type User,
} from "firebase/auth";
import {
  Timestamp,
  collection,
  doc,
  getDocs,
  increment,
  serverTimestamp,
  setDoc,
  updateDoc,
} from "firebase/firestore";
import { auth, db } from "@/lib/firebase";

type Meaning = {
  meaning: string;
  korean: string;
  example: string;
};

type WordAnalysis = {
  word: string;
  pronunciation?: string;
  partOfSpeech?: string;
  meanings?: Meaning[];
  etymology?: string;
  synonyms?: string[];
  antonyms?: string[];
  relatedWords?: string[];
  collocations?: string[];
  examples?: string[];
  interviewUsage?: string;
  academicUsage?: string;
};

type VocabularyItem = {
  id: string;
  word: string;
  analysis: WordAnalysis;
  createdAt?: any;
  reviewCount?: number;
  mastery?: number;
  nextReview?: any;
  lastReviewedAt?: any;
};

type Plan = {
  goalMinutes: number;
  goalWords: number;
  completedMinutes: number;
  completedWords: number;
  completedReviews: number;
  completedInterview: boolean;
  completedReading: boolean;
  notes: string;
};

type TestQuestion = {
  word: string;
  meaning: string;
  choices: string[];
  answer: number;
};

type InterviewData = {
  question: string;
  context: string;
  sampleAnswer: string;
  keyPoints: string[];
  followUp: string;
};

type InterviewResult = {
  score: number;
  strengths: string[];
  corrections: {
    original: string;
    better: string;
    reason: string;
  }[];
  improvedAnswer: string;
  nextTip: string;
};

type ReadingData = {
  title: string;
  passage: string;
  questions: {
    question: string;
    options: string[];
    answer: number;
    explanation: string;
  }[];
};

const tabs = [
  ["dashboard", "🏠", "대시보드"],
  ["vocabulary", "📚", "단어 분석"],
  ["dictionary", "📔", "사전"],
  ["review", "🔄", "복습"],
  ["test", "📝", "오늘의 테스트"],
  ["interview", "🎤", "AI 면접"],
  ["reading", "📖", "독해"],
  ["planner", "📅", "플래너"],
] as const;

function dateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, days: number) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function toDate(value: any): Date | null {
  if (!value) return null;

  if (value instanceof Timestamp) {
    return value.toDate();
  }

  if (typeof value?.toDate === "function") {
    return value.toDate();
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function shuffle<T>(array: T[]) {
  return [...array].sort(() => Math.random() - 0.5);
}

function percent(done: number, goal: number) {
  if (!goal) return 0;
  return Math.min(100, Math.round((done / goal) * 100));
}

function defaultPlan(): Plan {
  return {
    goalMinutes: 30,
    goalWords: 10,
    completedMinutes: 0,
    completedWords: 0,
    completedReviews: 0,
    completedInterview: false,
    completedReading: false,
    notes: "",
  };
}

function mondayOf(date: Date) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [loadingAuth, setLoadingAuth] = useState(true);
  const [tab, setTab] = useState("dashboard");
  const [message, setMessage] = useState("");

  const [vocabulary, setVocabulary] = useState<VocabularyItem[]>([]);
  const [plans, setPlans] = useState<Record<string, Plan>>({});

  const [wordInput, setWordInput] = useState("abandon");
  const [wordLoading, setWordLoading] = useState(false);
  const [analysis, setAnalysis] = useState<WordAnalysis | null>(null);
  const [dictionaryHit, setDictionaryHit] = useState<string | null>(null);
  const [highlightWord, setHighlightWord] = useState<string | null>(null);

  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewLoading, setReviewLoading] = useState(false);

  const [testQuestions, setTestQuestions] = useState<TestQuestion[]>([]);
  const [testIndex, setTestIndex] = useState(0);
  const [testSelected, setTestSelected] = useState<number | null>(null);
  const [testScore, setTestScore] = useState(0);
  const [testFinished, setTestFinished] = useState(false);

  const [interviewLevel, setInterviewLevel] = useState("Intermediate");
  const [interviewType, setInterviewType] = useState("General Job Interview");
  const [interview, setInterview] = useState<InterviewData | null>(null);
  const [interviewAnswer, setInterviewAnswer] = useState("");
  const [interviewResult, setInterviewResult] =
    useState<InterviewResult | null>(null);
  const [interviewLoading, setInterviewLoading] = useState(false);
  const [listening, setListening] = useState(false);

  const [readingTopic, setReadingTopic] = useState("Technology");
  const [readingLevel, setReadingLevel] = useState("Intermediate");
  const [reading, setReading] = useState<ReadingData | null>(null);
  const [readingAnswers, setReadingAnswers] = useState<
    Record<number, number>
  >({});
  const [readingScore, setReadingScore] = useState<number | null>(null);
  const [readingLoading, setReadingLoading] = useState(false);

  const [weekOffset, setWeekOffset] = useState(0);
  const [selectedPlanDate, setSelectedPlanDate] = useState(dateKey());
  const [planDraft, setPlanDraft] = useState<Plan>(defaultPlan());

  const currentWeek = useMemo(() => {
    const monday = mondayOf(addDays(new Date(), weekOffset * 7));

    return Array.from({ length: 7 }, (_, index) => addDays(monday, index));
  }, [weekOffset]);

  const dueWords = useMemo(() => {
    const now = new Date();

    return vocabulary.filter((item) => {
      const next = toDate(item.nextReview);
      return !next || next <= now;
    });
  }, [vocabulary]);

  const today = plans[dateKey()] || defaultPlan();

  const weekAverage = useMemo(() => {
    if (!currentWeek.length) return 0;

    const total = currentWeek.reduce((sum, date) => {
      const plan = plans[dateKey(date)] || defaultPlan();

      const minutePct = percent(plan.completedMinutes, plan.goalMinutes);
      const wordPct = percent(plan.completedWords, plan.goalWords);

      return sum + Math.round((minutePct + wordPct) / 2);
    }, 0);

    return Math.round(total / currentWeek.length);
  }, [currentWeek, plans]);

  const [dictSearch, setDictSearch] = useState("");

  // 저장 데이터 자체의 순서는 건드리지 않고, 사전 탭을 그릴 때만
  // 검색어로 거르고 알파벳순으로 묶는다. vocabulary가 커져도
  // 정렬/저장 로직에는 영향 없음.
  const dictionaryGroups = useMemo(() => {
    const query = dictSearch.trim().toLowerCase();

    const filtered = query
      ? vocabulary.filter((item) => {
          const word = item.word.toLowerCase();
          const meanings =
            item.analysis?.meanings
              ?.map((m) => `${m.meaning} ${m.korean}`)
              .join(" ")
              .toLowerCase() || "";
          return word.includes(query) || meanings.includes(query);
        })
      : vocabulary;

    const sorted = [...filtered].sort((a, b) =>
      a.word.toLowerCase().localeCompare(b.word.toLowerCase())
    );

    const groups = new Map<string, VocabularyItem[]>();
    for (const item of sorted) {
      const first = item.word.trim().charAt(0).toUpperCase();
      const letter = /[A-Z]/.test(first) ? first : "#";
      if (!groups.has(letter)) groups.set(letter, []);
      groups.get(letter)!.push(item);
    }
    return groups;
  }, [vocabulary, dictSearch]);

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("");

  useEffect(() => {
    if (tab !== "dictionary" || !highlightWord) return;

    const timer = window.setTimeout(() => {
      const el = document.getElementById(`dict-word-${highlightWord}`);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);

    return () => window.clearTimeout(timer);
  }, [tab, highlightWord]);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      setUser(currentUser);
      setLoadingAuth(false);

      if (currentUser) {
        await loadData(currentUser.uid);
      }
    });

    return () => unsubscribe();
  }, []);

  async function loadData(uid = user?.uid) {
    if (!uid) return;

    try {
      const vocabularySnapshot = await getDocs(
        collection(db, "users", uid, "vocabulary")
      );

      const vocabularyData = vocabularySnapshot.docs.map((item) => {
        const data = item.data();

        return {
          id: item.id,
          word: data.word || decodeURIComponent(item.id),
          analysis: data.analysis || {},
          createdAt: data.createdAt,
          reviewCount: data.reviewCount || 0,
          mastery: data.mastery || 0,
          nextReview: data.nextReview,
          lastReviewedAt: data.lastReviewedAt,
        };
      });

      vocabularyData.sort((a, b) => {
        const da = toDate(a.createdAt)?.getTime() || 0;
        const db = toDate(b.createdAt)?.getTime() || 0;
        return db - da;
      });

      setVocabulary(vocabularyData);

      const planSnapshot = await getDocs(
        collection(db, "users", uid, "plans")
      );

      const planData: Record<string, Plan> = {};

      planSnapshot.docs.forEach((item) => {
        planData[item.id] = {
          ...defaultPlan(),
          ...item.data(),
        } as Plan;
      });

      setPlans(planData);
    } catch (error) {
      console.error(error);
      setMessage("데이터를 불러오지 못했습니다.");
    }
  }

  async function loginWithGoogle() {
    try {
      setMessage("");

      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({
        prompt: "select_account",
      });

      await signInWithPopup(auth, provider);
    } catch (error: any) {
      console.error(error);
      setMessage(
        error?.message || "Google 로그인에 실패했습니다. 팝업 차단 여부를 확인해주세요."
      );
    }
  }

  async function logout() {
    await signOut(auth);
    setVocabulary([]);
    setPlans({});
    setAnalysis(null);
  }

  async function callAI(action: string, payload: Record<string, unknown>) {
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 50000);

    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          action,
          ...payload,
        }),
        signal: controller.signal,
      });

      const text = await response.text();
      let data: any = {};

      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        throw new Error(
          `AI 서버가 올바른 응답을 보내지 않았습니다. (HTTP ${response.status})`
        );
      }

      if (!response.ok) {
        const details = data?.details ? `\n${String(data.details).slice(0, 500)}` : "";
        throw new Error(
          `${data?.error || `AI 요청에 실패했습니다. (HTTP ${response.status})`}${details}`
        );
      }

      if (!data?.result) {
        throw new Error("AI 분석 결과가 비어 있습니다.");
      }

      return data.result;
    } catch (error: any) {
      if (error?.name === "AbortError") {
        throw new Error("AI 응답이 너무 오래 걸리고 있습니다. 잠시 후 다시 시도해주세요.");
      }
      throw error;
    } finally {
      window.clearTimeout(timeoutId);
    }
  }

  async function analyzeWord() {
    const trimmed = wordInput.trim();
    if (!trimmed) return;

    const normalized = trimmed.toLowerCase();

    // 이미 저장해둔 단어면 AI를 다시 부르지 않고 저장된 결과를 바로 보여준다.
    const existing = vocabulary.find(
      (item) => item.word.toLowerCase() === normalized
    );

    if (existing) {
      setAnalysis(existing.analysis);
      setDictionaryHit(normalized);
      setMessage(
        `"${existing.word}"는 이미 저장된 단어예요. 아래에서 바로 확인하거나 사전 탭에서 볼 수 있어요.`
      );
      return;
    }

    setDictionaryHit(null);
    setWordLoading(true);
    setMessage("");

    try {
      const result = await callAI("analyzeWord", {
        word: trimmed,
      });

      setAnalysis(result);
    } catch (error: any) {
      setMessage(error?.message || "단어 분석에 실패했습니다.");
    } finally {
      setWordLoading(false);
    }
  }

  function openInDictionary(word: string) {
    const normalized = word.toLowerCase();
    setDictSearch("");
    setHighlightWord(normalized);
    setTab("dictionary");
  }

  async function saveWord() {
    if (!user || !analysis?.word) return;

    try {
      const normalized = analysis.word.toLowerCase().trim();
      const id = encodeURIComponent(normalized);

      const existing = vocabulary.find(
        (item) => item.word.toLowerCase() === normalized
      );

      const ref = doc(db, "users", user.uid, "vocabulary", id);

      await setDoc(
        ref,
        {
          word: analysis.word,
          analysis,
          createdAt: existing?.createdAt || serverTimestamp(),
          reviewCount: existing?.reviewCount || 0,
          mastery: existing?.mastery || 0,
          nextReview:
            existing?.nextReview || Timestamp.fromDate(new Date()),
          lastReviewedAt: existing?.lastReviewedAt || null,
        },
        { merge: true }
      );

      await setDoc(
        doc(db, "users", user.uid, "plans", dateKey()),
        {
          completedWords: increment(1),
        },
        { merge: true }
      );

      setMessage(`"${analysis.word}" 단어가 단어장에 저장되었습니다.`);

      await loadData(user.uid);
    } catch (error) {
      console.error(error);
      setMessage("단어 저장에 실패했습니다.");
    }
  }

  async function reviewWord(known: boolean) {
    if (!user || !dueWords.length) return;

    const current = dueWords[reviewIndex];

    if (!current) return;

    setReviewLoading(true);

    try {
      const currentCount = current.reviewCount || 0;
      const currentMastery = current.mastery || 0;

      let nextReview: Date;
      let mastery: number;

      if (known) {
        const intervals = [1, 3, 7, 14, 30, 60];
        const days =
          intervals[Math.min(currentCount, intervals.length - 1)];

        nextReview = addDays(new Date(), days);
        mastery = Math.min(100, currentMastery + 15);
      } else {
        nextReview = addDays(new Date(), 1);
        mastery = Math.max(0, currentMastery - 10);
      }

      const ref = doc(
        db,
        "users",
        user.uid,
        "vocabulary",
        current.id
      );

      await updateDoc(ref, {
        reviewCount: known ? currentCount + 1 : currentCount,
        mastery,
        nextReview: Timestamp.fromDate(nextReview),
        lastReviewedAt: serverTimestamp(),
      });

      await setDoc(
        doc(db, "users", user.uid, "plans", dateKey()),
        {
          completedReviews: increment(1),
          completedMinutes: increment(2),
        },
        { merge: true }
      );

      if (reviewIndex >= dueWords.length - 1) {
        setReviewIndex(0);
      } else {
        setReviewIndex(reviewIndex + 1);
      }

      await loadData(user.uid);
    } catch (error) {
      console.error(error);
      setMessage("복습 기록 저장에 실패했습니다.");
    } finally {
      setReviewLoading(false);
    }
  }

  function createTest() {
    if (vocabulary.length < 4) {
      setMessage("테스트를 만들려면 단어장에 최소 4개의 단어가 필요합니다.");
      return;
    }

    const source = shuffle(vocabulary).slice(
      0,
      Math.min(10, vocabulary.length)
    );

    const questions: TestQuestion[] = source.map((item) => {
      const correctMeaning =
        item.analysis?.meanings?.[0]?.korean ||
        item.analysis?.meanings?.[0]?.meaning ||
        "뜻 정보 없음";

      const distractors = shuffle(
        vocabulary
          .filter((other) => other.id !== item.id)
          .map(
            (other) =>
              other.analysis?.meanings?.[0]?.korean ||
              other.analysis?.meanings?.[0]?.meaning ||
              "뜻 정보 없음"
          )
          .filter((meaning) => meaning !== correctMeaning)
      ).slice(0, 3);

      const choices = shuffle([correctMeaning, ...distractors]);

      return {
        word: item.word,
        meaning: correctMeaning,
        choices,
        answer: choices.indexOf(correctMeaning),
      };
    });

    setTestQuestions(questions);
    setTestIndex(0);
    setTestSelected(null);
    setTestScore(0);
    setTestFinished(false);
    setTab("test");
  }

  async function nextTestQuestion() {
    if (testSelected === null) return;

    const current = testQuestions[testIndex];
    const correct = testSelected === current.answer;
    const newScore = testScore + (correct ? 1 : 0);

    if (testIndex >= testQuestions.length - 1) {
      setTestScore(newScore);
      setTestFinished(true);

      if (user) {
        await setDoc(
          doc(db, "users", user.uid, "plans", dateKey()),
          {
            completedMinutes: increment(10),
          },
          { merge: true }
        );

        await loadData(user.uid);
      }

      return;
    }

    setTestScore(newScore);
    setTestIndex(testIndex + 1);
    setTestSelected(null);
  }

  async function generateInterview() {
    setInterviewLoading(true);
    setInterviewResult(null);
    setInterviewAnswer("");
    setMessage("");

    try {
      const result = await callAI("interview", {
        level: interviewLevel,
        type: interviewType,
      });

      setInterview(result);
    } catch (error: any) {
      setMessage(error?.message || "면접 질문 생성에 실패했습니다.");
    } finally {
      setInterviewLoading(false);
    }
  }

  async function evaluateInterview() {
    if (!interview || !interviewAnswer.trim()) {
      setMessage("먼저 영어 답변을 입력해주세요.");
      return;
    }

    setInterviewLoading(true);

    try {
      const result = await callAI("evaluateInterview", {
        question: interview.question,
        answer: interviewAnswer,
      });

      setInterviewResult(result);

      if (user) {
        await setDoc(
          doc(db, "users", user.uid, "plans", dateKey()),
          {
            completedMinutes: increment(15),
            completedInterview: true,
          },
          { merge: true }
        );

        await loadData(user.uid);
      }
    } catch (error: any) {
      setMessage(error?.message || "면접 평가에 실패했습니다.");
    } finally {
      setInterviewLoading(false);
    }
  }

  function speak(text: string) {
    if (typeof window === "undefined") return;
    if (!("speechSynthesis" in window)) {
      setMessage("이 브라우저에서는 음성 읽기를 지원하지 않습니다.");
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "en-US";
    utterance.rate = 0.9;

    window.speechSynthesis.speak(utterance);
  }

  function startListening() {
    if (typeof window === "undefined") return;

    const SpeechRecognition =
      (window as any).SpeechRecognition ||
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setMessage(
        "이 브라우저에서는 음성 입력을 지원하지 않습니다. Chrome 사용을 권장합니다."
      );
      return;
    }

    const recognition = new SpeechRecognition();

    recognition.lang = "en-US";
    recognition.continuous = false;
    recognition.interimResults = true;

    recognition.onstart = () => setListening(true);

    recognition.onresult = (event: any) => {
      let transcript = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
      }

      setInterviewAnswer(transcript);
    };

    recognition.onerror = () => {
      setListening(false);
    };

    recognition.onend = () => {
      setListening(false);
    };

    recognition.start();
  }

  async function generateReading() {
    setReadingLoading(true);
    setReading(null);
    setReadingAnswers({});
    setReadingScore(null);

    try {
      const result = await callAI("reading", {
        topic: readingTopic,
        level: readingLevel,
      });

      setReading(result);
    } catch (error: any) {
      setMessage(error?.message || "독해 생성에 실패했습니다.");
    } finally {
      setReadingLoading(false);
    }
  }

  async function gradeReading() {
    if (!reading) return;

    let score = 0;

    reading.questions.forEach((question, index) => {
      if (readingAnswers[index] === question.answer) {
        score += 1;
      }
    });

    setReadingScore(score);

    if (user) {
      await setDoc(
        doc(db, "users", user.uid, "plans", dateKey()),
        {
          completedMinutes: increment(10),
          completedReading: true,
        },
        { merge: true }
      );

      await loadData(user.uid);
    }
  }

  function openPlan(date: Date) {
    const key = dateKey(date);

    setSelectedPlanDate(key);
    setPlanDraft(plans[key] || defaultPlan());
  }

  async function savePlan() {
    if (!user) return;

    try {
      await setDoc(
        doc(db, "users", user.uid, "plans", selectedPlanDate),
        planDraft,
        { merge: true }
      );

      setPlans((prev) => ({
        ...prev,
        [selectedPlanDate]: planDraft,
      }));

      setMessage("플래너가 저장되었습니다.");
    } catch (error) {
      console.error(error);
      setMessage("플래너 저장에 실패했습니다.");
    }
  }

  if (loadingAuth) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 text-white">
        <div className="text-center">
          <div className="mb-3 text-4xl">📚</div>
          <p className="text-zinc-400">English Trainer 로딩 중...</p>
        </div>
      </main>
    );
  }

  if (!user) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-zinc-950 px-6 text-white">
        <div className="w-full max-w-md rounded-3xl border border-zinc-800 bg-zinc-900 p-8 shadow-2xl">
          <div className="mb-8 text-center">
            <div className="mb-4 text-5xl">📚</div>

            <h1 className="text-3xl font-bold">
              English Trainer
            </h1>

            <p className="mt-3 text-sm leading-6 text-zinc-400">
              단어 · 복습 · 면접 · 독해 · 스피킹 · 학습계획을
              하나로 관리하세요.
            </p>
          </div>

          <button
            onClick={loginWithGoogle}
            className="flex w-full items-center justify-center gap-3 rounded-2xl bg-white px-5 py-4 font-semibold text-zinc-900 transition hover:bg-zinc-200"
          >
            <span className="text-xl">G</span>
            Google로 시작하기
          </button>

          {message && (
            <p className="mt-4 rounded-xl bg-red-950/40 p-3 text-sm text-red-300">
              {message}
            </p>
          )}
        </div>
      </main>
    );
  }

  const currentReview = dueWords[reviewIndex];

  return (
    <main className="min-h-screen bg-zinc-950 text-white">
      <header className="sticky top-0 z-20 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4">
          <button
            onClick={() => setTab("dashboard")}
            className="text-left"
          >
            <div className="text-lg font-bold">📚 English Trainer</div>
            <div className="text-xs text-zinc-500">
              영어를 꾸준히 쌓는 개인 학습 시스템
            </div>
          </button>

          <div className="flex items-center gap-3">
            <div className="hidden text-right sm:block">
              <div className="text-sm font-medium">
                {user.displayName || "Google User"}
              </div>
              <div className="text-xs text-zinc-500">
                {user.email}
              </div>
            </div>

            <div className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-800 font-bold">
              {(user.displayName || user.email || "U")
                .charAt(0)
                .toUpperCase()}
            </div>

            <button
              onClick={logout}
              className="rounded-xl border border-zinc-700 px-3 py-2 text-xs text-zinc-300 hover:bg-zinc-800"
            >
              로그아웃
            </button>
          </div>
        </div>

        <div className="mx-auto max-w-7xl overflow-x-auto px-4 pb-3">
          <div className="flex min-w-max gap-2">
            {tabs.map(([id, icon, label]) => (
              <button
                key={id}
                onClick={() => setTab(id)}
                className={`rounded-xl px-4 py-2 text-sm transition ${
                  tab === id
                    ? "bg-white text-zinc-900"
                    : "bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-white"
                }`}
              >
                {icon} {label}
              </button>
            ))}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-4 py-6">
        {message && (
          <div className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-zinc-800 bg-zinc-900 p-4 text-sm text-zinc-300">
            <span>{message}</span>
            <div className="flex shrink-0 items-center gap-2">
              {dictionaryHit && (
                <button
                  onClick={() => {
                    openInDictionary(dictionaryHit);
                    setMessage("");
                  }}
                  className="rounded-lg bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900"
                >
                  📔 사전에서 보기
                </button>
              )}
              <button
                onClick={() => {
                  setMessage("");
                  setDictionaryHit(null);
                }}
                className="text-zinc-500 hover:text-white"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        {tab === "dashboard" && (
          <section className="space-y-6">
            <div>
              <p className="text-sm text-zinc-500">TODAY</p>
              <h1 className="mt-1 text-3xl font-bold">
                {user.displayName?.split(" ")[0] || "학습자"}님의 학습 대시보드
              </h1>
              <p className="mt-2 text-zinc-400">
                오늘도 조금씩 쌓으면 영어 실력이 됩니다.
              </p>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <StatCard
                icon="📚"
                title="내 단어"
                value={`${vocabulary.length}`}
                subtitle="저장된 단어"
              />

              <StatCard
                icon="🔄"
                title="오늘 복습"
                value={`${dueWords.length}`}
                subtitle="복습할 단어"
              />

              <StatCard
                icon="🎯"
                title="오늘 목표"
                value={`${Math.round(
                  (percent(today.completedMinutes, today.goalMinutes) +
                    percent(today.completedWords, today.goalWords)) /
                    2
                )}%`}
                subtitle={`${today.completedMinutes}/${today.goalMinutes}분 · ${today.completedWords}/${today.goalWords}단어`}
              />

              <StatCard
                icon="📈"
                title="이번 주"
                value={`${weekAverage}%`}
                subtitle="주간 평균 달성률"
              />
            </div>

            <div className="grid gap-5 lg:grid-cols-3">
              <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 lg:col-span-2">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-xl font-bold">오늘의 목표</h2>
                    <p className="mt-1 text-sm text-zinc-500">
                      플래너에서 목표를 변경할 수 있습니다.
                    </p>
                  </div>

                  <button
                    onClick={() => setTab("planner")}
                    className="rounded-xl bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700"
                  >
                    플래너 →
                  </button>
                </div>

                <div className="mt-6 space-y-5">
                  <ProgressRow
                    label="학습 시간"
                    done={today.completedMinutes}
                    goal={today.goalMinutes}
                    unit="분"
                  />

                  <ProgressRow
                    label="단어"
                    done={today.completedWords}
                    goal={today.goalWords}
                    unit="개"
                  />

                  <ProgressRow
                    label="복습"
                    done={today.completedReviews}
                    goal={Math.max(5, Math.min(20, dueWords.length))}
                    unit="회"
                  />
                </div>
              </div>

              <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
                <h2 className="text-xl font-bold">빠른 학습</h2>

                <div className="mt-5 grid gap-3">
                  <QuickButton
                    icon="🔍"
                    label="새 단어 분석"
                    onClick={() => setTab("vocabulary")}
                  />

                  <QuickButton
                    icon="🔄"
                    label="복습 시작"
                    onClick={() => setTab("review")}
                  />

                  <QuickButton
                    icon="🎤"
                    label="AI 면접"
                    onClick={() => setTab("interview")}
                  />

                  <QuickButton
                    icon="📖"
                    label="독해 연습"
                    onClick={() => setTab("reading")}
                  />

                  <QuickButton
                    icon="📝"
                    label="오늘의 테스트"
                    onClick={createTest}
                  />
                </div>
              </div>
            </div>

            <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
              <h2 className="text-xl font-bold">최근 단어</h2>

              {vocabulary.length === 0 ? (
                <p className="mt-5 text-zinc-500">
                  아직 저장한 단어가 없습니다.
                </p>
              ) : (
                <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {vocabulary.slice(0, 8).map((item) => (
                    <button
                      key={item.id}
                      onClick={() => {
                        setAnalysis(item.analysis);
                        setTab("vocabulary");
                      }}
                      className="rounded-2xl border border-zinc-800 bg-zinc-950 p-4 text-left hover:border-zinc-600"
                    >
                      <div className="font-semibold">{item.word}</div>

                      <div className="mt-1 text-sm text-zinc-500">
                        {item.analysis?.meanings?.[0]?.korean ||
                          item.analysis?.meanings?.[0]?.meaning ||
                          "뜻 정보 없음"}
                      </div>

                      <div className="mt-3 text-xs text-zinc-600">
                        숙련도 {item.mastery || 0}%
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </section>
        )}

        {tab === "vocabulary" && (
          <section className="space-y-6">
            <PageTitle
              title="📚 단어 분석"
              subtitle="영어 단어의 의미, 어원, 유의어, 반의어, 활용까지 분석합니다."
            />

            <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  value={wordInput}
                  onChange={(event) => setWordInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") analyzeWord();
                  }}
                  placeholder="영어 단어를 입력하세요."
                  className="flex-1 rounded-2xl border border-zinc-700 bg-zinc-950 px-5 py-4 outline-none focus:border-zinc-400"
                />

                <button
                  onClick={analyzeWord}
                  disabled={wordLoading}
                  className="rounded-2xl bg-white px-7 py-4 font-semibold text-zinc-900 disabled:opacity-50"
                >
                  {wordLoading ? "분석 중..." : "AI 분석"}
                </button>
              </div>
            </div>

            {analysis && (
              <div className="grid gap-5 lg:grid-cols-3">
                <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 lg:col-span-2">
                  <div className="flex flex-wrap items-start justify-between gap-4">
                    <div>
                      <h2 className="text-4xl font-bold">
                        {analysis.word}
                      </h2>

                      <div className="mt-2 flex flex-wrap gap-2 text-sm text-zinc-400">
                        {analysis.pronunciation && (
                          <span>/{analysis.pronunciation}/</span>
                        )}

                        {analysis.partOfSpeech && (
                          <span className="rounded-lg bg-zinc-800 px-2 py-1">
                            {analysis.partOfSpeech}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <button
                        onClick={() =>
                          speak(
                            `${analysis.word}. ${
                              analysis.meanings?.[0]?.example || ""
                            }`
                          )
                        }
                        className="rounded-xl bg-zinc-800 px-4 py-2 text-sm hover:bg-zinc-700"
                      >
                        🔊 듣기
                      </button>

                      <button
                        onClick={saveWord}
                        className="rounded-xl bg-white px-4 py-2 text-sm font-semibold text-zinc-900"
                      >
                        + 단어장 저장
                      </button>
                    </div>
                  </div>

                  <div className="mt-8 space-y-7">
                    <AnalysisSection title="📖 의미">
                      <div className="space-y-4">
                        {analysis.meanings?.map((meaning, index) => (
                          <div
                            key={index}
                            className="rounded-2xl bg-zinc-950 p-4"
                          >
                            <div className="font-semibold">
                              {index + 1}. {meaning.meaning}
                            </div>

                            <div className="mt-1 text-zinc-300">
                              {meaning.korean}
                            </div>

                            <div className="mt-3 text-sm italic text-zinc-500">
                              “{meaning.example}”
                            </div>
                          </div>
                        ))}
                      </div>
                    </AnalysisSection>

                    <AnalysisSection title="🌱 어원">
                      <p className="leading-7 text-zinc-300">
                        {analysis.etymology || "정보 없음"}
                      </p>
                    </AnalysisSection>

                    <AnalysisSection title="🔗 유의어">
                      <TagList items={analysis.synonyms} />
                    </AnalysisSection>

                    <AnalysisSection title="↔️ 반의어">
                      <TagList items={analysis.antonyms} />
                    </AnalysisSection>

                    <AnalysisSection title="🧩 관련 단어">
                      <TagList items={analysis.relatedWords} />
                    </AnalysisSection>

                    <AnalysisSection title="💬 콜로케이션">
                      <TagList items={analysis.collocations} />
                    </AnalysisSection>

                    <AnalysisSection title="📝 추가 예문">
                      <div className="space-y-2">
                        {analysis.examples?.map((example, index) => (
                          <div
                            key={index}
                            className="rounded-xl bg-zinc-950 p-3 text-zinc-300"
                          >
                            {example}
                          </div>
                        ))}
                      </div>
                    </AnalysisSection>
                  </div>
                </div>

                <div className="space-y-5">
                  <InfoCard
                    title="🎤 면접에서"
                    text={
                      analysis.interviewUsage ||
                      "면접 활용 정보가 없습니다."
                    }
                  />

                  <InfoCard
                    title="🎓 학술 영어에서"
                    text={
                      analysis.academicUsage ||
                      "학술 활용 정보가 없습니다."
                    }
                  />

                  <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
                    <h3 className="font-bold">📔 사전</h3>

                    <p className="mt-2 text-sm text-zinc-500">
                      현재 {vocabulary.length}개의 단어를 저장했습니다.
                    </p>

                    <button
                      onClick={() => setTab("dictionary")}
                      className="mt-5 w-full rounded-xl bg-zinc-800 px-4 py-3 text-sm hover:bg-zinc-700"
                    >
                      사전에서 전체 보기 →
                    </button>
                  </div>
                </div>
              </div>
            )}
          </section>
        )}

        {tab === "dictionary" && (
          <section className="space-y-6">
            <PageTitle
              title="📔 사전"
              subtitle="지금까지 저장한 단어를 실제 사전처럼 A-Z 순서로 모아봤어요."
            />

            {vocabulary.length === 0 ? (
              <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-8 text-center text-zinc-500">
                아직 저장한 단어가 없어요. 단어 분석 탭에서 먼저 단어를
                분석하고 저장해보세요.
              </div>
            ) : (
              <>
                <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-4">
                  <input
                    value={dictSearch}
                    onChange={(event) => setDictSearch(event.target.value)}
                    placeholder="단어나 뜻으로 검색 (예: apple, 사과)"
                    className="w-full rounded-2xl border border-zinc-700 bg-zinc-950 px-5 py-3 outline-none focus:border-zinc-400"
                  />
                </div>

                {dictSearch && dictionaryGroups.size === 0 && (
                  <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-8 text-center text-zinc-500">
                    "{dictSearch}"에 해당하는 저장된 단어가 없어요.
                  </div>
                )}

                {/* A-Z 인덱스 바: 저장된 단어가 없는 글자는 흐리게 비활성 */}
                <div className="sticky top-[64px] z-20 -mx-4 border-b border-zinc-800 bg-zinc-950/95 px-4 py-3 backdrop-blur">
                  <div className="flex flex-wrap gap-1.5">
                    {alphabet.map((letter) => {
                      const hasWords = dictionaryGroups.has(letter);
                      return (
                        <button
                          key={letter}
                          disabled={!hasWords}
                          onClick={() => {
                            document
                              .getElementById(`dict-letter-${letter}`)
                              ?.scrollIntoView({
                                behavior: "smooth",
                                block: "start",
                              });
                          }}
                          className={`h-8 w-8 rounded-lg text-sm font-semibold transition ${
                            hasWords
                              ? "bg-zinc-800 text-white hover:bg-zinc-700"
                              : "cursor-not-allowed bg-zinc-900 text-zinc-700"
                          }`}
                        >
                          {letter}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-8">
                  {alphabet
                    .filter((letter) => dictionaryGroups.has(letter))
                    .map((letter) => (
                      <div key={letter} id={`dict-letter-${letter}`}>
                        <div className="mb-3 flex items-center gap-3">
                          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-white text-lg font-bold text-zinc-900">
                            {letter}
                          </span>
                          <span className="text-sm text-zinc-500">
                            {dictionaryGroups.get(letter)!.length}개 단어
                          </span>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                          {dictionaryGroups.get(letter)!.map((item) => {
                            const isHighlighted =
                              highlightWord === item.word.toLowerCase();
                            return (
                              <button
                                key={item.id}
                                id={`dict-word-${item.word.toLowerCase()}`}
                                onClick={() => {
                                  setAnalysis(item.analysis);
                                  setWordInput(item.word);
                                  setTab("vocabulary");
                                }}
                                className={`rounded-2xl border p-4 text-left transition ${
                                  isHighlighted
                                    ? "border-white bg-zinc-800 ring-2 ring-white"
                                    : "border-zinc-800 bg-zinc-900 hover:border-zinc-600"
                                }`}
                              >
                                <div className="font-semibold">
                                  {item.word}
                                </div>
                                <div className="mt-1 text-sm text-zinc-500">
                                  {item.analysis?.meanings?.[0]?.korean ||
                                    item.analysis?.meanings?.[0]?.meaning}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                </div>
              </>
            )}
          </section>
        )}

        {tab === "review" && (
          <section className="space-y-6">
            <PageTitle
              title="🔄 망각곡선 복습"
              subtitle="아는 단어는 간격을 늘리고, 어려운 단어는 빠르게 다시 만납니다."
            />

            {!currentReview ? (
              <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-10 text-center">
                <div className="text-5xl">🎉</div>
                <h2 className="mt-5 text-2xl font-bold">
                  오늘 복습할 단어가 없습니다.
                </h2>
                <p className="mt-2 text-zinc-500">
                  새로운 단어를 추가하거나 다른 학습을 진행해보세요.
                </p>

                <button
                  onClick={() => setTab("vocabulary")}
                  className="mt-6 rounded-xl bg-white px-5 py-3 font-semibold text-zinc-900"
                >
                  새 단어 추가
                </button>
              </div>
            ) : (
              <div className="mx-auto max-w-2xl rounded-3xl border border-zinc-800 bg-zinc-900 p-8">
                <div className="flex justify-between text-sm text-zinc-500">
                  <span>
                    {reviewIndex + 1} / {dueWords.length}
                  </span>

                  <span>
                    숙련도 {currentReview.mastery || 0}%
                  </span>
                </div>

                <div className="py-16 text-center">
                  <div className="text-5xl font-bold">
                    {currentReview.word}
                  </div>

                  <button
                    onClick={() =>
                      speak(
                        currentReview.word +
                          ". " +
                          (currentReview.analysis?.meanings?.[0]
                            ?.example || "")
                      )
                    }
                    className="mt-5 rounded-xl bg-zinc-800 px-4 py-2 text-sm"
                  >
                    🔊 발음 듣기
                  </button>

                  <div className="mt-10 rounded-2xl bg-zinc-950 p-6 text-left">
                    <div className="text-sm text-zinc-500">
                      의미
                    </div>

                    <div className="mt-2 text-lg">
                      {currentReview.analysis?.meanings?.[0]?.korean ||
                        currentReview.analysis?.meanings?.[0]?.meaning ||
                        "뜻 정보 없음"}
                    </div>

                    {currentReview.analysis?.meanings?.[0]?.example && (
                      <div className="mt-4 text-sm italic text-zinc-500">
                        {currentReview.analysis.meanings[0].example}
                      </div>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <button
                    onClick={() => reviewWord(false)}
                    disabled={reviewLoading}
                    className="rounded-2xl border border-red-900/50 bg-red-950/30 px-5 py-4 font-semibold text-red-300"
                  >
                    😵 어려워요
                  </button>

                  <button
                    onClick={() => reviewWord(true)}
                    disabled={reviewLoading}
                    className="rounded-2xl border border-emerald-900/50 bg-emerald-950/30 px-5 py-4 font-semibold text-emerald-300"
                  >
                    😊 알고 있어요
                  </button>
                </div>
              </div>
            )}
          </section>
        )}

        {tab === "test" && (
          <section className="space-y-6">
            <PageTitle
              title="📝 오늘의 단어 테스트"
              subtitle="저장한 단어를 기반으로 자동으로 테스트를 만듭니다."
            />

            {!testQuestions.length && !testFinished && (
              <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-10 text-center">
                <div className="text-5xl">📝</div>

                <h2 className="mt-5 text-2xl font-bold">
                  오늘의 테스트
                </h2>

                <p className="mt-2 text-zinc-500">
                  단어장에서 최대 10개를 랜덤으로 출제합니다.
                </p>

                <button
                  onClick={createTest}
                  disabled={vocabulary.length < 4}
                  className="mt-6 rounded-xl bg-white px-6 py-3 font-semibold text-zinc-900 disabled:opacity-40"
                >
                  테스트 시작
                </button>

                {vocabulary.length < 4 && (
                  <p className="mt-3 text-sm text-zinc-600">
                    최소 4개의 단어가 필요합니다.
                  </p>
                )}
              </div>
            )}

            {testQuestions.length > 0 && !testFinished && (
              <div className="mx-auto max-w-2xl rounded-3xl border border-zinc-800 bg-zinc-900 p-8">
                <div className="flex justify-between text-sm text-zinc-500">
                  <span>
                    문제 {testIndex + 1} / {testQuestions.length}
                  </span>

                  <span>점수 {testScore}</span>
                </div>

                <div className="mt-10">
                  <p className="text-center text-sm text-zinc-500">
                    다음 단어의 뜻은?
                  </p>

                  <h2 className="mt-3 text-center text-4xl font-bold">
                    {testQuestions[testIndex].word}
                  </h2>

                  <div className="mt-8 grid gap-3">
                    {testQuestions[testIndex].choices.map(
                      (choice, index) => {
                        const selected =
                          testSelected === index;

                        const correct =
                          testSelected !== null &&
                          index ===
                            testQuestions[testIndex].answer;

                        return (
                          <button
                            key={index}
                            onClick={() =>
                              setTestSelected(index)
                            }
                            className={`rounded-2xl border p-4 text-left transition ${
                              correct
                                ? "border-emerald-500 bg-emerald-950/40"
                                : selected
                                ? "border-white bg-zinc-800"
                                : "border-zinc-800 bg-zinc-950 hover:border-zinc-600"
                            }`}
                          >
                            <span className="mr-3 text-zinc-600">
                              {index + 1}
                            </span>
                            {choice}
                          </button>
                        );
                      }
                    )}
                  </div>

                  <button
                    onClick={nextTestQuestion}
                    disabled={testSelected === null}
                    className="mt-6 w-full rounded-2xl bg-white px-5 py-4 font-semibold text-zinc-900 disabled:opacity-40"
                  >
                    {testIndex === testQuestions.length - 1
                      ? "결과 보기"
                      : "다음 문제"}
                  </button>
                </div>
              </div>
            )}

            {testFinished && (
              <div className="mx-auto max-w-xl rounded-3xl border border-zinc-800 bg-zinc-900 p-10 text-center">
                <div className="text-5xl">🏆</div>

                <h2 className="mt-5 text-3xl font-bold">
                  테스트 완료!
                </h2>

                <div className="mt-6 text-6xl font-bold">
                  {testScore}
                  <span className="text-2xl text-zinc-500">
                    {" "}
                    / {testQuestions.length}
                  </span>
                </div>

                <button
                  onClick={createTest}
                  className="mt-8 rounded-xl bg-white px-6 py-3 font-semibold text-zinc-900"
                >
                  다시 테스트
                </button>
              </div>
            )}
          </section>
        )}

        {tab === "interview" && (
          <section className="space-y-6">
            <PageTitle
              title="🎤 AI 영어 면접"
              subtitle="실제 면접처럼 질문에 답하고 AI에게 영어 표현과 구조를 평가받습니다."
            />

            <div className="grid gap-5 lg:grid-cols-3">
              <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
                <h2 className="text-xl font-bold">면접 설정</h2>

                <label className="mt-5 block text-sm text-zinc-500">
                  영어 수준
                </label>

                <select
                  value={interviewLevel}
                  onChange={(event) =>
                    setInterviewLevel(event.target.value)
                  }
                  className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3"
                >
                  <option>Beginner</option>
                  <option>Intermediate</option>
                  <option>Upper-Intermediate</option>
                  <option>Advanced</option>
                </select>

                <label className="mt-5 block text-sm text-zinc-500">
                  면접 유형
                </label>

                <select
                  value={interviewType}
                  onChange={(event) =>
                    setInterviewType(event.target.value)
                  }
                  className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3"
                >
                  <option>General Job Interview</option>
                  <option>Self Introduction</option>
                  <option>Behavioral Interview</option>
                  <option>Technical Interview</option>
                  <option>University Interview</option>
                </select>

                <button
                  onClick={generateInterview}
                  disabled={interviewLoading}
                  className="mt-6 w-full rounded-xl bg-white px-4 py-3 font-semibold text-zinc-900 disabled:opacity-50"
                >
                  {interviewLoading
                    ? "AI 준비 중..."
                    : "새 질문 만들기"}
                </button>
              </div>

              <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6 lg:col-span-2">
                {!interview ? (
                  <div className="flex min-h-[420px] items-center justify-center text-center">
                    <div>
                      <div className="text-5xl">🎤</div>
                      <p className="mt-4 text-zinc-500">
                        왼쪽에서 면접을 시작하세요.
                      </p>
                    </div>
                  </div>
                ) : (
                  <>
                    <div className="rounded-2xl bg-zinc-950 p-6">
                      <div className="text-xs uppercase tracking-widest text-zinc-600">
                        Interview Question
                      </div>

                      <h2 className="mt-3 text-2xl font-bold leading-relaxed">
                        {interview.question}
                      </h2>

                      {interview.context && (
                        <p className="mt-3 text-sm leading-6 text-zinc-500">
                          {interview.context}
                        </p>
                      )}

                      <button
                        onClick={() => speak(interview.question)}
                        className="mt-4 rounded-xl bg-zinc-800 px-4 py-2 text-sm"
                      >
                        🔊 질문 듣기
                      </button>
                    </div>

                    <div className="mt-5">
                      <div className="mb-2 flex justify-between">
                        <label className="text-sm text-zinc-400">
                          Your Answer
                        </label>

                        <button
                          onClick={startListening}
                          className={`text-sm ${
                            listening
                              ? "text-red-400"
                              : "text-zinc-400"
                          }`}
                        >
                          {listening
                            ? "🔴 듣는 중..."
                            : "🎙️ 음성으로 답하기"}
                        </button>
                      </div>

                      <textarea
                        value={interviewAnswer}
                        onChange={(event) =>
                          setInterviewAnswer(event.target.value)
                        }
                        rows={8}
                        placeholder="영어로 답변을 입력하세요..."
                        className="w-full rounded-2xl border border-zinc-700 bg-zinc-950 p-5 outline-none focus:border-zinc-400"
                      />

                      <div className="mt-3 flex gap-3">
                        <button
                          onClick={evaluateInterview}
                          disabled={
                            interviewLoading ||
                            !interviewAnswer.trim()
                          }
                          className="flex-1 rounded-xl bg-white px-5 py-3 font-semibold text-zinc-900 disabled:opacity-40"
                        >
                          AI 답변 평가
                        </button>

                        <button
                          onClick={() =>
                            speak(interviewAnswer)
                          }
                          disabled={!interviewAnswer}
                          className="rounded-xl bg-zinc-800 px-5 py-3 disabled:opacity-40"
                        >
                          🔊
                        </button>
                      </div>
                    </div>

                    {interviewResult && (
                      <div className="mt-6 space-y-4">
                        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-6 text-center">
                          <div className="text-sm text-zinc-500">
                            AI SCORE
                          </div>

                          <div className="mt-2 text-5xl font-bold">
                            {interviewResult.score}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
                          <h3 className="font-bold">👍 잘한 점</h3>

                          <ul className="mt-3 space-y-2 text-sm text-zinc-300">
                            {interviewResult.strengths?.map(
                              (item, index) => (
                                <li key={index}>• {item}</li>
                              )
                            )}
                          </ul>
                        </div>

                        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
                          <h3 className="font-bold">
                            ✏️ 개선할 표현
                          </h3>

                          <div className="mt-4 space-y-4">
                            {interviewResult.corrections?.map(
                              (item, index) => (
                                <div key={index}>
                                  <div className="text-sm text-red-300">
                                    {item.original}
                                  </div>

                                  <div className="mt-1 text-sm text-emerald-300">
                                    → {item.better}
                                  </div>

                                  <div className="mt-1 text-xs text-zinc-600">
                                    {item.reason}
                                  </div>
                                </div>
                              )
                            )}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5">
                          <h3 className="font-bold">
                            💡 더 자연스러운 답변
                          </h3>

                          <p className="mt-3 whitespace-pre-wrap leading-7 text-zinc-300">
                            {interviewResult.improvedAnswer}
                          </p>

                          <div className="mt-5 rounded-xl bg-zinc-900 p-4 text-sm text-zinc-400">
                            다음 팁: {interviewResult.nextTip}
                          </div>
                        </div>

                        <button
                          onClick={generateInterview}
                          className="w-full rounded-xl bg-white px-5 py-3 font-semibold text-zinc-900"
                        >
                          다음 질문 →
                        </button>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          </section>
        )}

        {tab === "reading" && (
          <section className="space-y-6">
            <PageTitle
              title="📖 AI 독해"
              subtitle="원하는 주제와 난이도로 영어 지문과 문제를 자동 생성합니다."
            />

            <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="text-sm text-zinc-500">
                    주제
                  </label>

                  <input
                    value={readingTopic}
                    onChange={(event) =>
                      setReadingTopic(event.target.value)
                    }
                    className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3"
                  />
                </div>

                <div>
                  <label className="text-sm text-zinc-500">
                    난이도
                  </label>

                  <select
                    value={readingLevel}
                    onChange={(event) =>
                      setReadingLevel(event.target.value)
                    }
                    className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3"
                  >
                    <option>Beginner</option>
                    <option>Intermediate</option>
                    <option>Upper-Intermediate</option>
                    <option>Advanced</option>
                  </select>
                </div>

                <div className="flex items-end">
                  <button
                    onClick={generateReading}
                    disabled={readingLoading}
                    className="w-full rounded-xl bg-white px-4 py-3 font-semibold text-zinc-900 disabled:opacity-50"
                  >
                    {readingLoading
                      ? "지문 생성 중..."
                      : "독해 만들기"}
                  </button>
                </div>
              </div>
            </div>

            {reading && (
              <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
                <h2 className="text-3xl font-bold">
                  {reading.title}
                </h2>

                <div className="mt-6 rounded-2xl bg-zinc-950 p-6">
                  <p className="whitespace-pre-wrap text-lg leading-8 text-zinc-300">
                    {reading.passage}
                  </p>

                  <button
                    onClick={() => speak(reading.passage)}
                    className="mt-5 rounded-xl bg-zinc-800 px-4 py-2 text-sm"
                  >
                    🔊 지문 듣기
                  </button>
                </div>

                <div className="mt-8 space-y-6">
                  {reading.questions.map((question, index) => (
                    <div
                      key={index}
                      className="rounded-2xl border border-zinc-800 bg-zinc-950 p-5"
                    >
                      <div className="font-semibold">
                        {index + 1}. {question.question}
                      </div>

                      <div className="mt-4 grid gap-2">
                        {question.options.map(
                          (option, optionIndex) => (
                            <button
                              key={optionIndex}
                              onClick={() =>
                                setReadingAnswers((prev) => ({
                                  ...prev,
                                  [index]: optionIndex,
                                }))
                              }
                              className={`rounded-xl border p-3 text-left ${
                                readingAnswers[index] ===
                                optionIndex
                                  ? "border-white bg-zinc-800"
                                  : "border-zinc-800 hover:border-zinc-600"
                              }`}
                            >
                              {optionIndex + 1}. {option}
                            </button>
                          )
                        )}
                      </div>

                      {readingScore !== null && (
                        <div className="mt-4 rounded-xl bg-zinc-900 p-4 text-sm">
                          <span
                            className={
                              readingAnswers[index] ===
                              question.answer
                                ? "text-emerald-400"
                                : "text-red-400"
                            }
                          >
                            {readingAnswers[index] ===
                            question.answer
                              ? "정답 ✓"
                              : "오답 ✕"}
                          </span>

                          <p className="mt-2 text-zinc-500">
                            {question.explanation}
                          </p>
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <button
                  onClick={gradeReading}
                  className="mt-6 w-full rounded-2xl bg-white px-5 py-4 font-semibold text-zinc-900"
                >
                  채점하기
                </button>

                {readingScore !== null && (
                  <div className="mt-5 rounded-2xl bg-zinc-950 p-6 text-center">
                    <div className="text-sm text-zinc-500">
                      SCORE
                    </div>

                    <div className="mt-2 text-5xl font-bold">
                      {readingScore} / {reading.questions.length}
                    </div>
                  </div>
                )}
              </div>
            )}
          </section>
        )}

        {tab === "planner" && (
          <section className="space-y-6">
            <PageTitle
              title="📅 주간 플래너"
              subtitle="학습 목표와 실제 달성률을 한눈에 관리합니다."
            />

            <div className="flex items-center justify-between rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
              <button
                onClick={() =>
                  setWeekOffset((value) => value - 1)
                }
                className="rounded-xl bg-zinc-800 px-4 py-2"
              >
                ← 이전
              </button>

              <div className="text-center">
                <div className="font-bold">
                  주간 달성률 {weekAverage}%
                </div>
                <div className="mt-1 text-xs text-zinc-500">
                  {currentWeek[0].toLocaleDateString()} ~{" "}
                  {currentWeek[6].toLocaleDateString()}
                </div>
              </div>

              <button
                onClick={() =>
                  setWeekOffset((value) => value + 1)
                }
                className="rounded-xl bg-zinc-800 px-4 py-2"
              >
                다음 →
              </button>
            </div>

            <div className="grid gap-3 md:grid-cols-7">
              {currentWeek.map((date) => {
                const key = dateKey(date);
                const plan = plans[key] || defaultPlan();

                const dayProgress = Math.round(
                  (percent(
                    plan.completedMinutes,
                    plan.goalMinutes
                  ) +
                    percent(
                      plan.completedWords,
                      plan.goalWords
                    )) /
                    2
                );

                const isSelected = selectedPlanDate === key;

                return (
                  <button
                    key={key}
                    onClick={() => openPlan(date)}
                    className={`rounded-2xl border p-4 text-left ${
                      isSelected
                        ? "border-white bg-zinc-800"
                        : "border-zinc-800 bg-zinc-900 hover:border-zinc-600"
                    }`}
                  >
                    <div className="text-xs text-zinc-500">
                      {date.toLocaleDateString("ko-KR", {
                        weekday: "short",
                      })}
                    </div>

                    <div className="mt-2 text-lg font-bold">
                      {date.getDate()}
                    </div>

                    <div className="mt-4 text-2xl font-bold">
                      {dayProgress}%
                    </div>

                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-800">
                      <div
                        className="h-full rounded-full bg-white"
                        style={{
                          width: `${dayProgress}%`,
                        }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>

            <div className="grid gap-5 lg:grid-cols-2">
              <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
                <h2 className="text-xl font-bold">
                  {selectedPlanDate} 목표
                </h2>

                <div className="mt-5 grid gap-4 sm:grid-cols-2">
                  <NumberInput
                    label="목표 학습시간(분)"
                    value={planDraft.goalMinutes}
                    onChange={(value) =>
                      setPlanDraft((prev) => ({
                        ...prev,
                        goalMinutes: value,
                      }))
                    }
                  />

                  <NumberInput
                    label="목표 단어 수"
                    value={planDraft.goalWords}
                    onChange={(value) =>
                      setPlanDraft((prev) => ({
                        ...prev,
                        goalWords: value,
                      }))
                    }
                  />

                  <NumberInput
                    label="완료 학습시간"
                    value={planDraft.completedMinutes}
                    onChange={(value) =>
                      setPlanDraft((prev) => ({
                        ...prev,
                        completedMinutes: value,
                      }))
                    }
                  />

                  <NumberInput
                    label="완료 단어"
                    value={planDraft.completedWords}
                    onChange={(value) =>
                      setPlanDraft((prev) => ({
                        ...prev,
                        completedWords: value,
                      }))
                    }
                  />
                </div>

                <label className="mt-5 block text-sm text-zinc-500">
                  메모
                </label>

                <textarea
                  value={planDraft.notes}
                  onChange={(event) =>
                    setPlanDraft((prev) => ({
                      ...prev,
                      notes: event.target.value,
                    }))
                  }
                  rows={5}
                  className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-4"
                  placeholder="오늘 공부할 내용..."
                />

                <button
                  onClick={savePlan}
                  className="mt-5 w-full rounded-xl bg-white px-5 py-3 font-semibold text-zinc-900"
                >
                  플래너 저장
                </button>
              </div>

              <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
                <h2 className="text-xl font-bold">
                  선택한 날의 달성률
                </h2>

                <div className="mt-6">
                  <div className="text-6xl font-bold">
                    {Math.round(
                      (percent(
                        planDraft.completedMinutes,
                        planDraft.goalMinutes
                      ) +
                        percent(
                          planDraft.completedWords,
                          planDraft.goalWords
                        )) /
                        2
                    )}
                    %
                  </div>

                  <div className="mt-6 space-y-4">
                    <ProgressRow
                      label="시간"
                      done={planDraft.completedMinutes}
                      goal={planDraft.goalMinutes}
                      unit="분"
                    />

                    <ProgressRow
                      label="단어"
                      done={planDraft.completedWords}
                      goal={planDraft.goalWords}
                      unit="개"
                    />

                    <div className="grid grid-cols-2 gap-3">
                      <MiniStat
                        label="복습"
                        value={`${planDraft.completedReviews}회`}
                      />

                      <MiniStat
                        label="면접"
                        value={
                          planDraft.completedInterview
                            ? "완료"
                            : "미완료"
                        }
                      />

                      <MiniStat
                        label="독해"
                        value={
                          planDraft.completedReading
                            ? "완료"
                            : "미완료"
                        }
                      />

                      <MiniStat
                        label="주간"
                        value={`${weekAverage}%`}
                      />
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </main>
  );
}

function PageTitle({
  title,
  subtitle,
}: {
  title: string;
  subtitle: string;
}) {
  return (
    <div>
      <h1 className="text-3xl font-bold">{title}</h1>
      <p className="mt-2 text-zinc-500">{subtitle}</p>
    </div>
  );
}

function StatCard({
  icon,
  title,
  value,
  subtitle,
}: {
  icon: string;
  title: string;
  value: string;
  subtitle: string;
}) {
  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-5">
      <div className="text-2xl">{icon}</div>

      <div className="mt-4 text-sm text-zinc-500">{title}</div>

      <div className="mt-1 text-3xl font-bold">{value}</div>

      <div className="mt-1 text-xs text-zinc-600">
        {subtitle}
      </div>
    </div>
  );
}

function QuickButton({
  icon,
  label,
  onClick,
}: {
  icon: string;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3 rounded-2xl border border-zinc-800 bg-zinc-950 p-4 text-left hover:border-zinc-600"
    >
      <span className="text-xl">{icon}</span>
      <span className="text-sm font-medium">{label}</span>
      <span className="ml-auto text-zinc-600">→</span>
    </button>
  );
}

function ProgressRow({
  label,
  done,
  goal,
  unit,
}: {
  label: string;
  done: number;
  goal: number;
  unit: string;
}) {
  const value = percent(done, goal);

  return (
    <div>
      <div className="flex justify-between text-sm">
        <span className="text-zinc-400">{label}</span>
        <span>
          {done}/{goal}
          {unit}
        </span>
      </div>

      <div className="mt-2 h-2 overflow-hidden rounded-full bg-zinc-800">
        <div
          className="h-full rounded-full bg-white transition-all"
          style={{
            width: `${value}%`,
          }}
        />
      </div>
    </div>
  );
}

function AnalysisSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h3 className="mb-3 text-lg font-bold">{title}</h3>
      {children}
    </section>
  );
}

function TagList({ items }: { items?: string[] }) {
  if (!items?.length) {
    return <p className="text-sm text-zinc-600">정보 없음</p>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item, index) => (
        <span
          key={index}
          className="rounded-xl bg-zinc-950 px-3 py-2 text-sm text-zinc-300"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function InfoCard({
  title,
  text,
}: {
  title: string;
  text: string;
}) {
  return (
    <div className="rounded-3xl border border-zinc-800 bg-zinc-900 p-6">
      <h3 className="font-bold">{title}</h3>
      <p className="mt-4 whitespace-pre-wrap text-sm leading-7 text-zinc-400">
        {text}
      </p>
    </div>
  );
}

function NumberInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
}) {
  return (
    <div>
      <label className="text-sm text-zinc-500">{label}</label>

      <input
        type="number"
        min={0}
        value={value}
        onChange={(event) =>
          onChange(Number(event.target.value))
        }
        className="mt-2 w-full rounded-xl border border-zinc-700 bg-zinc-950 p-3"
      />
    </div>
  );
}

function MiniStat({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-2xl bg-zinc-950 p-4">
      <div className="text-xs text-zinc-600">{label}</div>
      <div className="mt-1 font-bold">{value}</div>
    </div>
  );
}