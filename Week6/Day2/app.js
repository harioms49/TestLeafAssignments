const WEBHOOK_URL = "http://localhost:5678/webhook/Userstory_reviewer";
const PROGRESS_MESSAGES = [
  "Reading story key...",
  "Contacting Jira API...",
  "Evaluating description clarity...",
  "Synthesizing recommendations..."
];

const reviewForm = document.querySelector("#review-form");
const storyKeyInput = document.querySelector("#story-key");
const storyKeyField = document.querySelector(".story-key-field");
const storyKeyError = document.querySelector("#story-key-error");
const reviewButton = reviewForm.querySelector(".review-button");
const reviewButtonLabel = reviewForm.querySelector(".review-button-label");
const workspace = document.querySelector(".review-workspace");
const workspaceTag = document.querySelector(".workspace-tag");
const analysisCompleteBadge = document.querySelector("#analysis-complete-badge");
const progressMessage = document.querySelector(".progress-message");
const analysisOutput = document.querySelector(".analysis-output");
const workspaceErrorMessage = document.querySelector(".workspace-error-message");

const workspaceStates = {
  waiting: document.querySelector(".workspace-waiting"),
  loading: document.querySelector(".workspace-loading"),
  error: document.querySelector(".workspace-error"),
  results: document.querySelector(".workspace-results")
};

function showWorkspaceState(stateName) {
  for (const [name, element] of Object.entries(workspaceStates)) {
    element.hidden = name !== stateName;
  }
}

function clearInputError() {
  storyKeyField.classList.remove("is-invalid");
  storyKeyInput.setAttribute("aria-invalid", "false");
  storyKeyError.hidden = true;
}

function shakeWorkspace() {
  workspace.classList.remove("is-error");
  void workspace.offsetWidth;
  workspace.classList.add("is-error");
}

workspace.addEventListener("animationend", (event) => {
  if (event.animationName === "workspace-shake") {
    workspace.classList.remove("is-error");
  }
});

function showWorkspaceError(message) {
  workspaceErrorMessage.textContent = message;
  showWorkspaceState("error");
  workspaceTag.textContent = "ERROR";
  workspaceTag.classList.add("is-error");
  shakeWorkspace();
}

function extractResponseText(value) {
  if (typeof value === "string") {
    return value.trim();
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (Array.isArray(value)) {
    return value.map(extractResponseText).filter(Boolean).join("\n\n");
  }

  if (value && typeof value === "object") {
    const preferredKeys = ["output", "text", "response", "content", "result", "data", "body", "message"];

    for (const key of preferredKeys) {
      if (Object.prototype.hasOwnProperty.call(value, key)) {
        const extracted = extractResponseText(value[key]);
        if (extracted) {
          return extracted;
        }
      }
    }

    const nestedText = Object.values(value).map(extractResponseText).filter(Boolean).join("\n\n");
    return nestedText || JSON.stringify(value, null, 2);
  }

  return "";
}

function renderInlineContent(container, text) {
  const inlinePattern = /(\*\*[^*]+\*\*|__[^_]+__|`[^`]+`|\*[^*]+\*|_[^_]+_)/g;
  let cursor = 0;
  let match;

  while ((match = inlinePattern.exec(text)) !== null) {
    container.append(document.createTextNode(text.slice(cursor, match.index)));

    const token = match[0];
    let element;
    let content;
    if (token.startsWith("**") || token.startsWith("__")) {
      element = document.createElement("strong");
      content = token.slice(2, -2);
    } else if (token.startsWith("`")) {
      element = document.createElement("code");
      element.className = "inline-code";
      content = token.slice(1, -1);
    } else {
      element = document.createElement("em");
      content = token.slice(1, -1);
    }

    element.textContent = content;
    container.append(element);
    cursor = match.index + token.length;
  }

  container.append(document.createTextNode(text.slice(cursor)));
}

function splitTableRow(row) {
  let value = row.trim();
  if (value.startsWith("|")) {
    value = value.slice(1);
  }
  if (value.endsWith("|") && !value.endsWith("\\|")) {
    value = value.slice(0, -1);
  }

  const cells = [];
  let cell = "";
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === "\\" && value[index + 1] === "|") {
      cell += "|";
      index += 1;
    } else if (value[index] === "|") {
      cells.push(cell.trim());
      cell = "";
    } else {
      cell += value[index];
    }
  }
  cells.push(cell.trim());
  return cells;
}

function isTableSeparator(line) {
  const cells = splitTableRow(line);
  return cells.length > 0 && cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function getTableAlignment(separator) {
  if (separator.startsWith(":") && separator.endsWith(":")) {
    return "center";
  }
  if (separator.endsWith(":")) {
    return "right";
  }
  return "left";
}

function getListItem(line) {
  const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
  if (unordered) {
    return { ordered: false, text: unordered[1] };
  }
  const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
  return ordered ? { ordered: true, text: ordered[1] } : null;
}

function renderMarkdown(markdown) {
  analysisOutput.replaceChildren();
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^\s*```([\w+-]*)\s*$/);
    if (fence) {
      const codeLines = [];
      index += 1;
      while (index < lines.length && !/^\s*```\s*$/.test(lines[index])) {
        codeLines.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) {
        index += 1;
      }

      const pre = document.createElement("pre");
      pre.className = "markdown-code-block";
      const code = document.createElement("code");
      if (fence[1]) {
        code.className = `language-${fence[1]}`;
      }
      code.textContent = codeLines.join("\n");
      pre.append(code);
      analysisOutput.append(pre);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      const level = heading[1].length;
      const element = document.createElement(`h${level}`);
      element.className = `report-heading report-heading-level-${level}`;
      renderInlineContent(element, heading[2]);
      analysisOutput.append(element);
      index += 1;
      continue;
    }

    if (index + 1 < lines.length && line.includes("|") && isTableSeparator(lines[index + 1])) {
      const headers = splitTableRow(line);
      const separators = splitTableRow(lines[index + 1]);
      const table = document.createElement("table");
      table.className = "markdown-table";
      const thead = document.createElement("thead");
      const headerRow = document.createElement("tr");

      headers.forEach((text, cellIndex) => {
        const cell = document.createElement("th");
        cell.scope = "col";
        cell.className = `align-${getTableAlignment(separators[cellIndex] || "---")}`;
        renderInlineContent(cell, text);
        headerRow.append(cell);
      });

      thead.append(headerRow);
      table.append(thead);
      const tbody = document.createElement("tbody");
      index += 2;
      while (index < lines.length && lines[index].includes("|") && lines[index].trim()) {
        const row = splitTableRow(lines[index]);
        const tableRow = document.createElement("tr");
        headers.forEach((_, cellIndex) => {
          const cell = document.createElement("td");
          cell.className = `align-${getTableAlignment(separators[cellIndex] || "---")}`;
          renderInlineContent(cell, row[cellIndex] || "");
          tableRow.append(cell);
        });
        tbody.append(tableRow);
        index += 1;
      }

      table.append(tbody);
      const tableScroll = document.createElement("div");
      tableScroll.className = "markdown-table-scroll";
      tableScroll.append(table);
      analysisOutput.append(tableScroll);
      continue;
    }

    const listItem = getListItem(line);
    if (listItem) {
      const list = document.createElement(listItem.ordered ? "ol" : "ul");
      while (index < lines.length) {
        const item = getListItem(lines[index]);
        if (!item || item.ordered !== listItem.ordered) {
          break;
        }
        const element = document.createElement("li");
        renderInlineContent(element, item.text);
        list.append(element);
        index += 1;
      }
      analysisOutput.append(list);
      continue;
    }

    const paragraphLines = [];
    while (index < lines.length && lines[index].trim()) {
      const isHeading = /^(#{1,6})\s+/.test(lines[index]);
      const isFence = /^\s*```/.test(lines[index]);
      const isList = /^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[index]);
      const isTable = index + 1 < lines.length && lines[index].includes("|") && isTableSeparator(lines[index + 1]);
      if (paragraphLines.length && (isHeading || isFence || isList || isTable)) {
        break;
      }
      paragraphLines.push(lines[index]);
      index += 1;
      if (isHeading || isFence || isList || isTable) {
        break;
      }
    }

    const paragraph = document.createElement("p");
    renderInlineContent(paragraph, paragraphLines.join(" "));
    analysisOutput.append(paragraph);
  }
}

storyKeyInput.addEventListener("input", () => {
  clearInputError();
  if (!workspaceStates.error.hidden || !workspaceStates.results.hidden) {
    showWorkspaceState("waiting");
    workspaceTag.textContent = "READY";
    workspaceTag.classList.remove("is-error");
    workspace.classList.remove("is-error");
    analysisCompleteBadge.hidden = true;
    workspaceTag.hidden = false;
  }
});

reviewForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  clearInputError();

  const storyKey = storyKeyInput.value.trim();
  if (!storyKey) {
    storyKeyField.classList.add("is-invalid");
    storyKeyInput.setAttribute("aria-invalid", "true");
    storyKeyError.hidden = false;
    shakeWorkspace();
    storyKeyInput.focus();
    return;
  }

  reviewButton.disabled = true;
  storyKeyInput.disabled = true;
  reviewButtonLabel.textContent = "Analyzing...";
  reviewButton.setAttribute("aria-busy", "true");
  workspace.setAttribute("aria-busy", "true");
  workspaceTag.textContent = "ANALYZING";
  workspaceTag.classList.remove("is-error");
  workspaceTag.hidden = false;
  analysisCompleteBadge.hidden = true;
  workspace.classList.remove("is-error");
  showWorkspaceState("loading");

  let progressIndex = 0;
  progressMessage.textContent = PROGRESS_MESSAGES[progressIndex];
  const progressTimer = window.setInterval(() => {
    progressIndex = (progressIndex + 1) % PROGRESS_MESSAGES.length;
    progressMessage.textContent = PROGRESS_MESSAGES[progressIndex];
  }, 1500);

  try {
    const response = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ storyKey })
    });

    if (!response.ok) {
      throw new Error(`The n8n webhook returned HTTP ${response.status}. Check the workflow and try again.`);
    }

    const responseBody = await response.text();
    let responseData;
    try {
      responseData = JSON.parse(responseBody);
    } catch {
      responseData = responseBody;
    }

    const reviewText = extractResponseText(responseData);
    if (!reviewText) {
      throw new Error("The n8n webhook returned an empty response. Check the workflow and try again.");
    }

    renderMarkdown(reviewText);
    showWorkspaceState("results");
    workspaceTag.hidden = true;
    analysisCompleteBadge.hidden = false;
  } catch (error) {
    console.error("Story review request failed.", error);
    if (error instanceof TypeError) {
      showWorkspaceError("Couldn't connect to the n8n webhook. Check that n8n is running and the webhook is active, then try again.");
    } else {
      showWorkspaceError(error instanceof Error ? error.message : "The review failed unexpectedly. Please try again.");
    }
  } finally {
    window.clearInterval(progressTimer);
    storyKeyInput.disabled = false;
    reviewButton.disabled = false;
    reviewButtonLabel.textContent = "Review Story";
    reviewButton.removeAttribute("aria-busy");
    workspace.setAttribute("aria-busy", "false");
    if (workspaceTag.textContent === "ANALYZING") {
      workspaceTag.textContent = "READY";
    }
  }
});
