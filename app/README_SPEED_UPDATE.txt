English Trainer - Word Analysis Speed Optimization

Modified files:
- app/page.tsx
- app/api/ai/route.ts

What changed:
1. Keeps the full word-analysis fields: meanings, etymology, synonyms, antonyms,
   related words, collocations, examples, interview usage, academic usage,
   IPA, Korean pronunciation, base form and inflections.
2. Browser sessionStorage cache: a word analyzed once in the same browser session
   is shown instantly on repeated searches without another AI request.
3. In-flight request deduplication: repeated requests for the same word while an
   analysis is running share one AI request.
4. Warm server-side cache: recent word analyses can be reused for 30 minutes on
   the same warm server instance.
5. Word-analysis prompt was tightened for concise, information-dense wording,
   without intentionally removing major meanings or the requested information fields.
6. Word analysis uses temperature 0.2; other AI features retain their previous setting.
7. Optional NVIDIA_WORD_MODEL environment variable: if set, only word analysis
   uses that compatible NVIDIA model. If unset, the existing NVIDIA_MODEL is used.

No layout/PWA files are included because this update only changes the two requested files.
