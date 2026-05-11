"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Formula = {
  id: string;
  majorCategory: string;
  minorCategory: string;
  name: string;
  latex: string;
  importance: number;
};

type View = "index" | "list" | "practice" | "stats";
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
  history: []
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
      history: Array.isArray(parsed.history) ? parsed.history : []
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

function mathText(latex: string) {
  return `\\(${latex}\\)`;
}

export default function Home() {
  const [formulas, setFormulas] = useState<Formula[]>([]);
  const [view, setView] = useState<View>("index");
  const [selectedMajor, setSelectedMajor] = useState<string | null>(null);
  const [selectedMinor, setSelectedMinor] = useState<string | null>(null);
  const [currentFormulaId, setCurrentFormulaId] = useState<string | null>(null);
  const [practiceState, setPracticeState] = useState<PracticeState>("question");
  const [placedChoices, setPlacedChoices] = useState<string[]>([]);
  const [draggingChoice, setDraggingChoice] = useState<string | null>(null);
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
  }, []);

  useEffect(() => {
    const mathJax = (window as typeof window & { MathJax?: { typesetPromise?: () => Promise<void> } }).MathJax;
    mathJax?.typesetPromise?.();
  }, [formulas, view, selectedMajor, selectedMinor, currentFormulaId, practiceState, placedChoices]);

  const currentFormula = useMemo(
    () => formulas.find((formula) => formula.id === currentFormulaId) || formulas[0],
    [currentFormulaId, formulas]
  );
  const question = useMemo(
    () => (currentFormula ? makeQuestion(currentFormula, formulas) : null),
    [currentFormula, formulas]
  );
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
  const rememberedSet = useMemo(() => new Set(stats.rememberedIds), [stats.rememberedIds]);
  const completeRate = formulas.length ? Math.round((rememberedSet.size / formulas.length) * 100) : 0;
  const correctRate = stats.attempts ? Math.round((stats.correct / stats.attempts) * 100) : 0;

  function openList(major: string, minor: string | null = null) {
    setSelectedMajor(major);
    setSelectedMinor(minor);
    setView("list");
  }

  function startPractice(formula = currentFormula) {
    if (!formula) return;
    setCurrentFormulaId(formula.id);
    setPlacedChoices([]);
    setPracticeState("question");
    setView("practice");
  }

  function backToFormulaList() {
    if (currentFormula) {
      setSelectedMajor(currentFormula.majorCategory);
      setSelectedMinor(currentFormula.minorCategory);
    }
    setView("list");
  }

  function updateStats(correct: boolean, formula: Formula) {
    const nextRemembered = correct
      ? Array.from(new Set([...stats.rememberedIds, formula.id]))
      : stats.rememberedIds;
    const nextStats = {
      attempts: stats.attempts + 1,
      correct: stats.correct + (correct ? 1 : 0),
      rememberedIds: nextRemembered,
      history: [{ id: formula.id, correct, answeredAt: new Date().toISOString() }, ...stats.history].slice(0, 50)
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

  function nextFormula() {
    if (!currentFormula) return;
    const currentIndex = formulas.findIndex((formula) => formula.id === currentFormula.id);
    const next = formulas[(currentIndex + 1) % formulas.length];
    startPractice(next);
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
    if (!question) return;
    setPlacedChoices((current) => {
      const next = Array.from(
        { length: question.targets.length },
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
    if (!question) return;
    setPlacedChoices((current) => {
      const next = Array.from(
        { length: question.targets.length },
        (_, index) => current[index] || ""
      );
      const blankIndexes = next
        .map((value, index) => (value ? -1 : index))
        .filter((index) => index >= 0);
      const revealCount = Math.max(1, Math.ceil(question.targets.length * 0.3));
      blankIndexes.slice(0, revealCount).forEach((index) => {
        next[index] = question.targets[index];
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
              onBack={backToFormulaList}
            />
          ) : null}

          {view === "stats" ? (
            <StatsView
              formulas={formulas}
              rememberedSet={rememberedSet}
              stats={stats}
              completeRate={completeRate}
              correctRate={correctRate}
              onPractice={startPractice}
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
  rememberedSet,
  stats,
  completeRate,
  correctRate,
  onPractice
}: {
  formulas: Formula[];
  rememberedSet: Set<string>;
  stats: ActivityStats;
  completeRate: number;
  correctRate: number;
  onPractice: (formula: Formula) => void;
}) {
  const byMajor = groupBy(formulas, (formula) => formula.majorCategory);

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
      <button type="button" className={activeView === "index" || activeView === "list" ? "active" : ""} onClick={() => onChange("index")}>
        <span className="grid-icon">▦</span>
        数式
      </button>
      <button type="button" className={activeView === "stats" ? "active" : ""} onClick={() => onChange("stats")}>
        <span className="bars-icon">▥</span>
        統計
      </button>
    </nav>
  );
}
