import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const formulasPath = path.join(root, "public", "formulas", "formulas.json");
const problemsPath = path.join(root, "public", "problems", "problems.json");
const cssPath = path.join(root, "app", "globals.css");
const outputDir = path.join(root, "docs");

const formulasJson = await readFile(formulasPath, "utf8");
const problemsJson = await readFile(problemsPath, "utf8");
const css = await readFile(cssPath, "utf8");
const data = {
  ...JSON.parse(formulasJson),
  ...JSON.parse(problemsJson)
};

function escapeScriptJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const html = `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <title>数学・トレーナー</title>
  <style>${css}</style>
  <script>
    window.MathJax = {
      tex: { inlineMath: [['\\\\(', '\\\\)'], ['$', '$']], displayMath: [['\\\\[', '\\\\]']] },
      svg: { fontCache: 'global' }
    };
  </script>
  <script defer src="https://cdn.jsdelivr.net/npm/mathjax@3/es5/tex-svg.js"></script>
</head>
<body>
  <main class="app-shell">
    <section class="app-frame">
      <header class="app-header">
        <button type="button" class="hamburger" aria-label="menu"><span></span><span></span><span></span></button>
        <h1>数学・トレーナー</h1>
      </header>
      <div id="app" class="screen-content"></div>
      <nav class="bottom-nav">
        <button type="button" id="nav-index" class="active"><span class="grid-icon">▦</span>数式</button>
        <button type="button" id="nav-problems"><span class="grid-icon">□</span>練習問題</button>
        <button type="button" id="nav-stats"><span class="bars-icon">▥</span>統計</button>
      </nav>
    </section>
  </main>
  <script id="formula-data" type="application/json">${escapeScriptJson(data)}</script>
  <script>
(() => {
  const payload = JSON.parse(document.getElementById("formula-data").textContent);
  const formulas = payload.formulas;
  const problems = payload.problems || [];
  const statsKey = "math-trainer-formula-stats";
  const pastelClasses = ["mint", "peach", "green", "blue", "lime", "violet", "cream"];
  const categoryIcons = { "確率論": "P(A)", "分布論": "N(μ)", "統計": "x̄", "線形代数": "Ax", "微積分": "∫dx", "確率過程": "Pᵢⱼ", "保険数理": "PV", "応用確率": "E[X]" };
  const app = document.getElementById("app");
  const navIndex = document.getElementById("nav-index");
  const navProblems = document.getElementById("nav-problems");
  const navStats = document.getElementById("nav-stats");
  let view = "index";
  let selectedMajor = null;
  let selectedMinor = null;
  let selectedProblemMajor = null;
  let selectedProblemMinor = null;
  let currentFormula = formulas[0];
  let currentProblem = problems[0];
  let practiceState = "question";
  let question = null;
  let problemQuestion = null;
  let placedChoices = [];
  let showProblemHint = false;
  let draggingChoice = null;

  function groupBy(items, getter) {
    return items.reduce((groups, item) => {
      const key = getter(item);
      groups[key] = groups[key] || [];
      groups[key].push(item);
      return groups;
    }, {});
  }

  function loadStats() {
    try {
      const raw = sessionStorage.getItem(statsKey);
      if (!raw) return { attempts: 0, correct: 0, rememberedIds: [], history: [] };
      const parsed = JSON.parse(raw);
      return {
        attempts: parsed.attempts || 0,
        correct: parsed.correct || 0,
        rememberedIds: Array.isArray(parsed.rememberedIds) ? parsed.rememberedIds : [],
        history: Array.isArray(parsed.history) ? parsed.history : []
      };
    } catch {
      return { attempts: 0, correct: 0, rememberedIds: [], history: [] };
    }
  }

  function saveStats(stats) {
    sessionStorage.setItem(statsKey, JSON.stringify(stats));
  }

  function mathText(latex) {
    return "\\\\(" + latex + "\\\\)";
  }

  function typeset() {
    if (window.MathJax && window.MathJax.typesetPromise) window.MathJax.typesetPromise();
  }

  function findMainEqualsIndex(latex) {
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

  function readBraceContent(source, openIndex) {
    let depth = 0;
    for (let index = openIndex; index < source.length; index += 1) {
      const char = source[index];
      if (char === "{") depth += 1;
      if (char === "}") depth -= 1;
      if (depth === 0) return { content: source.slice(openIndex + 1, index), end: index + 1 };
    }
    return { content: source.slice(openIndex + 1), end: source.length };
  }

  function mergeScriptTokens(tokens) {
    const merged = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if ((token === "_" || token === "^") && merged.length > 0 && tokens[index + 1]) {
        const base = merged.pop();
        merged.push(base + token + tokens[index + 1]);
        index += 1;
      } else {
        merged.push(token);
      }
    }
    return merged;
  }

  function latexToAnswerTokens(latex) {
    const commandMap = { cap: "∩", cup: "∪", le: "≤", ge: "≥", to: "→", pm: "±", sum: "Σ", int: "∫", cdots: "…", lambda: "λ", mu: "μ", sigma: "σ", theta: "θ", pi: "π", rho: "ρ", alpha: "α", beta: "β", partial: "∂" };
    const tokens = [];
    for (let index = 0; index < latex.length; index += 1) {
      const char = latex[index];
      if (/\\s/.test(char) || char === "}") continue;
      if (char === "{") {
        const content = readBraceContent(latex, index);
        tokens.push(content.content);
        index = content.end - 1;
        continue;
      }
      if (char === "\\\\") {
        const match = latex.slice(index + 1).match(/^[A-Za-z]+/);
        const command = match?.[0] || "";
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
          const cursor = index + 1 + command.length;
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

  function makeQuestion(formula) {
    const equalIndex = findMainEqualsIndex(formula.latex);
    const leftPrefix = equalIndex >= 0 ? formula.latex.slice(0, equalIndex + 1) : "";
    const rhs = equalIndex >= 0 ? formula.latex.slice(equalIndex + 1) : formula.latex;
    const targets = latexToAnswerTokens(rhs);
    const distractors = formulas.flatMap((item) => latexToAnswerTokens(item.latex))
      .filter((token) => !targets.includes(token) && token.length <= 8)
      .filter((token, index, array) => array.indexOf(token) === index)
      .slice(0, 10);
    const choices = [...targets, ...distractors].filter((choice, index, array) => array.indexOf(choice) === index).slice(0, 18);
    const shuffled = choices.map((choice, index) => ({ choice, sort: (choice.charCodeAt(0) * 17 + index * 31) % 97 }))
      .sort((a, b) => a.sort - b.sort).map((item) => item.choice);
    return { targets, choices: shuffled, leftPrefix };
  }

  function makeProblemQuestion(problem) {
    const targets = latexToAnswerTokens(problem.answer);
    const distractors = problems.flatMap((item) => latexToAnswerTokens(item.answer))
      .filter((token) => !targets.includes(token) && token.length <= 8)
      .filter((token, index, array) => array.indexOf(token) === index)
      .slice(0, 12);
    const choices = [...targets, ...distractors].filter((choice, index, array) => array.indexOf(choice) === index).slice(0, 18);
    const shuffled = choices.map((choice, index) => ({ choice, sort: (choice.charCodeAt(0) * 19 + index * 29) % 101 }))
      .sort((a, b) => a.sort - b.sort).map((item) => item.choice);
    return { targets, choices: shuffled, leftPrefix: "" };
  }

  function activeQuestion() {
    return view === "problemPractice" ? problemQuestion : question;
  }

  function setActiveNav() {
    navIndex.classList.toggle("active", view === "index" || view === "list" || view === "practice");
    navProblems.classList.toggle("active", view === "problemIndex" || view === "problemList" || view === "problemPractice");
    navStats.classList.toggle("active", view === "stats");
  }

  function render() {
    setActiveNav();
    if (view === "index") renderIndex();
    if (view === "list") renderList();
    if (view === "practice") renderPractice();
    if (view === "problemIndex") renderProblemIndex();
    if (view === "problemList") renderProblemList();
    if (view === "problemPractice") renderProblemPractice();
    if (view === "stats") renderStats();
    typeset();
  }

  function rememberedSet() {
    return new Set(loadStats().rememberedIds);
  }

  function renderIndex() {
    const majorGroups = groupBy(formulas, (formula) => formula.majorCategory);
    const rows = Object.entries(majorGroups).flatMap(([major, majorFormulas]) =>
      Object.entries(groupBy(majorFormulas, (formula) => formula.minorCategory)).map(([minor, rowFormulas]) => ({ major, minor, formulas: rowFormulas }))
    );
    const remembered = rememberedSet();
    app.innerHTML = '<div class="category-list">' + rows.map((row, index) => {
      const done = row.formulas.filter((formula) => remembered.has(formula.id)).length === row.formulas.length;
      return '<button type="button" class="' + (index === 0 ? 'category-card featured' : 'category-card') + '" data-major="' + row.major + '" data-minor="' + row.minor + '">' +
        '<span class="category-icon">' + (categoryIcons[row.major] || 'f(x)') + '</span>' +
        '<span class="category-title"><b>' + row.major + '</b><small>' + row.minor + '</small></span>' +
        '<span class="' + (done ? 'check done' : 'check') + '">✓</span></button>';
    }).join("") + "</div>";
    app.querySelectorAll(".category-card").forEach((button) => {
      button.addEventListener("click", () => {
        selectedMajor = button.dataset.major;
        selectedMinor = button.dataset.minor;
        view = "list";
        render();
      });
    });
  }

  function renderList() {
    const visible = formulas.filter((formula) => (!selectedMajor || formula.majorCategory === selectedMajor) && (!selectedMinor || formula.minorCategory === selectedMinor));
    const groups = groupBy(visible, (formula) => formula.minorCategory);
    const remembered = rememberedSet();
    app.innerHTML = '<div class="list-view"><div class="page-title-row"><h2>' + (selectedMinor || selectedMajor || "公式一覧") + '</h2><button type="button" class="back-button" id="back-index">‹</button></div>' +
      Object.entries(groups).map(([minor, items]) => '<section class="minor-section"><h3>' + minor + '</h3>' + items.map((formula) =>
        '<button type="button" class="formula-card" data-id="' + formula.id + '"><span class="formula-name">' + formula.name + '</span><strong class="math">' + mathText(formula.latex) + '</strong><span class="' + (remembered.has(formula.id) ? 'check done' : 'check') + '">✓</span></button>'
      ).join("") + '</section>').join("") + '</div>';
    document.getElementById("back-index").addEventListener("click", () => { view = "index"; render(); });
    app.querySelectorAll(".formula-card").forEach((button) => {
      button.addEventListener("click", () => startPractice(formulas.find((formula) => formula.id === button.dataset.id)));
    });
  }

  function startPractice(formula) {
    currentFormula = formula || currentFormula || formulas[0];
    question = makeQuestion(currentFormula);
    placedChoices = [];
    practiceState = "question";
    view = "practice";
    render();
  }

  function placeChoice(choice) {
    const currentQuestion = activeQuestion();
    const next = Array.from({ length: currentQuestion.targets.length }, (_, index) => placedChoices[index] || "");
    const emptyIndex = next.findIndex((value) => !value);
    if (emptyIndex >= 0) next[emptyIndex] = choice;
    else next.push(choice);
    placedChoices = next.slice(0, currentQuestion.targets.length);
    render();
  }

  function revealHint() {
    const currentQuestion = activeQuestion();
    const next = Array.from({ length: currentQuestion.targets.length }, (_, index) => placedChoices[index] || "");
    const blanks = next.map((value, index) => value ? -1 : index).filter((index) => index >= 0);
    blanks.slice(0, Math.max(1, Math.ceil(currentQuestion.targets.length * 0.3))).forEach((index) => { next[index] = currentQuestion.targets[index]; });
    placedChoices = next;
    render();
  }

  function submitAnswer() {
    const correct = question.targets.length === placedChoices.length && question.targets.every((target, index) => placedChoices[index] === target);
    const stats = loadStats();
    const rememberedIds = correct ? Array.from(new Set([...stats.rememberedIds, currentFormula.id])) : stats.rememberedIds;
    saveStats({ attempts: stats.attempts + 1, correct: stats.correct + (correct ? 1 : 0), rememberedIds, history: [{ id: currentFormula.id, correct, answeredAt: new Date().toISOString() }, ...stats.history].slice(0, 50) });
    practiceState = correct ? "answer" : "error";
    render();
  }

  function nextFormula() {
    const index = formulas.findIndex((formula) => formula.id === currentFormula.id);
    startPractice(formulas[(index + 1) % formulas.length]);
  }

  function renderPractice() {
    if (!question) question = makeQuestion(currentFormula);
    const stats = loadStats();
    const complete = stats.rememberedIds.length;
    const progress = formulas.length ? (complete / formulas.length) * 100 : 0;
    if (practiceState === "answer") {
      app.innerHTML = '<div class="practice-view"><div class="practice-top-row"><button type="button" class="practice-back-button" id="back-list">‹ 公式一覧</button></div><div class="progress-label">完了: ' + complete + '/' + formulas.length + '</div><div class="progress-track"><span style="width:' + progress + '%"></span></div><section class="answer-reveal-card"><h2>' + escapeHtml(currentFormula.name) + '</h2><div class="submitted-answer"><span>あなたの解答</span><div class="submitted-token-row">' + placedChoices.map((choice, index) => '<b class="math" key="' + index + '">' + mathText(choice) + '</b>').join("") + '</div></div><span class="answer-label">正しい公式</span><strong class="math">' + mathText(currentFormula.latex) + '</strong>' + (currentFormula.description ? '<p class="formula-description">' + escapeHtml(currentFormula.description) + '</p>' : '') + '</section><div class="next-row"><button type="button" class="large-button" id="next-formula">次へ</button></div></div>';
      document.getElementById("back-list").addEventListener("click", backToList);
      document.getElementById("next-formula").addEventListener("click", nextFormula);
      return;
    }
    app.innerHTML = '<div class="practice-view"><div class="practice-top-row"><button type="button" class="practice-back-button" id="back-list">‹ 公式一覧</button></div><div class="progress-label">完了: ' + complete + '/' + formulas.length + '</div><div class="progress-track"><span style="width:' + progress + '%"></span></div>' +
      (practiceState === "question" ? '<button type="button" class="hint-fill-button" id="hint-button">ヒント: 30%表示</button>' : '') +
      '<section class="' + (practiceState === "error" ? 'question-card wrong' : 'question-card') + '">' +
      (practiceState === "error" ? '<button type="button" class="retry-icon" id="clear-answer">↻</button>' : '') +
      '<h2>' + escapeHtml(currentFormula.name) + '</h2><div class="choice-bank">' + question.choices.map((choice, index) => '<button type="button" class="token ' + pastelClasses[index % pastelClasses.length] + '" data-choice="' + choice + '"><span class="math">' + mathText(choice) + '</span></button>').join("") + '</div>' +
      '<div class="formula-fill"><span class="math formula-static">' + mathText(question.leftPrefix) + '</span>' + question.targets.map((target, index) => '<button type="button" class="' + (placedChoices[index] ? 'drop-box filled' : 'drop-box') + '" data-clear="' + index + '">' + (placedChoices[index] ? '<span class="math">' + mathText(placedChoices[index]) + '</span>' : '') + '</button>').join("") + '</div>' + (currentFormula.description ? '<p class="formula-description">' + escapeHtml(currentFormula.description) + '</p>' : '') + '</section>' +
      (practiceState === "question" ? '<div class="practice-actions"><button type="button" class="large-button" id="skip-button">スキップ</button><button type="button" class="large-button" id="submit-button">答える</button></div>' : practiceState === "error" ? '<div class="next-row"><button type="button" class="large-button" id="reveal-answer">解答表示</button></div>' : '<div class="next-row"><button type="button" class="large-button" id="next-formula">次へ</button></div>') + '</div>';
    document.getElementById("back-list").addEventListener("click", backToList);
    document.querySelectorAll(".token").forEach((button) => button.addEventListener("click", () => placeChoice(button.dataset.choice)));
    document.querySelectorAll(".drop-box").forEach((button) => button.addEventListener("click", () => { placedChoices[Number(button.dataset.clear)] = ""; render(); }));
    document.getElementById("hint-button")?.addEventListener("click", revealHint);
    document.getElementById("clear-answer")?.addEventListener("click", () => { placedChoices = []; practiceState = "question"; render(); });
    document.getElementById("skip-button")?.addEventListener("click", nextFormula);
    document.getElementById("submit-button")?.addEventListener("click", submitAnswer);
    document.getElementById("reveal-answer")?.addEventListener("click", () => { practiceState = "answer"; render(); });
    document.getElementById("next-formula")?.addEventListener("click", nextFormula);
  }

  function backToList() {
    selectedMajor = currentFormula.majorCategory;
    selectedMinor = currentFormula.minorCategory;
    view = "list";
    render();
  }

  function renderProblemIndex() {
    const majorGroups = groupBy(problems, (problem) => problem.majorCategory);
    const rows = Object.entries(majorGroups).flatMap(([major, majorProblems]) =>
      Object.entries(groupBy(majorProblems, (problem) => problem.minorCategory)).map(([minor, rowProblems]) => ({ major, minor, problems: rowProblems }))
    );
    app.innerHTML = '<div class="category-list">' + rows.map((row, index) =>
      '<button type="button" class="' + (index === 0 ? 'category-card featured' : 'category-card') + '" data-major="' + escapeHtml(row.major) + '" data-minor="' + escapeHtml(row.minor) + '">' +
      '<span class="category-icon">' + (categoryIcons[row.major] || 'Q') + '</span>' +
      '<span class="category-title"><b>' + escapeHtml(row.major) + '</b><small>' + escapeHtml(row.minor) + '・' + row.problems.length + '問</small></span>' +
      '<span class="category-count">' + row.problems.length + '</span></button>'
    ).join("") + "</div>";
    app.querySelectorAll(".category-card").forEach((button) => {
      button.addEventListener("click", () => {
        selectedProblemMajor = button.dataset.major;
        selectedProblemMinor = button.dataset.minor;
        view = "problemList";
        render();
      });
    });
  }

  function renderProblemList() {
    const visible = problems.filter((problem) => (!selectedProblemMajor || problem.majorCategory === selectedProblemMajor) && (!selectedProblemMinor || problem.minorCategory === selectedProblemMinor));
    const groups = groupBy(visible, (problem) => problem.minorCategory);
    app.innerHTML = '<div class="list-view"><div class="page-title-row"><h2>' + escapeHtml(selectedProblemMinor || selectedProblemMajor || "練習問題") + '</h2><button type="button" class="back-button" id="back-problem-index">‹</button></div>' +
      Object.entries(groups).map(([minor, items]) => '<section class="minor-section"><h3>' + escapeHtml(minor) + '</h3>' + items.map((problem) =>
        '<button type="button" class="problem-card" data-id="' + escapeHtml(problem.id) + '"><span class="problem-card-head"><b>' + escapeHtml(problem.id) + '</b><small>' + escapeHtml(problem.formulaName) + '</small></span><span class="problem-card-question">' + escapeHtml(problem.question) + '</span><strong class="math">' + mathText(problem.latex) + '</strong></button>'
      ).join("") + '</section>').join("") + '</div>';
    document.getElementById("back-problem-index").addEventListener("click", () => { view = "problemIndex"; render(); });
    app.querySelectorAll(".problem-card").forEach((button) => {
      button.addEventListener("click", () => startProblemPractice(problems.find((problem) => problem.id === button.dataset.id)));
    });
  }

  function startProblemPractice(problem) {
    currentProblem = problem || currentProblem || problems[0];
    problemQuestion = makeProblemQuestion(currentProblem);
    placedChoices = [];
    practiceState = "question";
    showProblemHint = false;
    view = "problemPractice";
    render();
  }

  function submitProblemAnswer() {
    const correct = problemQuestion.targets.length === placedChoices.length && problemQuestion.targets.every((target, index) => placedChoices[index] === target);
    practiceState = correct ? "answer" : "error";
    render();
  }

  function nextProblem() {
    const index = problems.findIndex((problem) => problem.id === currentProblem.id);
    startProblemPractice(problems[(index + 1) % problems.length]);
  }

  function backToProblemList() {
    selectedProblemMajor = currentProblem.majorCategory;
    selectedProblemMinor = currentProblem.minorCategory;
    view = "problemList";
    render();
  }

  function renderProblemPractice() {
    if (!problemQuestion) problemQuestion = makeProblemQuestion(currentProblem);
    if (practiceState === "answer") {
      app.innerHTML = '<div class="practice-view"><div class="practice-top-row"><button type="button" class="practice-back-button" id="back-problem-list">‹ 練習問題</button></div><section class="answer-reveal-card"><h2>' + escapeHtml(currentProblem.formulaName) + '</h2><p class="problem-text">' + escapeHtml(currentProblem.question) + '</p><div class="submitted-answer"><span>あなたの解答</span><div class="submitted-token-row">' + placedChoices.map((choice, index) => '<b class="math" key="' + index + '">' + mathText(choice) + '</b>').join("") + '</div></div><span class="answer-label">正しい解答</span><strong class="math answer-math">' + mathText(currentProblem.answer) + '</strong><span class="answer-label">解法の式</span><strong class="math support-math">' + mathText(currentProblem.latex) + '</strong></section><div class="next-row"><button type="button" class="large-button" id="next-problem">次へ</button></div></div>';
      document.getElementById("back-problem-list").addEventListener("click", backToProblemList);
      document.getElementById("next-problem").addEventListener("click", nextProblem);
      return;
    }
    app.innerHTML = '<div class="practice-view"><div class="practice-top-row"><button type="button" class="practice-back-button" id="back-problem-list">‹ 練習問題</button></div>' +
      (practiceState === "question" ? '<button type="button" class="hint-fill-button" id="hint-button">ヒント: 数式表示</button>' : '') +
      '<section class="' + (practiceState === "error" ? 'question-card wrong' : 'question-card') + '">' +
      (practiceState === "error" ? '<button type="button" class="retry-icon" id="clear-answer">↻</button>' : '') +
      '<h2>' + escapeHtml(currentProblem.formulaName) + '</h2><p class="problem-text">' + escapeHtml(currentProblem.question) + '</p>' + (showProblemHint ? '<strong class="math support-math">' + mathText(currentProblem.latex) + '</strong>' : '') + '<div class="choice-bank">' +
      problemQuestion.choices.map((choice, index) => '<button type="button" class="token ' + pastelClasses[index % pastelClasses.length] + '" data-choice="' + escapeHtml(choice) + '"><span class="math">' + mathText(choice) + '</span></button>').join("") + '</div>' +
      '<div class="formula-fill">' + problemQuestion.targets.map((target, index) => '<button type="button" class="' + (placedChoices[index] ? 'drop-box filled' : 'drop-box') + '" data-clear="' + index + '">' + (placedChoices[index] ? '<span class="math">' + mathText(placedChoices[index]) + '</span>' : '') + '</button>').join("") + '</div></section>' +
      (practiceState === "question" ? '<div class="practice-actions"><button type="button" class="large-button" id="skip-button">スキップ</button><button type="button" class="large-button" id="submit-button">答える</button></div>' : practiceState === "error" ? '<div class="next-row"><button type="button" class="large-button" id="reveal-answer">解答表示</button></div>' : '<div class="next-row"><button type="button" class="large-button" id="next-problem">次へ</button></div>') + '</div>';
    document.getElementById("back-problem-list").addEventListener("click", backToProblemList);
    document.querySelectorAll(".token").forEach((button) => button.addEventListener("click", () => placeChoice(button.dataset.choice)));
    document.querySelectorAll(".drop-box").forEach((button) => button.addEventListener("click", () => { placedChoices[Number(button.dataset.clear)] = ""; render(); }));
    document.getElementById("hint-button")?.addEventListener("click", () => { showProblemHint = true; render(); });
    document.getElementById("clear-answer")?.addEventListener("click", () => { placedChoices = []; practiceState = "question"; render(); });
    document.getElementById("skip-button")?.addEventListener("click", nextProblem);
    document.getElementById("submit-button")?.addEventListener("click", submitProblemAnswer);
    document.getElementById("reveal-answer")?.addEventListener("click", () => { practiceState = "answer"; render(); });
    document.getElementById("next-problem")?.addEventListener("click", nextProblem);
  }

  function renderStats() {
    const stats = loadStats();
    const remembered = new Set(stats.rememberedIds);
    const completeRate = formulas.length ? Math.round((remembered.size / formulas.length) * 100) : 0;
    const correctRate = stats.attempts ? Math.round((stats.correct / stats.attempts) * 100) : 0;
    const byMajor = groupBy(formulas, (formula) => formula.majorCategory);
    app.innerHTML = '<div class="stats-view"><section class="stats-summary"><div class="ring" style="background:conic-gradient(#0a817a ' + (completeRate * 3.6) + 'deg, #e8f7f5 0deg)"><span>' + completeRate + '%</span></div><div class="stats-line"><span>暗記した数式</span><b>' + remembered.size + '/' + formulas.length + '</b></div><div class="stats-line"><span>回答総数</span><b>' + stats.attempts + '</b></div><div class="stats-line"><span>正解総数</span><b>' + stats.correct + '</b></div><div class="stats-line"><span>正解率</span><b>' + correctRate + '%</b></div></section>' +
      Object.entries(byMajor).map(([major, items]) => { const done = items.filter((formula) => remembered.has(formula.id)).length; const percent = items.length ? Math.round((done / items.length) * 100) : 0; return '<section class="major-stats-card"><div class="major-stats-head"><span class="category-icon">' + (categoryIcons[major] || 'f(x)') + '</span><b>' + major + '</b><strong>' + done + '/' + items.length + '</strong></div><div class="mini-track"><span style="width:' + percent + '%">' + percent + '%</span></div></section>'; }).join("") +
      '<section class="formula-progress-list">' + formulas.slice(0, 12).map((formula) => '<button type="button" data-id="' + formula.id + '"><span class="math">' + mathText(formula.latex) + '</span><span class="dot-row"><i class="' + (remembered.has(formula.id) ? 'active' : '') + '"></i><i></i><i></i></span></button>').join("") + '</section></div>';
    app.querySelectorAll(".formula-progress-list button").forEach((button) => button.addEventListener("click", () => startPractice(formulas.find((formula) => formula.id === button.dataset.id))));
  }

  navIndex.addEventListener("click", () => { view = "index"; render(); });
  navProblems.addEventListener("click", () => { view = "problemIndex"; render(); });
  navStats.addEventListener("click", () => { view = "stats"; render(); });
  render();
})();
  </script>
</body>
</html>`;

await mkdir(outputDir, { recursive: true });
await writeFile(path.join(outputDir, "index.html"), html);
console.log(`Wrote GitHub Pages HTML to ${path.join(outputDir, "index.html")}`);
