"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Formula = {
  id: string;
  majorCategory: string;
  minorCategory: string;
  name: string;
  latex: string;
  description?: string;
  importance: number;
};

type PracticeProblem = {
  id: string;
  formulaId: string;
  majorCategory: string;
  minorCategory: string;
  formulaName: string;
  formulaLatex: string;
  question: string;
  latex: string;
  answer: string;
};

type View = "index" | "list" | "practice" | "problemIndex" | "problemList" | "problemPractice" | "stats";
type PracticeState = "question" | "error" | "answer";

type FormulaQuestion = {
  targets: string[];
  choices: string[];
  leftPrefix: string;
};

type ActivityStats = {
  attempts: number;
  correct: number;
  rememberedIds: string[];
  history: Array<{ id: string; correct: boolean; answeredAt: string }>;
  problemAttempts: number;
  problemCorrect: number;
  solvedProblemIds: string[];
  problemHistory: Array<{ id: string; correct: boolean; answeredAt: string }>;
};

const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";
const statsKey = "math-trainer-formula-stats";
const pastelClasses = ["mint", "peach", "green", "blue", "lime", "violet", "cream"];

const categoryIcons: Record<string, string> = {
  確率論: "P(A)",
  分布論: "N(μ)",
  統計: "x̄",
  線形代数: "Ax",
  微積分: "∫dx",
  確率過程: "Pᵢⱼ",
  保険数理: "PV",
  応用確率: "E[X]"
};

const emptyStats: ActivityStats = {
  attempts: 0,
  correct: 0,
  rememberedIds: [],
  history: [],
  problemAttempts: 0,
  problemCorrect: 0,
  solvedProblemIds: [],
  problemHistory: []
};

function groupBy<T>(items: T[], keyGetter: (item: T) => string) {
  return items.reduce<Record<string, T[]>>((groups, item) => {
    const key = keyGetter(item);
    groups[key] = groups[key] || [];
    groups[key].push(item);
    return groups;
  }, {});
}

function loadStats(): ActivityStats {
  if (typeof window === "undefined") return emptyStats;
  const raw = window.sessionStorage.getItem(statsKey);
  if (!raw) return emptyStats;
  try {
    const parsed = JSON.parse(raw) as ActivityStats;
    return {
      attempts: parsed.attempts || 0,
      correct: parsed.correct || 0,
      rememberedIds: Array.isArray(parsed.rememberedIds) ? parsed.rememberedIds : [],
      history: Array.isArray(parsed.history) ? parsed.history : [],
      problemAttempts: parsed.problemAttempts || 0,
      problemCorrect: parsed.problemCorrect || 0,
      solvedProblemIds: Array.isArray(parsed.solvedProblemIds) ? parsed.solvedProblemIds : [],
      problemHistory: Array.isArray(parsed.problemHistory) ? parsed.problemHistory : []
    };
  } catch {
    return emptyStats;
  }
}

function saveStats(stats: ActivityStats) {
  window.sessionStorage.setItem(statsKey, JSON.stringify(stats));
}

function formulaToTokens(latex: string) {
  return latex
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "$1 / $2")
    .replace(/\\sum_i/g, "Σᵢ")
    .replace(/\\sum/g, "Σ")
    .replace(/\\int/g, "∫")
    .replace(/\\cdots/g, "…")
    .replace(/\\cap/g, "∩")
    .replace(/\\cup/g, "∪")
    .replace(/\\le/g, "≤")
    .replace(/\\ge/g, "≥")
    .replace(/\\to/g, "→")
    .replace(/[{}]/g, "")
    .split(/(\s+|=|\+|-|\*|\/|\(|\)|\||,)/)
    .map((token) => token.trim())
    .filter((token) => token && token !== ",");
}

function findMainEqualsIndex(latex: string) {
  let braceDepth = 0;
  let parenDepth = 0;

  for (let index = 0; index < latex.length; index += 1) {
    const char = latex[index];
    if (char === "{") braceDepth += 1;
    if (char === "}") braceDepth = Math.max(0, braceDepth - 1);
    if (char === "(") parenDepth += 1;
    if (char === ")") parenDepth = Math.max(0, parenDepth - 1);
    if (char === "=" && braceDepth === 0 && parenDepth === 0) return index;
  }

  return -1;
}

function hasBalancedBraces(value: string) {
  let depth = 0;
  for (const char of value) {
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
}

function isSafeChoiceLatex(value: string) {
  if (!value || !hasBalancedBraces(value)) return false;
  if (/\\(?:frac|left|right)\b/.test(value)) return false;
  return true;
}

function isInsideLatexCommand(source: string, start: number) {
  let index = start - 1;
  while (index >= 0 && /[A-Za-z]/.test(source[index])) {
    index -= 1;
  }
  return source[index] === "\\";
}

function readBraceContent(source: string, openIndex: number) {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    const char = source[index];
    if (char === "{") depth += 1;
    if (char === "}") depth -= 1;
    if (depth === 0) {
      return {
        content: source.slice(openIndex + 1, index),
        end: index + 1
      };
    }
  }
  return { content: source.slice(openIndex + 1), end: source.length };
}

function latexToAnswerTokens(latex: string): string[] {
  const commandMap: Record<string, string> = {
    cap: "∩",
    cup: "∪",
    le: "≤",
    ge: "≥",
    to: "→",
    pm: "±",
    sum: "Σ",
    int: "∫",
    cdots: "…",
    lambda: "λ",
    mu: "μ",
    sigma: "σ",
    theta: "θ",
    pi: "π",
    rho: "ρ",
    alpha: "α",
    beta: "β",
    partial: "∂"
  };
  const tokens: string[] = [];

  for (let index = 0; index < latex.length; index += 1) {
    const char = latex[index];
    if (/\s/.test(char) || char === "}") continue;

    if (char === "{") {
      const content = readBraceContent(latex, index);
      tokens.push(content.content);
      index = content.end - 1;
      continue;
    }

    if (char === "\\") {
      const commandMatch = latex.slice(index + 1).match(/^[A-Za-z]+/);
      const command = commandMatch?.[0] || "";

      if (command === "frac") {
        let cursor = index + 1 + command.length;
        if (latex[cursor] === "{") {
          const numerator = readBraceContent(latex, cursor);
          cursor = numerator.end;
          if (latex[cursor] === "{") {
            const denominator = readBraceContent(latex, cursor);
            tokens.push(...latexToAnswerTokens(numerator.content), "/", ...latexToAnswerTokens(denominator.content));
            index = denominator.end - 1;
            continue;
          }
        }
      }

      if (command === "sqrt" || command === "bar" || command === "overline") {
        let cursor = index + 1 + command.length;
        if (latex[cursor] === "{") {
          const content = readBraceContent(latex, cursor);
          if (command === "sqrt") tokens.push("√", "(");
          tokens.push(...latexToAnswerTokens(content.content));
          if (command === "sqrt") tokens.push(")");
          index = content.end - 1;
          continue;
        }
      }

      tokens.push(commandMap[command] || command || char);
      index += command.length;
      continue;
    }

    tokens.push(char);
  }

  return mergeScriptTokens(tokens.filter(Boolean));
}

function mergeScriptTokens(tokens: string[]) {
  const merged: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if ((token === "_" || token === "^") && merged.length > 0 && tokens[index + 1]) {
      const base = merged.pop();
      const script = tokens[index + 1];
      merged.push(`${base}${token}${script}`);
      index += 1;
    } else {
      merged.push(token);
    }
  }

  return merged;
}

function makeQuestion(formula: Formula, allFormulas: Formula[]) {
  const equalIndex = findMainEqualsIndex(formula.latex);
  const leftPrefix = equalIndex >= 0 ? formula.latex.slice(0, equalIndex + 1) : "";
  const rhs = equalIndex >= 0 ? formula.latex.slice(equalIndex + 1) : formula.latex;
  const safeTargets = latexToAnswerTokens(rhs);

  const distractors = allFormulas
    .flatMap((item) => latexToAnswerTokens(item.latex))
    .filter((token) => isSafeChoiceLatex(token) && !safeTargets.includes(token) && token.length <= 8)
    .filter((token, index, array) => array.indexOf(token) === index)
    .slice(0, 10);

  const choices = [...safeTargets, ...distractors]
    .filter((choice, index, array) => array.indexOf(choice) === index)
    .slice(0, 18);
  const shuffled = choices
    .map((choice, index) => ({ choice, sort: (choice.charCodeAt(0) * 17 + index * 31) % 97 }))
    .sort((a, b) => a.sort - b.sort)
    .map((item) => item.choice);

  return {
    targets: safeTargets,
    choices: shuffled,
    leftPrefix
  };
}

function makeProblemQuestion(problem: PracticeProblem, allProblems: PracticeProblem[]) {
  const targets = latexToAnswerTokens(problem.answer);
  const distractors = allProblems
    .flatMap((item) => latexToAnswerTokens(item.answer))
    .filter((token) => isSafeChoiceLatex(token) && !targets.includes(token) && token.length <= 8)
    .filter((token, index, array) => array.indexOf(token) === index)
    .slice(0, 12);
  const choices = [...targets, ...distractors]
    .filter((choice, index, array) => array.indexOf(choice) === index)
    .slice(0, 18);
  const shuffled = choices
    .map((choice, index) => ({ choice, sort: (choice.charCodeAt(0) * 19 + index * 29) % 101 }))
    .sort((a, b) => a.sort - b.sort)
    .map((item) => item.choice);

  return {
    targets,
    choices: shuffled,
    leftPrefix: ""
  };
}

function mathText(latex: string) {
  return `\\(${latex}\\)`;
}

export default function Home() {
  const [formulas, setFormulas] = useState<Formula[]>([]);
  const [problems, setProblems] = useState<PracticeProblem[]>([]);
  const [view, setView] = useState<View>("index");
  const [selectedMajor, setSelectedMajor] = useState<string | null>(null);
  const [selectedMinor, setSelectedMinor] = useState<string | null>(null);
  const [selectedProblemMajor, setSelectedProblemMajor] = useState<string | null>(null);
  const [selectedProblemMinor, setSelectedProblemMinor] = useState<string | null>(null);
  const [currentFormulaId, setCurrentFormulaId] = useState<string | null>(null);
  const [currentProblemId, setCurrentProblemId] = useState<string | null>(null);
  const [practiceState, setPracticeState] = useState<PracticeState>("question");
  const [placedChoices, setPlacedChoices] = useState<string[]>([]);
  const [draggingChoice, setDraggingChoice] = useState<string | null>(null);
  const [showProblemHint, setShowProblemHint] = useState(false);
  const [stats, setStats] = useState<ActivityStats>(emptyStats);
  const dropRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setStats(loadStats());
    fetch(`${basePath}/formulas/formulas.json`)
      .then((response) => {
        if (!response.ok) throw new Error("formulas.json を読み込めませんでした。");
        return response.json();
      })
      .then((data: { formulas: Formula[] }) => {
        setFormulas(data.formulas);
        setCurrentFormulaId(data.formulas[0]?.id ?? null);
      });
    fetch(`${basePath}/problems/problems.json`)
      .then((response) => {
        if (!response.ok) throw new Error("problems.json を読み込めませんでした。");
        return response.json();
      })
      .then((data: { problems: PracticeProblem[] }) => {
        setProblems(data.problems);
        setCurrentProblemId(data.problems[0]?.id ?? null);
      })
      .catch(() => {
        setProblems([]);
      });
  }, []);

  useEffect(() => {
    const mathJax = (window as typeof window & { MathJax?: { typesetPromise?: () => Promise<void> } }).MathJax;
    mathJax?.typesetPromise?.();
  }, [formulas, problems, view, selectedMajor, selectedMinor, selectedProblemMajor, selectedProblemMinor, currentFormulaId, currentProblemId, practiceState, placedChoices, showProblemHint]);

  const currentFormula = useMemo(
    () => formulas.find((formula) => formula.id === currentFormulaId) || formulas[0],
    [currentFormulaId, formulas]
  );
  const question = useMemo(
    () => (currentFormula ? makeQuestion(currentFormula, formulas) : null),
    [currentFormula, formulas]
  );
  const currentProblem = useMemo(
    () => problems.find((problem) => problem.id === currentProblemId) || problems[0],
    [currentProblemId, problems]
  );
  const problemQuestion = useMemo(
    () => (currentProblem ? makeProblemQuestion(currentProblem, problems) : null),
    [currentProblem, problems]
  );
  const activeQuestion = view === "problemPractice" ? problemQuestion : question;
  const majorGroups = useMemo(() => groupBy(formulas, (formula) => formula.majorCategory), [formulas]);
  const categoryRows = useMemo(
    () =>
      Object.entries(majorGroups).flatMap(([major, majorFormulas]) =>
        Object.entries(groupBy(majorFormulas, (formula) => formula.minorCategory)).map(([minor, minorFormulas]) => ({
          major,
          minor,
          formulas: minorFormulas
        }))
      ),
    [majorGroups]
  );
  const listedFormulas = useMemo(
    () =>
      formulas.filter(
        (formula) =>
          (!selectedMajor || formula.majorCategory === selectedMajor) &&
          (!selectedMinor || formula.minorCategory === selectedMinor)
      ),
    [formulas, selectedMajor, selectedMinor]
  );
  const problemMajorGroups = useMemo(() => groupBy(problems, (problem) => problem.majorCategory), [problems]);
  const problemCategoryRows = useMemo(
    () =>
      Object.entries(problemMajorGroups).flatMap(([major, majorProblems]) =>
        Object.entries(groupBy(majorProblems, (problem) => problem.minorCategory)).map(([minor, minorProblems]) => ({
          major,
          minor,
          problems: minorProblems
        }))
      ),
    [problemMajorGroups]
  );
  const listedProblems = useMemo(
    () =>
      problems.filter(
        (problem) =>
          (!selectedProblemMajor || problem.majorCategory === selectedProblemMajor) &&
          (!selectedProblemMinor || problem.minorCategory === selectedProblemMinor)
      ),
    [problems, selectedProblemMajor, selectedProblemMinor]
  );
  const rememberedSet = useMemo(() => new Set(stats.rememberedIds), [stats.rememberedIds]);
  const solvedProblemSet = useMemo(() => new Set(stats.solvedProblemIds), [stats.solvedProblemIds]);
  const completeRate = formulas.length ? Math.round((rememberedSet.size / formulas.length) * 100) : 0;
  const correctRate = stats.attempts ? Math.round((stats.correct / stats.attempts) * 100) : 0;
  const problemCompleteRate = problems.length ? Math.round((solvedProblemSet.size / problems.length) * 100) : 0;
  const problemCorrectRate = stats.problemAttempts ? Math.round((stats.problemCorrect / stats.problemAttempts) * 100) : 0;

  function openList(major: string, minor: string | null = null) {
    setSelectedMajor(major);
    setSelectedMinor(minor);
    setView("list");
  }

  function openProblemList(major: string, minor: string | null = null) {
    setSelectedProblemMajor(major);
    setSelectedProblemMinor(minor);
    setView("problemList");
  }

  function startPractice(formula = currentFormula) {
    if (!formula) return;
    setCurrentFormulaId(formula.id);
    setPlacedChoices([]);
    setPracticeState("question");
    setView("practice");
  }

  function startProblemPractice(problem = currentProblem) {
    if (!problem) return;
    setCurrentProblemId(problem.id);
    setPlacedChoices([]);
    setPracticeState("question");
    setShowProblemHint(false);
    setView("problemPractice");
  }

  function backToFormulaList() {
    if (currentFormula) {
      setSelectedMajor(currentFormula.majorCategory);
      setSelectedMinor(currentFormula.minorCategory);
    }
    setView("list");
  }

  function backToProblemList() {
    if (currentProblem) {
      setSelectedProblemMajor(currentProblem.majorCategory);
      setSelectedProblemMinor(currentProblem.minorCategory);
    }
    setView("problemList");
  }

  function updateStats(correct: boolean, formula: Formula) {
    const nextRemembered = correct
      ? Array.from(new Set([...stats.rememberedIds, formula.id]))
      : stats.rememberedIds;
    const nextStats = {
      ...stats,
      attempts: stats.attempts + 1,
      correct: stats.correct + (correct ? 1 : 0),
      rememberedIds: nextRemembered,
      history: [{ id: formula.id, correct, answeredAt: new Date().toISOString() }, ...stats.history].slice(0, 50)
    };
    setStats(nextStats);
    saveStats(nextStats);
  }

  function updateProblemStats(correct: boolean, problem: PracticeProblem) {
    const nextSolvedProblemIds = correct
      ? Array.from(new Set([...stats.solvedProblemIds, problem.id]))
      : stats.solvedProblemIds;
    const nextStats = {
      ...stats,
      problemAttempts: stats.problemAttempts + 1,
      problemCorrect: stats.problemCorrect + (correct ? 1 : 0),
      solvedProblemIds: nextSolvedProblemIds,
      problemHistory: [{ id: problem.id, correct, answeredAt: new Date().toISOString() }, ...stats.problemHistory].slice(0, 50)
    };
    setStats(nextStats);
    saveStats(nextStats);
  }

  function submitAnswer() {
    if (!currentFormula || !question) return;
    const correct =
      question.targets.length === placedChoices.length &&
      question.targets.every((target, index) => placedChoices[index] === target);
    updateStats(correct, currentFormula);
    setPracticeState(correct ? "answer" : "error");
  }

  function submitProblemAnswer() {
    if (!currentProblem || !problemQuestion) return;
    const correct =
      problemQuestion.targets.length === placedChoices.length &&
      problemQuestion.targets.every((target, index) => placedChoices[index] === target);
    updateProblemStats(correct, currentProblem);
    setPracticeState(correct ? "answer" : "error");
  }

  function revealProblemHint() {
    setShowProblemHint(true);
  }

  function revealAnswer() {
    setPracticeState("answer");
  }

  function nextFormula() {
    if (!currentFormula) return;
    const currentIndex = formulas.findIndex((formula) => formula.id === currentFormula.id);
    const next = formulas[(currentIndex + 1) % formulas.length];
    startPractice(next);
  }

  function nextProblem() {
    if (!currentProblem) return;
    const currentIndex = problems.findIndex((problem) => problem.id === currentProblem.id);
    const next = problems[(currentIndex + 1) % problems.length];
    startProblemPractice(next);
  }

  function handleChoicePointerUp(choice: string, event: React.PointerEvent<HTMLButtonElement>) {
    const rect = dropRef.current?.getBoundingClientRect();
    const inside =
      rect &&
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;
    setDraggingChoice(null);
    if (inside) placeChoice(choice);
  }

  function placeChoice(choice: string) {
    if (!activeQuestion) return;
    setPlacedChoices((current) => {
      const next = Array.from(
        { length: activeQuestion.targets.length },
        (_, index) => current[index] || ""
      );
      const emptyIndex = next.findIndex((value) => !value);
      if (emptyIndex >= 0) {
        next[emptyIndex] = choice;
        return next;
      }
      return [...next.slice(1), choice];
    });
  }

  function clearPlacedChoice(index?: number) {
    if (index === undefined) {
      setPlacedChoices([]);
      return;
    }
    setPlacedChoices((current) => {
      const next = [...current];
      next[index] = "";
      return next;
    });
  }

  function revealAnswerHint() {
    if (!activeQuestion) return;
    setPlacedChoices((current) => {
      const next = Array.from(
        { length: activeQuestion.targets.length },
        (_, index) => current[index] || ""
      );
      const blankIndexes = next
        .map((value, index) => (value ? -1 : index))
        .filter((index) => index >= 0);
      const revealCount = Math.max(1, Math.ceil(activeQuestion.targets.length * 0.3));
      blankIndexes.slice(0, revealCount).forEach((index) => {
        next[index] = activeQuestion.targets[index];
      });
      return next;
    });
  }

  return (
    <main className="app-shell">
      <section className="app-frame">
        <header className="app-header">
          <button type="button" className="hamburger" aria-label="menu">
            <span />
            <span />
            <span />
          </button>
          <h1>数学・トレーナー</h1>
        </header>

        <div className="screen-content">
          {view === "index" ? (
            <IndexView
              categoryRows={categoryRows}
              rememberedSet={rememberedSet}
              onOpenList={openList}
            />
          ) : null}

          {view === "list" ? (
            <FormulaListView
              title={selectedMinor || selectedMajor || "公式一覧"}
              formulas={listedFormulas}
              rememberedSet={rememberedSet}
              onBack={() => setView("index")}
              onPractice={startPractice}
            />
          ) : null}

          {view === "practice" && currentFormula && question ? (
            <PracticeView
              complete={rememberedSet.size}
              total={formulas.length}
              formula={currentFormula}
              question={question}
              placedChoices={placedChoices}
              draggingChoice={draggingChoice}
              practiceState={practiceState}
              dropRef={dropRef}
              onChoicePointerDown={setDraggingChoice}
              onChoicePointerUp={handleChoicePointerUp}
              onPlaceChoice={placeChoice}
              onClearChoice={clearPlacedChoice}
              onRevealHint={revealAnswerHint}
              onSubmit={submitAnswer}
              onSkip={nextFormula}
              onNext={nextFormula}
              onRevealAnswer={revealAnswer}
              onBack={backToFormulaList}
            />
          ) : null}

          {view === "stats" ? (
            <StatsView
              formulas={formulas}
              problems={problems}
              rememberedSet={rememberedSet}
              solvedProblemSet={solvedProblemSet}
              stats={stats}
              completeRate={completeRate}
              correctRate={correctRate}
              problemCompleteRate={problemCompleteRate}
              problemCorrectRate={problemCorrectRate}
              onPractice={startPractice}
            />
          ) : null}

          {view === "problemIndex" ? (
            <ProblemIndexView
              categoryRows={problemCategoryRows}
              onOpenList={openProblemList}
            />
          ) : null}

          {view === "problemList" ? (
            <ProblemListView
              title={selectedProblemMinor || selectedProblemMajor || "練習問題"}
              problems={listedProblems}
              solvedProblemSet={solvedProblemSet}
              onBack={() => setView("problemIndex")}
              onPractice={startProblemPractice}
            />
          ) : null}

          {view === "problemPractice" && currentProblem && problemQuestion ? (
            <ProblemPracticeView
              problem={currentProblem}
              question={problemQuestion}
              placedChoices={placedChoices}
              draggingChoice={draggingChoice}
              showHint={showProblemHint}
              practiceState={practiceState}
              dropRef={dropRef}
              onChoicePointerDown={setDraggingChoice}
              onChoicePointerUp={handleChoicePointerUp}
              onPlaceChoice={placeChoice}
              onClearChoice={clearPlacedChoice}
              onRevealHint={revealProblemHint}
              onSubmit={submitProblemAnswer}
              onSkip={nextProblem}
              onNext={nextProblem}
              onRevealAnswer={revealAnswer}
              onBack={backToProblemList}
            />
          ) : null}
        </div>

        <BottomNav activeView={view} onChange={setView} />
      </section>
    </main>
  );
}

function IndexView({
  categoryRows,
  rememberedSet,
  onOpenList
}: {
  categoryRows: Array<{ major: string; minor: string; formulas: Formula[] }>;
  rememberedSet: Set<string>;
  onOpenList: (major: string, minor: string) => void;
}) {
  return (
    <div className="category-list">
      {categoryRows.map((row, index) => {
        const done = row.formulas.filter((formula) => rememberedSet.has(formula.id)).length;
        return (
          <button
            key={`${row.major}-${row.minor}`}
            type="button"
            className={index === 0 ? "category-card featured" : "category-card"}
            onClick={() => onOpenList(row.major, row.minor)}
          >
            <span className="category-icon">{categoryIcons[row.major] || "f(x)"}</span>
            <span className="category-title">
              <b>{row.major}</b>
              <small>{row.minor}</small>
            </span>
            <span className={done === row.formulas.length ? "check done" : "check"}>✓</span>
          </button>
        );
      })}
    </div>
  );
}

function FormulaListView({
  title,
  formulas,
  rememberedSet,
  onBack,
  onPractice
}: {
  title: string;
  formulas: Formula[];
  rememberedSet: Set<string>;
  onBack: () => void;
  onPractice: (formula: Formula) => void;
}) {
  const minorGroups = groupBy(formulas, (formula) => formula.minorCategory);

  return (
    <div className="list-view">
      <div className="page-title-row">
        <h2>{title}</h2>
        <button type="button" className="back-button" onClick={onBack} aria-label="戻る">
          ‹
        </button>
      </div>
      {Object.entries(minorGroups).map(([minor, items]) => (
        <section key={minor} className="minor-section">
          <h3>{minor}</h3>
          {items.map((formula) => (
            <button
              key={formula.id}
              type="button"
              className="formula-card"
              onClick={() => onPractice(formula)}
            >
              <span className="formula-name">{formula.name}</span>
              <strong className="math">{mathText(formula.latex)}</strong>
              <span className={rememberedSet.has(formula.id) ? "check done" : "check"}>✓</span>
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}

function ProblemIndexView({
  categoryRows,
  onOpenList
}: {
  categoryRows: Array<{ major: string; minor: string; problems: PracticeProblem[] }>;
  onOpenList: (major: string, minor: string) => void;
}) {
  return (
    <div className="category-list">
      {categoryRows.map((row, index) => (
        <button
          key={`${row.major}-${row.minor}`}
          type="button"
          className={index === 0 ? "category-card featured" : "category-card"}
          onClick={() => onOpenList(row.major, row.minor)}
        >
          <span className="category-icon">{categoryIcons[row.major] || "Q"}</span>
          <span className="category-title">
            <b>{row.major}</b>
            <small>{row.minor}・{row.problems.length}問</small>
          </span>
          <span className="category-count">{row.problems.length}</span>
        </button>
      ))}
    </div>
  );
}

function ProblemListView({
  title,
  problems,
  solvedProblemSet,
  onBack,
  onPractice
}: {
  title: string;
  problems: PracticeProblem[];
  solvedProblemSet: Set<string>;
  onBack: () => void;
  onPractice: (problem: PracticeProblem) => void;
}) {
  const minorGroups = groupBy(problems, (problem) => problem.minorCategory);

  return (
    <div className="list-view">
      <div className="page-title-row">
        <h2>{title}</h2>
        <button type="button" className="back-button" onClick={onBack} aria-label="戻る">
          ‹
        </button>
      </div>
      {Object.entries(minorGroups).map(([minor, items]) => (
        <section key={minor} className="minor-section">
          <h3>{minor}</h3>
          {items.map((problem) => (
            <button
              key={problem.id}
              type="button"
              className="problem-card"
              onClick={() => onPractice(problem)}
            >
              <span className="problem-card-head">
                <b>{problem.id}</b>
                <small>{problem.formulaName}</small>
              </span>
              <span className="problem-card-question">{problem.question}</span>
              <strong className="math">{mathText(problem.latex)}</strong>
              <span className={solvedProblemSet.has(problem.id) ? "check done" : "check"}>✓</span>
            </button>
          ))}
        </section>
      ))}
    </div>
  );
}

function PracticeView({
  complete,
  total,
  formula,
  question,
  placedChoices,
  draggingChoice,
  practiceState,
  dropRef,
  onChoicePointerDown,
  onChoicePointerUp,
  onPlaceChoice,
  onClearChoice,
  onRevealHint,
  onSubmit,
  onSkip,
  onNext,
  onRevealAnswer,
  onBack
}: {
  complete: number;
  total: number;
  formula: Formula;
  question: FormulaQuestion;
  placedChoices: string[];
  draggingChoice: string | null;
  practiceState: PracticeState;
  dropRef: React.RefObject<HTMLDivElement>;
  onChoicePointerDown: (choice: string) => void;
  onChoicePointerUp: (choice: string, event: React.PointerEvent<HTMLButtonElement>) => void;
  onPlaceChoice: (choice: string) => void;
  onClearChoice: (index?: number) => void;
  onRevealHint: () => void;
  onSubmit: () => void;
  onSkip: () => void;
  onNext: () => void;
  onRevealAnswer: () => void;
  onBack: () => void;
}) {
  const isResolved = practiceState !== "question";

  return (
    <div className="practice-view">
      <div className="practice-top-row">
        <button type="button" className="practice-back-button" onClick={onBack}>
          ‹ 公式一覧
        </button>
      </div>
      <div className="progress-label">完了: {complete}/{total}</div>
      <div className="progress-track">
        <span style={{ width: total ? `${(complete / total) * 100}%` : "0%" }} />
      </div>
      {practiceState === "question" ? (
        <button type="button" className="hint-fill-button" onClick={onRevealHint}>
          ヒント: 30%表示
        </button>
      ) : null}

      {isResolved && practiceState === "answer" ? (
        <section className="answer-reveal-card">
          <h2>{formula.name}</h2>
          <div className="submitted-answer">
            <span>あなたの解答</span>
            <div className="submitted-token-row">
              {placedChoices.map((choice, index) => (
                <b key={`${choice}-${index}`} className="math">
                  {mathText(choice)}
                </b>
              ))}
            </div>
          </div>
          <span className="answer-label">正しい公式</span>
          <strong className="math">{mathText(formula.latex)}</strong>
          {formula.description ? <p className="formula-description">{formula.description}</p> : null}
        </section>
      ) : (
        <section className={practiceState === "error" ? "question-card wrong" : "question-card"}>
          {practiceState === "error" ? (
            <button type="button" className="retry-icon" onClick={() => onClearChoice()}>
              ↻
            </button>
          ) : null}
          <h2>{formula.name}</h2>
          <div className="choice-bank">
            {question.choices.map((choice, index) => (
              <button
                key={`${choice}-${index}`}
                type="button"
                className={`token ${pastelClasses[index % pastelClasses.length]} ${draggingChoice === choice ? "dragging" : ""}`}
                onClick={() => onPlaceChoice(choice)}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  onChoicePointerDown(choice);
                }}
                onPointerUp={(event) => onChoicePointerUp(choice, event)}
              >
                <span className="math">{mathText(choice)}</span>
              </button>
            ))}
          </div>
          <div ref={dropRef} className="formula-fill">
            {question.leftPrefix ? <span className="math formula-static">{mathText(question.leftPrefix)}</span> : null}
            {question.targets.map((target, index) => (
              <button
                key={`${target}-${index}`}
                type="button"
                className={placedChoices[index] ? "drop-box filled" : "drop-box"}
                onClick={() => onClearChoice(index)}
                aria-label={`解答欄 ${index + 1}`}
              >
                {placedChoices[index] ? <span className="math">{mathText(placedChoices[index])}</span> : null}
              </button>
            ))}
          </div>
          {formula.description ? <p className="formula-description">{formula.description}</p> : null}
        </section>
      )}

      {practiceState === "question" ? (
        <div className="practice-actions">
          <button type="button" className="large-button" onClick={onSkip}>
            スキップ
          </button>
          <button type="button" className="large-button" onClick={onSubmit}>
            答える
          </button>
        </div>
      ) : practiceState === "error" ? (
        <div className="next-row">
          <button type="button" className="large-button" onClick={onRevealAnswer}>
            解答表示
          </button>
        </div>
      ) : (
        <div className="next-row">
          <button type="button" className="large-button" onClick={onNext}>
            次へ
          </button>
        </div>
      )}
    </div>
  );
}

function ProblemPracticeView({
  problem,
  question,
  placedChoices,
  draggingChoice,
  showHint,
  practiceState,
  dropRef,
  onChoicePointerDown,
  onChoicePointerUp,
  onPlaceChoice,
  onClearChoice,
  onRevealHint,
  onSubmit,
  onSkip,
  onNext,
  onRevealAnswer,
  onBack
}: {
  problem: PracticeProblem;
  question: FormulaQuestion;
  placedChoices: string[];
  draggingChoice: string | null;
  showHint: boolean;
  practiceState: PracticeState;
  dropRef: React.RefObject<HTMLDivElement>;
  onChoicePointerDown: (choice: string) => void;
  onChoicePointerUp: (choice: string, event: React.PointerEvent<HTMLButtonElement>) => void;
  onPlaceChoice: (choice: string) => void;
  onClearChoice: (index?: number) => void;
  onRevealHint: () => void;
  onSubmit: () => void;
  onSkip: () => void;
  onNext: () => void;
  onRevealAnswer: () => void;
  onBack: () => void;
}) {
  const isResolved = practiceState !== "question";

  return (
    <div className="practice-view">
      <div className="practice-top-row">
        <button type="button" className="practice-back-button" onClick={onBack}>
          ‹ 練習問題
        </button>
      </div>
      {practiceState === "question" ? (
        <button type="button" className="hint-fill-button" onClick={onRevealHint}>
          ヒント: 数式表示
        </button>
      ) : null}

      {isResolved && practiceState === "answer" ? (
        <section className="answer-reveal-card">
          <h2>{problem.formulaName}</h2>
          <p className="problem-text">{problem.question}</p>
          <div className="submitted-answer">
            <span>あなたの解答</span>
            <div className="submitted-token-row">
              {placedChoices.map((choice, index) => (
                <b key={`${choice}-${index}`} className="math">
                  {mathText(choice)}
                </b>
              ))}
            </div>
          </div>
          <span className="answer-label">正しい解答</span>
          <strong className="math answer-math">{mathText(problem.answer)}</strong>
          <span className="answer-label">解法の式</span>
          <strong className="math support-math">{mathText(problem.latex)}</strong>
        </section>
      ) : (
        <section className={practiceState === "error" ? "question-card wrong" : "question-card"}>
          {practiceState === "error" ? (
            <button type="button" className="retry-icon" onClick={() => onClearChoice()}>
              ↻
            </button>
          ) : null}
          <h2>{problem.formulaName}</h2>
          <p className="problem-text">{problem.question}</p>
          {showHint ? <strong className="math support-math">{mathText(problem.latex)}</strong> : null}
          <div className="choice-bank">
            {question.choices.map((choice, index) => (
              <button
                key={`${choice}-${index}`}
                type="button"
                className={`token ${pastelClasses[index % pastelClasses.length]} ${draggingChoice === choice ? "dragging" : ""}`}
                onClick={() => onPlaceChoice(choice)}
                onPointerDown={(event) => {
                  event.currentTarget.setPointerCapture(event.pointerId);
                  onChoicePointerDown(choice);
                }}
                onPointerUp={(event) => onChoicePointerUp(choice, event)}
              >
                <span className="math">{mathText(choice)}</span>
              </button>
            ))}
          </div>
          <div ref={dropRef} className="formula-fill">
            {question.targets.map((target, index) => (
              <button
                key={`${target}-${index}`}
                type="button"
                className={placedChoices[index] ? "drop-box filled" : "drop-box"}
                onClick={() => onClearChoice(index)}
                aria-label={`解答欄 ${index + 1}`}
              >
                {placedChoices[index] ? <span className="math">{mathText(placedChoices[index])}</span> : null}
              </button>
            ))}
          </div>
        </section>
      )}

      {practiceState === "question" ? (
        <div className="practice-actions">
          <button type="button" className="large-button" onClick={onSkip}>
            スキップ
          </button>
          <button type="button" className="large-button" onClick={onSubmit}>
            答える
          </button>
        </div>
      ) : practiceState === "error" ? (
        <div className="next-row">
          <button type="button" className="large-button" onClick={onRevealAnswer}>
            解答表示
          </button>
        </div>
      ) : (
        <div className="next-row">
          <button type="button" className="large-button" onClick={onNext}>
            次へ
          </button>
        </div>
      )}
    </div>
  );
}

function StatsView({
  formulas,
  problems,
  rememberedSet,
  solvedProblemSet,
  stats,
  completeRate,
  correctRate,
  problemCompleteRate,
  problemCorrectRate,
  onPractice
}: {
  formulas: Formula[];
  problems: PracticeProblem[];
  rememberedSet: Set<string>;
  solvedProblemSet: Set<string>;
  stats: ActivityStats;
  completeRate: number;
  correctRate: number;
  problemCompleteRate: number;
  problemCorrectRate: number;
  onPractice: (formula: Formula) => void;
}) {
  const byMajor = groupBy(formulas, (formula) => formula.majorCategory);
  const problemsByMajor = groupBy(problems, (problem) => problem.majorCategory);

  return (
    <div className="stats-view">
      <section className="stats-summary">
        <div className="ring" style={{ background: `conic-gradient(#0a817a ${completeRate * 3.6}deg, #e8f7f5 0deg)` }}>
          <span>{completeRate}%</span>
        </div>
        <div className="stats-line">
          <span>暗記した数式</span>
          <b>{rememberedSet.size}/{formulas.length}</b>
        </div>
        <div className="stats-line">
          <span>回答総数</span>
          <b>{stats.attempts}</b>
        </div>
        <div className="stats-line">
          <span>正解総数</span>
          <b>{stats.correct}</b>
        </div>
        <div className="stats-line">
          <span>正解率</span>
          <b>{correctRate}%</b>
        </div>
        <div className="stats-line">
          <span>正解した練習問題</span>
          <b>{solvedProblemSet.size}/{problems.length}</b>
        </div>
        <div className="stats-line">
          <span>練習問題 回答総数</span>
          <b>{stats.problemAttempts}</b>
        </div>
        <div className="stats-line">
          <span>練習問題 正解総数</span>
          <b>{stats.problemCorrect}</b>
        </div>
        <div className="stats-line">
          <span>練習問題 正解率</span>
          <b>{problemCorrectRate}%</b>
        </div>
      </section>

      <section className="major-stats-card">
        <div className="major-stats-head">
          <span className="category-icon">Q</span>
          <b>練習問題</b>
          <strong>{solvedProblemSet.size}/{problems.length}</strong>
        </div>
        <div className="mini-track">
          <span style={{ width: `${problemCompleteRate}%` }}>{problemCompleteRate}%</span>
        </div>
      </section>

      {Object.entries(byMajor).map(([major, items]) => {
        const done = items.filter((formula) => rememberedSet.has(formula.id)).length;
        const percent = items.length ? Math.round((done / items.length) * 100) : 0;
        return (
          <section key={major} className="major-stats-card">
            <div className="major-stats-head">
              <span className="category-icon">{categoryIcons[major] || "f(x)"}</span>
              <b>{major}</b>
              <strong>{done}/{items.length}</strong>
            </div>
            <div className="mini-track">
              <span style={{ width: `${percent}%` }}>{percent}%</span>
            </div>
          </section>
        );
      })}

      {Object.entries(problemsByMajor).map(([major, items]) => {
        const done = items.filter((problem) => solvedProblemSet.has(problem.id)).length;
        const percent = items.length ? Math.round((done / items.length) * 100) : 0;
        return (
          <section key={`problem-${major}`} className="major-stats-card">
            <div className="major-stats-head">
              <span className="category-icon">{categoryIcons[major] || "Q"}</span>
              <b>練習問題: {major}</b>
              <strong>{done}/{items.length}</strong>
            </div>
            <div className="mini-track">
              <span style={{ width: `${percent}%` }}>{percent}%</span>
            </div>
          </section>
        );
      })}

      <section className="formula-progress-list">
        {formulas.slice(0, 12).map((formula) => (
          <button key={formula.id} type="button" onClick={() => onPractice(formula)}>
            <span className="math">{mathText(formula.latex)}</span>
            <span className="dot-row">
              <i className={rememberedSet.has(formula.id) ? "active" : ""} />
              <i />
              <i />
            </span>
          </button>
        ))}
      </section>
    </div>
  );
}

function BottomNav({
  activeView,
  onChange
}: {
  activeView: View;
  onChange: (view: View) => void;
}) {
  return (
    <nav className="bottom-nav">
      <button
        type="button"
        className={activeView === "index" || activeView === "list" || activeView === "practice" ? "active" : ""}
        onClick={() => onChange("index")}
      >
        <span className="grid-icon">▦</span>
        数式
      </button>
      <button
        type="button"
        className={activeView === "problemIndex" || activeView === "problemList" || activeView === "problemPractice" ? "active" : ""}
        onClick={() => onChange("problemIndex")}
      >
        <span className="grid-icon">□</span>
        練習問題
      </button>
      <button type="button" className={activeView === "stats" ? "active" : ""} onClick={() => onChange("stats")}>
        <span className="bars-icon">▥</span>
        統計
      </button>
    </nav>
  );
}
